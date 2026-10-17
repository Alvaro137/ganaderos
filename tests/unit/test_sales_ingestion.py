"""Tests unitarios para el parser e ingestor de liquidaciones PDF (GANAVAEX)."""
from pathlib import Path

from src.application.sales_ingestion_service import _parse_float, parsear_factura_pdf


def test_parse_float_formats():
    # Formato anglosajón (coma miles, punto decimal)
    assert _parse_float("1,725.72") == 1725.72
    assert _parse_float("20,486.59") == 20486.59

    # Formato europeo (punto miles, coma decimal)
    assert _parse_float("1.725,72") == 1725.72
    assert _parse_float("12,50") == 12.50
    assert _parse_float("5,2") == 5.2

    # Solo enteros o punto decimal simple
    assert _parse_float("219.000") == 219.0
    assert _parse_float("7.880") == 7.88
    assert _parse_float("1.000") == 1.0

    # Nulos y vacíos
    assert _parse_float(None) is None
    assert _parse_float("") is None
    assert _parse_float("   ") is None


def test_parsear_factura_pdf_real():
    pdf_path = Path(__file__).resolve().parents[2] / "Example-data" / "Factura G015-3 08-04-2026.pdf"
    if not pdf_path.exists():
        return

    res = parsear_factura_pdf(pdf_path)
    assert res["numero_factura"] == "G015 / 3"
    assert res["fecha_factura"] == "2026-04-08"
    assert res["total_factura"] == 20486.59
    assert res["base_imponible"] == 18918.26
    assert len(res["lineas_animales"]) == 11
    assert all(lin["peso_canal_kg"] > 0 for lin in res["lineas_animales"])
    assert all(lin["precio_unitario"] > 0 for lin in res["lineas_animales"])
