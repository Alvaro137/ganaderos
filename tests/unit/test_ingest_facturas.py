"""Pruebas unitarias para la ingesta de liquidaciones y pesos de canal (GANAVAEX)."""
import sqlite3
from pathlib import Path

from scripts.ingest_facturas_ganavaex import (
    SCHEMA_SQL,
    extraer_datos_pdf,
    insertar_factura_en_bd,
    normalizar_fecha_iso,
    parse_float,
)


def test_parse_float():
    assert parse_float("1,725.72") == 1725.72
    assert parse_float("219.000") == 219.0
    assert parse_float("-80.00") == -80.0
    assert parse_float("") is None
    assert parse_float(None) is None
    assert parse_float("invalido") is None


def test_normalizar_fecha_iso():
    assert normalizar_fecha_iso("08/04/2026") == "2026-04-08"
    assert normalizar_fecha_iso("04/02/2026") == "2026-02-04"
    assert normalizar_fecha_iso(None) is None
    assert normalizar_fecha_iso("fecha-erronea") is None


def test_extraer_datos_pdf():
    pdf_ejemplo = Path(__file__).resolve().parents[2] / "Example-data" / "Factura G015-3 08-04-2026.pdf"
    assert pdf_ejemplo.exists(), f"No se encontró {pdf_ejemplo}"

    datos = extraer_datos_pdf(pdf_ejemplo)
    assert datos["numero_factura"] == "G015 / 3"
    assert datos["fecha_factura"] == "2026-04-08"
    assert datos["cliente_cooperativa"] == "GANAVAEX, S.COOP"
    assert datos["cif_cliente"] == "F37335411"
    assert datos["total_factura"] == 20486.59
    assert datos["base_imponible"] == 18918.26
    assert datos["porcentaje_iva"] == 10.50

    # 11 terneras cebo
    assert len(datos["lineas_animales"]) == 11
    primera_linea = datos["lineas_animales"][0]
    assert primera_linea["articulo"] == "TERNERA CEBO"
    assert primera_linea["cabezas"] == 1.0
    assert primera_linea["peso_canal_kg"] == 219.0
    assert primera_linea["precio_unitario"] == 7.88
    assert primera_linea["importe_linea"] == 1725.72

    # Gastos y deducciones
    assert len(datos["lineas_gastos"]) >= 3
    gastos_conceptos = [g["concepto"] for g in datos["lineas_gastos"]]
    assert any("PORTES" in c for c in gastos_conceptos)
    assert any("GASTOS" in c for c in gastos_conceptos)


def test_insercion_y_campos_opcionales():
    """Valida que los pesos, precios y crotales sean opcionales y admitan NULL."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA_SQL)

    # Inserción con todos los datos
    factura_completa = {
        "numero_factura": "TEST-001",
        "fecha_factura": "2026-01-10",
        "fecha_pago": "2026-01-11",
        "cliente_cooperativa": "GANAVAEX, S.COOP",
        "cif_cliente": "F37335411",
        "total_cabezas": 2.0,
        "total_kilos_canal": 600.0,
        "base_imponible": 4500.0,
        "porcentaje_iva": 10.50,
        "cuota_iva": 472.50,
        "gastos_total": -100.0,
        "total_factura": 4872.50,
        "archivo_origen": "test.pdf",
        "lineas_animales": [
            {
                "linea_numero": 1,
                "articulo": "TERNERO CEBO",
                "importe_linea": 2250.0,
                "peso_canal_kg": 300.0,
                "precio_unitario": 7.50,
                "referencia": "01",
                "cabezas": 1.0,
            }
        ],
        "lineas_gastos": [{"concepto": "PORTES", "importe": -100.0}],
    }
    fid1 = insertar_factura_en_bd(conn, factura_completa)
    assert fid1 == 1

    # Inserción con datos históricos incompletos (sin peso, sin precio, sin crotal)
    factura_historica_sin_pesos = {
        "numero_factura": "HIST-1999",
        "fecha_factura": "1999-05-15",
        "fecha_pago": None,
        "cliente_cooperativa": "COOP_ANTIGUA",
        "cif_cliente": None,
        "total_cabezas": 5.0,
        "total_kilos_canal": None,  # No disponible en el histórico
        "base_imponible": None,
        "porcentaje_iva": 10.50,
        "cuota_iva": None,
        "gastos_total": None,
        "total_factura": None,
        "archivo_origen": None,
        "lineas_animales": [
            {
                "linea_numero": 1,
                "articulo": "VACAS O TOROS",
                "importe_linea": None,      # NULL
                "peso_canal_kg": None,      # NULL
                "precio_unitario": None,    # NULL
                "referencia": None,
                "cabezas": 1.0,
            }
        ],
        "lineas_gastos": [],
    }
    fid2 = insertar_factura_en_bd(conn, factura_historica_sin_pesos)
    assert fid2 == 2

    # Verificar que se consultan correctamente los valores nulos
    row = conn.execute(
        "SELECT total_kilos_canal, base_imponible FROM ventas_liquidaciones WHERE numero_factura = 'HIST-1999'"
    ).fetchone()
    assert row[0] is None
    assert row[1] is None

    row_canal = conn.execute(
        "SELECT peso_canal_kg, precio_unitario, importe_linea, crotal_asignado FROM ventas_canales WHERE factura_id = ?",
        (fid2,),
    ).fetchone()
    assert row_canal[0] is None
    assert row_canal[1] is None
    assert row_canal[2] is None
    assert row_canal[3] is None

    conn.close()
