"""Tests unitarios para el parser e ingestor de liquidaciones PDF (GANAVAEX)."""
from pathlib import Path

from src.application.sales_ingestion_service import (
    _parse_float,
    parsear_factura_pdf,
    parsear_todas_las_facturas_pdf,
)


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
        pdf_path = Path(__file__).resolve().parents[2] / "Example-data" / "fras" / "Factura G015-3 08-04-2026.pdf"
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


def test_parsear_factura_multi_pagina_real():
    pdf_path = Path(__file__).resolve().parents[2] / "Example-data" / "fras" / "Facturas 1-747 22-10-2025, 1-759 22-10-2025.pdf"
    if not pdf_path.exists():
        return

    todas = parsear_todas_las_facturas_pdf(pdf_path)
    assert len(todas) == 2

    # Factura 1/747 (Vaca desvieje)
    fra1 = todas[0]
    assert fra1["numero_factura"] == "1 / 747"
    assert fra1["base_imponible"] == 2375.00
    assert len(fra1["lineas_animales"]) == 1
    assert fra1["lineas_animales"][0]["articulo"] == "VACAS O TOROS"
    assert fra1["lineas_animales"][0]["peso_canal_kg"] == 454.0

    # Factura 1/759 (Terneros y terneras cebo con penalización >350kg)
    fra2 = todas[1]
    assert fra2["numero_factura"] == "1 / 759"
    assert fra2["base_imponible"] == 14664.43
    assert len(fra2["lineas_animales"]) == 8
    conceptos_gastos = [g["concepto"] for g in fra2["lineas_gastos"]]
    assert any("ANIMAL >350 KG" in c for c in conceptos_gastos)


def test_parsear_factura_historica_2024():
    pdf_path = Path(__file__).resolve().parents[2] / "Example-data" / "fras" / "Factura 1-1024 04-12-2024.pdf"
    if not pdf_path.exists():
        return

    res = parsear_factura_pdf(pdf_path)
    assert res["numero_factura"] == "1 / 1024"
    assert res["fecha_factura"] == "2024-12-04"
    assert res["base_imponible"] == 12103.23
    assert len(res["lineas_animales"]) == 7
    # Comprobar canales pesadas y gastos de transporte y sobrepeso
    pesos = [lin["peso_canal_kg"] for lin in res["lineas_animales"]]
    assert 290.0 in pesos
    assert 362.0 in pesos
