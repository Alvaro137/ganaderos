import io
import logging
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import pypdf

logger = logging.getLogger("sales_ingestion")


def _parse_float(val: Optional[str]) -> Optional[float]:
    if not val:
        return None
    s = str(val).strip()
    if not s:
        return None
    try:
        if "." in s and "," in s:
            if s.rfind(",") > s.rfind("."):
                # Formato europeo: 1.725,72 -> miles '.', decimal ','
                s = s.replace(".", "").replace(",", ".")
            else:
                # Formato anglosajón: 1,725.72 -> miles ',', decimal '.'
                s = s.replace(",", "")
        elif "," in s:
            # Decimal con coma (ej: 12,50 o 5,2)
            s = s.replace(",", ".")
        return float(s)
    except (ValueError, AttributeError):
        return None


def _normalizar_fecha_iso(fecha_str: Optional[str]) -> Optional[str]:
    if not fecha_str:
        return None
    s = str(fecha_str).strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def _parsear_texto_factura_individual(text: str, nombre_archivo: str = "factura.pdf") -> Dict[str, Any]:
    """Parsea el texto de una factura individual de GANAVAEX."""
    m_fact = re.search(r"Factura\s*(?:CABEZAS\s*)?([A-Z0-9\s/]+?)\s*NIF", text)
    if m_fact:
        num_factura = m_fact.group(1).replace("\n", " ").strip()
    else:
        num_factura = Path(nombre_archivo).stem

    m_fecha = re.search(r"(\d{2}/\d{2}/\d{4})\s*Fecha", text)
    if not m_fecha:
        m_fecha = re.search(r"Fecha\s*(\d{2}/\d{2}/\d{4})", text)
    fecha_factura = _normalizar_fecha_iso(m_fecha.group(1)) if m_fecha else None

    m_pago = re.search(
        r"(\d{2}/\d{2}/\d{4})\s+PAGOS C DUERO\s+([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)",
        text,
    )
    if m_pago:
        fecha_pago_raw, total_raw, base_raw, pct_iva_raw, cuota_iva_raw = m_pago.groups()
        fecha_pago = _normalizar_fecha_iso(fecha_pago_raw)
        total_factura = _parse_float(total_raw)
        base_imponible = _parse_float(base_raw)
        porcentaje_iva = _parse_float(pct_iva_raw) or 10.50
        cuota_iva = _parse_float(cuota_iva_raw)
    else:
        fecha_pago = None
        total_factura = None
        base_imponible = None
        porcentaje_iva = 10.50
        cuota_iva = None

    if not fecha_factura and fecha_pago:
        fecha_factura = fecha_pago

    lineas_animales: List[Dict[str, Any]] = []
    lineas_gastos: List[Dict[str, Any]] = []

    regex_animal = re.compile(
        r"^(TERNERO CEBO|TERNERA CEBO|VACAS O TOROS|LIQ MAYOR IMPORTE[^\d]+)\s+"
        r"([0-9.,]+?)\s+"
        r"([0-9.,]+?)"
        r"(?:001|002|010|029|032|\d{3})"
        r"(?:\s+([0-9.,]+))?$"
    )
    regex_gasto = re.compile(
        r"^(PORTES/GASTOS COMPENSACION|GASTOS\s*<12 meses|GASTOS>24meses|A CTA GASTOS COOP[^\n-]+|ANIMAL >350 KG|URGENCIA)\s*(.*)$"
    )

    linea_idx = 1
    for raw_line in text.split("\n"):
        line_clean = raw_line.strip()
        m_anim = regex_animal.match(line_clean)
        if m_anim:
            art, imp_uds, precio_str, cab_str = m_anim.groups()
            m_split = re.match(r"^([0-9.,]+?\.\d{2})([0-9.,]+?\.\d{3})$", imp_uds)
            if m_split:
                importe_str, uds_str = m_split.groups()
            else:
                importe_str = imp_uds
                uds_str = None

            cabezas_val = _parse_float(cab_str) if cab_str else 1.0
            peso_val = _parse_float(uds_str)
            precio_val = _parse_float(precio_str)
            importe_val = _parse_float(importe_str)

            # Si 'uds' es 1.0 o el peso promedio por cabeza es inferior a 50 kg (ej. lote facturado
            # como '1.000 uds' o ajustes globales), NO es peso canal en kg sino unidad de lote.
            if peso_val is not None:
                if peso_val < 50.0 or (cabezas_val > 1 and (peso_val / cabezas_val) < 50.0):
                    peso_val = None
                    if precio_val is not None and precio_val > 50.0 and cabezas_val > 0:
                        precio_val = round(importe_val / cabezas_val, 2) if importe_val else None

            lineas_animales.append(
                {
                    "linea_numero": linea_idx,
                    "articulo": art.strip(),
                    "importe_linea": importe_val,
                    "peso_canal_kg": peso_val,
                    "precio_unitario": precio_val,
                    "referencia": "001",
                    "cabezas": cabezas_val,
                }
            )
            linea_idx += 1
            continue

        m_gst = regex_gasto.match(line_clean)
        if m_gst:
            concepto, resto = m_gst.groups()
            m_imp = re.search(r"(-?\d+(?:\.\d{2})?)", resto)
            imp_val = _parse_float(m_imp.group(1)) if m_imp else None
            lineas_gastos.append(
                {
                    "concepto": re.sub(r"\s+", " ", concepto).strip(),
                    "importe": imp_val,
                }
            )

    total_cabezas = sum(lin["cabezas"] for lin in lineas_animales) if lineas_animales else None
    total_kilos = sum(lin["peso_canal_kg"] for lin in lineas_animales if lin["peso_canal_kg"]) if lineas_animales else None
    gastos_total = sum(g["importe"] for g in lineas_gastos if g["importe"]) if lineas_gastos else None

    return {
        "numero_factura": num_factura,
        "fecha_factura": fecha_factura,
        "fecha_pago": fecha_pago,
        "cliente_cooperativa": "GANAVAEX, S.COOP",
        "cif_cliente": "F37335411",
        "total_cabezas": total_cabezas,
        "total_kilos_canal": total_kilos,
        "base_imponible": base_imponible,
        "porcentaje_iva": porcentaje_iva,
        "cuota_iva": cuota_iva,
        "gastos_total": gastos_total,
        "total_factura": total_factura,
        "archivo_origen": nombre_archivo,
        "lineas_animales": lineas_animales,
        "lineas_gastos": lineas_gastos,
    }


