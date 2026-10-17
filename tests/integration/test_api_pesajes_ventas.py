"""Tests de integración aislados para endpoints de pesajes, tratamientos y conciliación MoGa."""
import io
import os
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.server.app import app, generar_auth_token, recargar_servicios_dominio


@pytest.fixture(autouse=True)
def setup_isolated_db(tmp_path: Path):
    """Copia la BD demo a una ubicación temporal para evitar mutar el archivo de producción."""
    demo_orig = Path(__file__).resolve().parents[2] / "pwa" / "ganaderos_demo.sqlite"
    temp_db = tmp_path / "ganaderos_test_isolated.sqlite"
    shutil.copy2(demo_orig, temp_db)

    old_env = os.environ.get("GANADEROS_DB_PATH")
    os.environ["GANADEROS_DB_PATH"] = str(temp_db)
    recargar_servicios_dominio(app, temp_db)

    yield temp_db

    if old_env is not None:
        os.environ["GANADEROS_DB_PATH"] = old_env
    else:
        os.environ.pop("GANADEROS_DB_PATH", None)
    recargar_servicios_dominio(app)


client = TestClient(app)
token = generar_auth_token(duracion_dias=1, user_id="usr_admin", rol="admin")
AUTH_HEADERS = {"Authorization": f"Bearer {token}"}


def test_api_pesajes_crud():
    # Registrar pesaje en BD temporal
    resp = client.post(
        "/api/censo/pesajes",
        headers=AUTH_HEADERS,
        json={
            "crotal": "ES083712611001",
            "fecha": "2026-03-15",
            "peso_kg": 310.5,
            "tipo": "Control",
            "notas": "Manga corral Dueña",
            "operador": "Álvaro",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["crotal"] == "ES083712611001"
    assert data["peso_kg"] == 310.5

    # Consultar pesajes
    resp_list = client.get("/api/censo/pesajes?crotal=ES083712611001", headers=AUTH_HEADERS)
    assert resp_list.status_code == 200
    items = resp_list.json()
    assert len(items) >= 1
    assert any(p["peso_kg"] == 310.5 for p in items)


def test_api_tratamientos_y_alerta():
    resp_trat = client.get("/api/censo/tratamientos?crotal=ES083712611001", headers=AUTH_HEADERS)
    assert resp_trat.status_code == 200
    assert isinstance(resp_trat.json(), list)

    resp_alerta = client.get("/api/censo/alerta-retirada/ES083712611001", headers=AUTH_HEADERS)
    assert resp_alerta.status_code == 200
    data_alerta = resp_alerta.json()
    assert "en_retirada" in data_alerta


def test_api_conciliar_moga():
    csv_content = b"""CROTAL;ESTADO;EXPLOTACION
ES083712611001;ALTA;ES371261100121
ES083712619999;ALTA;ES371261100122
"""
    files = {"file": ("censo_moga.csv", io.BytesIO(csv_content), "text/csv")}
    resp = client.post("/api/censo/conciliar-moga", headers=AUTH_HEADERS, files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "resumen" in data
    assert "no_en_moga" in data
