"""Servicio de aplicación para procesar e ingestar facturas PDF de liquidaciones de venta (GANAVAEX)."""
from __future__ import annotations

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
    try:
        dt = datetime.strptime(fecha_str.strip(), "%d/%m/%Y")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return None


def parsear_factura_pdf(stream_or_path: Union[str, Path, io.BytesIO, bytes], nombre_archivo: str = "factura.pdf") -> Dict[str, Any]:
    """Parsea una factura de liquidación en PDF (GANAVAEX) extrayendo cabecera, canales y deducciones."""
    if isinstance(stream_or_path, bytes):
        reader = pypdf.PdfReader(io.BytesIO(stream_or_path))
    elif isinstance(stream_or_path, io.BytesIO):
        reader = pypdf.PdfReader(stream_or_path)
    else:
        reader = pypdf.PdfReader(str(stream_or_path))

    # Extraer texto de todas las páginas de la factura
    text = "\n".join([page.extract_text() or "" for page in reader.pages])

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
        r"^(TERNERO CEBO|TERNERA CEBO|VACAS O TOROS|LIQ MAYOR IMPORTE[^\d]+)\s+([0-9.,]+)\s+([0-9.,]+)\s*(\d{2})\s+([0-9.,]+)$"
    )
    regex_gasto = re.compile(
        r"^(PORTES/GASTOS COMPENSACION|GASTOS\s*<12 meses|GASTOS>24meses|A CTA GASTOS COOP[^\n-]+|ANIMAL >350 KG)\s*(.*)$"
    )

    linea_idx = 1
    for raw_line in text.split("\n"):
        line_clean = raw_line.strip()
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
                    "importe_linea": _parse_float(importe_str),
                    "peso_canal_kg": _parse_float(uds_str),
                    "precio_unitario": _parse_float(precio_str),
                    "referencia": ref,
                    "cabezas": _parse_float(cab_str) or 1.0,
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


def guardar_liquidacion_en_bd(conn: sqlite3.Connection, datos: Dict[str, Any]) -> int:
    """Guarda o actualiza de forma atómica una liquidación y sus canales/gastos en la BD SQLite."""
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys = ON;")

    # Verificar si ya existe
    cur.execute(
        "SELECT id FROM ventas_liquidaciones WHERE numero_factura = ?",
        (datos["numero_factura"],),
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
                datos["fecha_factura"],
                datos["fecha_pago"],
                datos["cliente_cooperativa"],
                datos["cif_cliente"],
                datos["total_cabezas"],
                datos["total_kilos_canal"],
                datos["base_imponible"],
                datos["porcentaje_iva"],
                datos["cuota_iva"],
                datos["gastos_total"],
                datos["total_factura"],
                datos["archivo_origen"],
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
                datos["numero_factura"],
                datos["fecha_factura"],
                datos["fecha_pago"],
                datos["cliente_cooperativa"],
                datos["cif_cliente"],
                datos["total_cabezas"],
                datos["total_kilos_canal"],
                datos["base_imponible"],
                datos["porcentaje_iva"],
                datos["cuota_iva"],
                datos["gastos_total"],
                datos["total_factura"],
                datos["archivo_origen"],
            ),
        )
        factura_id = cur.lastrowid

    # Inserción de canales
    for lin in datos["lineas_animales"]:
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
                lin["referencia"],
                lin.get("crotal_asignado"),
            ),
        )

    # Inserción de deducciones
    for gst in datos["lineas_gastos"]:
        cur.execute(
            """
            INSERT INTO ventas_gastos (factura_id, concepto, importe)
            VALUES (?, ?, ?)
            """,
            (factura_id, gst["concepto"], gst["importe"]),
        )

    conn.commit()
    return factura_id