def parsear_todas_las_facturas_pdf(
    stream_or_path: Union[str, Path, io.BytesIO, bytes], nombre_archivo: str = "factura.pdf"
) -> List[Dict[str, Any]]:
    """Parsea un PDF extrayendo todas las facturas contenidas (soportando PDFs multi-página con varias facturas)."""
    if isinstance(stream_or_path, bytes):
        reader = pypdf.PdfReader(io.BytesIO(stream_or_path))
    elif isinstance(stream_or_path, io.BytesIO):
        reader = pypdf.PdfReader(stream_or_path)
    else:
        reader = pypdf.PdfReader(str(stream_or_path))

    paginas_con_factura = []
    for i, p in enumerate(reader.pages):
        txt = p.extract_text() or ""
        if "GANAVAEX" in txt and ("PAGOS C DUERO" in txt or "Factura" in txt):
            paginas_con_factura.append((i, txt))

    if len(paginas_con_factura) > 1 and all("Factura" in t for _, t in paginas_con_factura):
        facturas = []
        for idx, txt in paginas_con_factura:
            data = _parsear_texto_factura_individual(txt, nombre_archivo=f"{nombre_archivo}#p{idx+1}")
            facturas.append(data)
        return facturas

    # Factura única
    full_text = "\n".join([page.extract_text() or "" for page in reader.pages])
    return [_parsear_texto_factura_individual(full_text, nombre_archivo=nombre_archivo)]


def parsear_factura_pdf(
    stream_or_path: Union[str, Path, io.BytesIO, bytes], nombre_archivo: str = "factura.pdf"
) -> Dict[str, Any]:
    """Parsea una factura de liquidación en PDF (GANAVAEX).
    Si el documento contiene múltiples facturas, devuelve la principal con 'otras_facturas'.
    """
    facturas = parsear_todas_las_facturas_pdf(stream_or_path, nombre_archivo=nombre_archivo)
    if not facturas:
        raise ValueError("No se encontraron datos de factura en el archivo PDF proporcionado.")

    resultado = facturas[0]
    if len(facturas) > 1:
        resultado["otras_facturas"] = facturas[1:]
    return resultado


