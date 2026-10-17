#!/usr/bin/env python3
"""Extracción e ingesta de facturas y liquidaciones de canales (GANAVAEX) a SQLite."""
from __future__ import annotations

import argparse
import logging
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pypdf

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ingest_facturas")

SCHEMA_SQL = """
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

CREATE TABLE IF NOT EXISTS ventas_gastos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factura_id INTEGER REFERENCES ventas_liquidaciones(id) ON DELETE CASCADE,
    concepto TEXT,
    importe REAL
);

CREATE INDEX IF NOT EXISTS idx_ventas_factura ON ventas_canales(factura_id);
CREATE INDEX IF NOT EXISTS idx_ventas_crotal ON ventas_canales(crotal_asignado);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas_liquidaciones(fecha_factura);
"""


def parse_float(val: Optional[str]) -> Optional[float]:
    if not val:
        return None
    try:
        return float(val.replace(",", "").strip())
    except (ValueError, AttributeError):
        return None


def normalizar_fecha_iso(fecha_str: Optional[str]) -> Optional[str]:
    if not fecha_str:
        return None
    try:
        dt = datetime.strptime(fecha_str.strip(), "%d/%m/%Y")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return None


def extraer_datos_pdf(pdf_path: Path) -> Dict[str, Any]:
    """Extrae cabecera, líneas de animales y deducciones de una factura de GANAVAEX."""
    reader = pypdf.PdfReader(str(pdf_path))
    text = reader.pages[0].extract_text()

    # 1. Número de factura
    m_fact = re.search(r"Factura\s*(?:CABEZAS\s*)?([A-Z0-9\s/]+?)\s*NIF", text)
    if m_fact:
        num_factura = m_fact.group(1).replace("\n", " ").strip()
    else:
        # Fallback del nombre de archivo: "Factura G015-3 08-04-2026.pdf"
        num_factura = pdf_path.stem

    # 2. Fecha de factura
    m_fecha = re.search(r"(\d{2}/\d{2}/\d{4})\s*Fecha", text)
    if not m_fecha:
        m_fecha = re.search(r"Fecha\s*(\d{2}/\d{2}/\d{4})", text)
    fecha_factura = normalizar_fecha_iso(m_fecha.group(1)) if m_fecha else None

    # 3. Bloque de impuestos y pago
    m_pago = re.search(
        r"(\d{2}/\d{2}/\d{4})\s+PAGOS C DUERO\s+([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)",
        text,
    )
    if m_pago:
        fecha_pago_raw, total_raw, base_raw, pct_iva_raw, cuota_iva_raw = m_pago.groups()
        fecha_pago = normalizar_fecha_iso(fecha_pago_raw)
        total_factura = parse_float(total_raw)
        base_imponible = parse_float(base_raw)
        porcentaje_iva = parse_float(pct_iva_raw) or 10.50
        cuota_iva = parse_float(cuota_iva_raw)
    else:
        fecha_pago = None
        total_factura = None
        base_imponible = None
        porcentaje_iva = 10.50
        cuota_iva = None

    if not fecha_factura and fecha_pago:
        fecha_factura = fecha_pago

    # 4. Líneas de animales / canales
    lineas_animales: List[Dict[str, Any]] = []
    lineas_gastos: List[Dict[str, Any]] = []

    regex_animal = re.compile(
        r"^(TERNERO CEBO|TERNERA CEBO|VACAS O TOROS|LIQ MAYOR IMPORTE[^\d]+)\s+([0-9.,]+)\s+([0-9.,]+)\s*(\d{2})\s+([0-9.,]+)$"
    )
    regex_gasto = re.compile(
        r"^(PORTES/GASTOS COMPENSACION|GASTOS\s*<12 meses|GASTOS>24meses|A CTA GASTOS COOP[^\n-]+|ANIMAL >350 KG)\s*(.*)$"
    )

    linea_idx = 1
    for raw_line in text.split("\n"):
        line_clean = raw_line.strip()

        # Detección de línea de animal
        m_anim = regex_animal.match(line_clean)
        if m_anim:
            art, imp_uds, precio_str, ref, cab_str = m_anim.groups()
            m_split = re.match(r"^([0-9.,]+?\.\d{2})([0-9.,]+?\.\d{3})$", imp_uds)
            if m_split:
                importe_str, uds_str = m_split.groups()
            else:
                importe_str = imp_uds
                uds_str = None

            lineas_animales.append(
                {
                    "linea_numero": linea_idx,
                    "articulo": art.strip(),
                    "importe_linea": parse_float(importe_str),
                    "peso_canal_kg": parse_float(uds_str),
                    "precio_unitario": parse_float(precio_str),
                    "referencia": ref,
                    "cabezas": parse_float(cab_str) or 1.0,
                }
            )
            linea_idx += 1
            continue

        # Detección de línea de gasto / deducción
        m_gst = regex_gasto.match(line_clean)
        if m_gst:
            concepto, resto = m_gst.groups()
            m_imp = re.search(r"(-?\d+(?:\.\d{2})?)", resto)
            imp_val = parse_float(m_imp.group(1)) if m_imp else None
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
        "archivo_origen": pdf_path.name,
        "lineas_animales": lineas_animales,
        "lineas_gastos": lineas_gastos,
    }


