"""Tests unitarios para el webhook de ingesta automática de facturas GANAVAEX."""
from __future__ import annotations

import os
import shutil
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.server.app import app, recargar_servicios_dominio

client = TestClient(app)
WEBHOOK_SECRET = "test-webhook-secret-12345"


@pytest.fixture(autouse=True)
def setup_env_and_db(tmp_path: Path):
    demo_orig = Path(__file__).resolve().parents[2] / "pwa" / "ganaderos_demo.sqlite"
    temp_db = tmp_path / "ganaderos_test_webhook.sqlite"
    shutil.copy2(demo_orig, temp_db)

    old_db = os.environ.get("GANADEROS_DB_PATH")
    old_secret = os.environ.get("GANAVAEX_WEBHOOK_SECRET")

    os.environ["GANADEROS_DB_PATH"] = str(temp_db)
    os.environ["GANAVAEX_WEBHOOK_SECRET"] = WEBHOOK_SECRET
    recargar_servicios_dominio(app, temp_db)

    yield temp_db

    if old_db:
        os.environ["GANADEROS_DB_PATH"] = old_db
    else:
        os.environ.pop("GANADEROS_DB_PATH", None)

    if old_secret:
        os.environ["GANAVAEX_WEBHOOK_SECRET"] = old_secret
    else:
        os.environ.pop("GANAVAEX_WEBHOOK_SECRET", None)

    recargar_servicios_dominio(app)


def test_webhook_unauthorized_without_secret():
    resp = client.post("/api/ventas/webhook-ganavaex", content=b"%PDF-1.4 dummy")
    assert resp.status_code == 401
    assert "inválido o ausente" in resp.json()["detail"]


def test_webhook_unauthorized_with_wrong_secret():
    resp = client.post(
        "/api/ventas/webhook-ganavaex",
        headers={"X-Webhook-Secret": "wrong-secret"},
        content=b"%PDF-1.4 dummy",
    )
    assert resp.status_code == 401


def test_webhook_rejects_empty_file():
    resp = client.post(
        "/api/ventas/webhook-ganavaex",
        headers={"X-Webhook-Secret": WEBHOOK_SECRET},
        content=b"",
    )
    assert resp.status_code == 400
    assert "vacío" in resp.json()["detail"]


def test_webhook_rejects_non_pdf():
    resp = client.post(
        "/api/ventas/webhook-ganavaex",
        headers={"X-Webhook-Secret": WEBHOOK_SECRET},
        content=b"esto no es un pdf",
    )
    assert resp.status_code == 400
    assert "PDF válido" in resp.json()["detail"]


def test_webhook_successful_ingestion_and_epoch_increment(setup_env_and_db: Path):
    db_path = setup_env_and_db

    conn = sqlite3.connect(str(db_path))
    epoch_antes = conn.execute("SELECT epoch FROM _sync_estado WHERE id = 1").fetchone()[0]
    conn.close()

    mock_datos = {
        "numero_factura": "FAC-TEST-2026-99",
        "fecha_factura": "2026-10-15",
        "fecha_pago": "2026-10-20",
        "cliente_cooperativa": "GANAVAEX, S.COOP",
        "cif_cliente": "F37335411",
        "total_cabezas": 5.0,
        "total_kilos_canal": 1650.0,
        "base_imponible": 8500.0,
        "porcentaje_iva": 10.5,
        "cuota_iva": 892.5,
        "gastos_total": 120.0,
        "total_factura": 9272.5,
        "archivo_origen": "factura_99.pdf",
        "lineas_animales": [
            {
                "linea_numero": 1,
                "articulo": "TERNERO CEBO",
                "cabezas": 1.0,
                "peso_canal_kg": 330.0,
                "precio_unitario": 5.15,
                "importe_linea": 1699.5,
                "referencia": "LOTE-1",
            }
        ],
        "lineas_gastos": [],
    }

    dummy_pdf = b"%PDF-1.4\n%synthetic-test-pdf\n%%EOF"

    with patch("src.server.app.parsear_factura_pdf", return_value=mock_datos), \
         patch("src.server.app.guardar_factura_en_vault", return_value={"ok": True, "committed": True}):
        resp = client.post(
            "/api/ventas/webhook-ganavaex",
            headers={"X-Webhook-Secret": WEBHOOK_SECRET, "X-Filename": "factura_99.pdf"},
            content=dummy_pdf,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["numero_factura"] == "FAC-TEST-2026-99"
    assert data["total_cabezas"] == 5.0
    assert data["vault_archivado"] is True

    # Verificar que el epoch subió
    conn = sqlite3.connect(str(db_path))
    epoch_despues = conn.execute("SELECT epoch FROM _sync_estado WHERE id = 1").fetchone()[0]
    conn.close()
    assert epoch_despues == epoch_antes + 1