def guardar_liquidacion_en_bd(conn: sqlite3.Connection, datos: Dict[str, Any]) -> int:
    """Guarda o actualiza de forma atómica una liquidación y sus canales/gastos en la BD SQLite.
    Si contiene 'otras_facturas', las persiste también dentro de la misma transacción.
    """
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys = ON;")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS ventas_liquidaciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero_factura TEXT UNIQUE NOT NULL,
            fecha_factura TEXT,
            fecha_pago TEXT,
            cliente_cooperativa TEXT DEFAULT 'GANAVAEX, S.COOP',
            cif_cliente TEXT DEFAULT 'F37335411',
            total_cabezas REAL,
            total_kilos_canal REAL,
            base_imponible REAL,
            porcentaje_iva REAL DEFAULT 10.50,
            cuota_iva REAL,
            gastos_total REAL,
            total_factura REAL,
            archivo_origen TEXT
        );
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ventas_canales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            factura_id INTEGER REFERENCES ventas_liquidaciones(id) ON DELETE CASCADE,
            linea_numero INTEGER,
            articulo TEXT,
            cabezas REAL DEFAULT 1.0,
            peso_canal_kg REAL,
            precio_unitario REAL,
            importe_linea REAL,
            referencia TEXT,
            fecha_salida_lote TEXT,
            crotal_asignado TEXT
        );
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ventas_gastos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            factura_id INTEGER REFERENCES ventas_liquidaciones(id) ON DELETE CASCADE,
            concepto TEXT,
            importe REAL
        );
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_ventas_factura ON ventas_canales(factura_id);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_ventas_crotal ON ventas_canales(crotal_asignado);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas_liquidaciones(fecha_factura);")

    def _insertar_una_factura(d: Dict[str, Any]) -> int:
        cur.execute(
            "SELECT id FROM ventas_liquidaciones WHERE numero_factura = ?",
            (d["numero_factura"],),
        )
        row = cur.fetchone()

        if row:
            factura_id = row[0]
            cur.execute(
                """
                UPDATE ventas_liquidaciones
                SET fecha_factura = ?, fecha_pago = ?, cliente_cooperativa = ?, cif_cliente = ?,
                    total_cabezas = ?, total_kilos_canal = ?, base_imponible = ?, porcentaje_iva = ?,
                    cuota_iva = ?, gastos_total = ?, total_factura = ?, archivo_origen = ?
                WHERE id = ?
                """,
                (
                    d["fecha_factura"],
                    d["fecha_pago"],
                    d["cliente_cooperativa"],
                    d["cif_cliente"],
                    d["total_cabezas"],
                    d["total_kilos_canal"],
                    d["base_imponible"],
                    d["porcentaje_iva"],
                    d["cuota_iva"],
                    d["gastos_total"],
                    d["total_factura"],
                    d["archivo_origen"],
                    factura_id,
                ),
            )
            cur.execute("DELETE FROM ventas_canales WHERE factura_id = ?", (factura_id,))
            cur.execute("DELETE FROM ventas_gastos WHERE factura_id = ?", (factura_id,))
        else:
            cur.execute(
                """
                INSERT INTO ventas_liquidaciones (
                    numero_factura, fecha_factura, fecha_pago, cliente_cooperativa, cif_cliente,
                    total_cabezas, total_kilos_canal, base_imponible, porcentaje_iva,
                    cuota_iva, gastos_total, total_factura, archivo_origen
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    d["numero_factura"],
                    d["fecha_factura"],
                    d["fecha_pago"],
                    d["cliente_cooperativa"],
                    d["cif_cliente"],
                    d["total_cabezas"],
                    d["total_kilos_canal"],
                    d["base_imponible"],
                    d["porcentaje_iva"],
                    d["cuota_iva"],
                    d["gastos_total"],
                    d["total_factura"],
                    d["archivo_origen"],
                ),
            )
            factura_id = cur.lastrowid

        for lin in d["lineas_animales"]:
            cur.execute(
                """
                INSERT INTO ventas_canales (
                    factura_id, linea_numero, articulo, cabezas, peso_canal_kg,
                    precio_unitario, importe_linea, referencia, crotal_asignado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    factura_id,
                    lin["linea_numero"],
                    lin["articulo"],
                    lin["cabezas"],
                    lin["peso_canal_kg"],
                    lin["precio_unitario"],
                    lin["importe_linea"],
                    lin.get("referencia", "001"),
                    lin.get("crotal_asignado"),
                ),
            )

        for gst in d["lineas_gastos"]:
            cur.execute(
                """
                INSERT INTO ventas_gastos (factura_id, concepto, importe)
                VALUES (?, ?, ?)
                """,
                (factura_id, gst["concepto"], gst["importe"]),
            )

        return factura_id

    primer_id = _insertar_una_factura(datos)

    if "otras_facturas" in datos and isinstance(datos["otras_facturas"], list):
        for otra in datos["otras_facturas"]:
            _insertar_una_factura(otra)

    conn.commit()
    return primer_id