def buscar_lote_movimiento_coincidente(
    conn: sqlite3.Connection,
    fecha_factura: Optional[str],
    total_cabezas: Optional[float],
) -> Tuple[Optional[str], List[str]]:
    """Busca en la tabla movimientos una salida hacia GANAVAEX compatible en fechas y cabezas."""
    if not fecha_factura or not total_cabezas:
        return None, []

    # Comprobar si la tabla movimientos existe en la base de datos
    tiene_movs = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='movimientos'"
    ).fetchone()
    if not tiene_movs:
        return None, []

    # Busca salidas (tipo 'S' o 'V') hacia ES373762000081 en los 60 días previos a la factura

    query = """
    SELECT fecha, COUNT(*) as cabezas, GROUP_CONCAT(crotal) as crotales
    FROM movimientos
    WHERE (tipo IN ('S', 'V', 'VENTA', 'SALIDA') OR destino LIKE '%ES373762000081%')
      AND fecha <= ? AND fecha >= date(?, '-65 days')
    GROUP BY fecha
    ORDER BY fecha DESC
    """
    rows = conn.execute(query, (fecha_factura, fecha_factura)).fetchall()

    # 1. Búsqueda exacta por número de cabezas
    for f_salida, n_cab, crotales_str in rows:
        if n_cab == int(total_cabezas):
            crotales = [c.strip() for c in crotales_str.split(",") if c.strip()]
            return f_salida, crotales

    # 2. Si hay un único lote en ese intervalo temporal
    if len(rows) == 1:
        f_salida, _, crotales_str = rows[0]
        crotales = [c.strip() for c in crotales_str.split(",") if c.strip()]
        return f_salida, crotales

    return None, []


def insertar_factura_en_bd(conn: sqlite3.Connection, data: Dict[str, Any]) -> int:
    """Inserta la liquidación, canales y gastos en la base de datos SQLite."""
    # Buscar posible vinculación con lotes de salida en movimientos
    fecha_salida, crotales = buscar_lote_movimiento_coincidente(
        conn, data["fecha_factura"], data["total_cabezas"]
    )

    cur = conn.cursor()
    # Insertar o reemplazar liquidación
    cur.execute(
        """
        INSERT INTO ventas_liquidaciones (
            numero_factura, fecha_factura, fecha_pago, cliente_cooperativa, cif_cliente,
            total_cabezas, total_kilos_canal, base_imponible, porcentaje_iva, cuota_iva,
            gastos_total, total_factura, archivo_origen
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(numero_factura) DO UPDATE SET
            fecha_factura = excluded.fecha_factura,
            fecha_pago = excluded.fecha_pago,
            total_cabezas = excluded.total_cabezas,
            total_kilos_canal = excluded.total_kilos_canal,
            base_imponible = excluded.base_imponible,
            porcentaje_iva = excluded.porcentaje_iva,
            cuota_iva = excluded.cuota_iva,
            gastos_total = excluded.gastos_total,
            total_factura = excluded.total_factura,
            archivo_origen = excluded.archivo_origen
        """,
        (
            data["numero_factura"],
            data["fecha_factura"],
            data["fecha_pago"],
            data["cliente_cooperativa"],
            data["cif_cliente"],
            data["total_cabezas"],
            data["total_kilos_canal"],
            data["base_imponible"],
            data["porcentaje_iva"],
            data["cuota_iva"],
            data["gastos_total"],
            data["total_factura"],
            data["archivo_origen"],
        ),
    )

    factura_id = cur.execute(
        "SELECT id FROM ventas_liquidaciones WHERE numero_factura = ?",
        (data["numero_factura"],),
    ).fetchone()[0]

    # Limpiar líneas previas si se reimporta
    cur.execute("DELETE FROM ventas_canales WHERE factura_id = ?", (factura_id,))
    cur.execute("DELETE FROM ventas_gastos WHERE factura_id = ?", (factura_id,))

    # Insertar canales individuales
    for idx, linea in enumerate(data["lineas_animales"]):
        # Emparejar crotal si el número de líneas coincide exactamente con las cabezas del lote
        crotal_cand = crotales[idx] if idx < len(crotales) and len(crotales) == len(data["lineas_animales"]) else None

        cur.execute(
            """
            INSERT INTO ventas_canales (
                factura_id, linea_numero, articulo, cabezas, peso_canal_kg,
                precio_unitario, importe_linea, referencia, fecha_salida_lote, crotal_asignado
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                factura_id,
                linea["linea_numero"],
                linea["articulo"],
                linea["cabezas"],
                linea["peso_canal_kg"],
                linea["precio_unitario"],
                linea["importe_linea"],
                linea["referencia"],
                fecha_salida,
                crotal_cand,
            ),
        )

    # Insertar gastos
    for gasto in data["lineas_gastos"]:
        cur.execute(
            """
            INSERT INTO ventas_gastos (factura_id, concepto, importe)
            VALUES (?, ?, ?)
            """,
            (factura_id, gasto["concepto"], gasto["importe"]),
        )

    return factura_id


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingesta de liquidaciones y pesos de canal desde PDFs a SQLite.")
    parser.add_argument(
        "--pdf-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "Example-data",
        help="Directorio con las facturas PDF",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="Ruta a la base de datos SQLite de destino (por defecto pwa/ganaderos_campo.sqlite o ganaderos_demo.sqlite)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parsear e imprimir en consola sin modificar la base de datos",
    )
    args = parser.parse_args()

    if not args.pdf_dir.exists():
        logger.error("No existe el directorio de PDFs: %s", args.pdf_dir)
        return 1

    pdf_files = sorted(args.pdf_dir.glob("*.pdf"))
    if not pdf_files:
        logger.warning("No se encontraron archivos PDF en %s", args.pdf_dir)
        return 0

    logger.info("Encontrados %d archivos PDF para procesar.", len(pdf_files))

    if args.dry_run:
        for p in pdf_files:
            datos = extraer_datos_pdf(p)
            logger.info("Factura %s (%s): %d canales, base=%.2f, total=%.2f",
                        datos["numero_factura"], datos["fecha_factura"],
                        len(datos["lineas_animales"]), datos["base_imponible"] or 0.0,
                        datos["total_factura"] or 0.0)
        return 0

    if args.db is not None:
        db_path = args.db
        db_path.parent.mkdir(parents=True, exist_ok=True)
    else:
        campo_db = Path(__file__).resolve().parents[1] / "pwa" / "ganaderos_campo.sqlite"
        demo_db = Path(__file__).resolve().parents[1] / "pwa" / "ganaderos_demo.sqlite"
        if campo_db.exists():
            db_path = campo_db
        elif demo_db.exists():
            db_path = demo_db
        else:
            logger.error("No se encontró base de datos en pwa/ganaderos_campo.sqlite ni en ganaderos_demo.sqlite")
            return 1

    logger.info("Usando base de datos: %s", db_path)


    conn = sqlite3.connect(str(db_path))
    with conn:
        conn.executescript(SCHEMA_SQL)

        total_facturas = 0
        total_canales = 0
        for p in pdf_files:
            try:
                datos = extraer_datos_pdf(p)
                fid = insertar_factura_en_bd(conn, datos)
                total_facturas += 1
                total_canales += len(datos["lineas_animales"])
                logger.info(
                    "Insertada Factura #%d: %s (%s) con %d canales",
                    fid,
                    datos["numero_factura"],
                    datos["fecha_factura"],
                    len(datos["lineas_animales"]),
                )
            except Exception as e:
                logger.error("Error al procesar %s: %s", p.name, e, exc_info=True)

    conn.close()
    logger.info(
        "Ingesta finalizada: %d facturas y %d canales importados en %s.",
        total_facturas,
        total_canales,
        db_path,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
