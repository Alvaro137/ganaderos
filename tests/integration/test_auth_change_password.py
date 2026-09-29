"""Tests del endpoint de cambio de contraseña compartida (owner-only).

Sandbox: parchea `_buscar_archivo_sqlite` a None (lifespan sin tocar el demo) y
`_REPO_ROOT` a un tmp_path (el `.env` escrito por `_set_password` es efímero).
"""
import importlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

appmod = importlib.import_module("src.server.app")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Evitar que el lifespan escriba sobre el demo real de la máquina
    monkeypatch.setattr(appmod, "_buscar_archivo_sqlite", lambda: None)
    # _set_password persiste el .env aquí (efímero) y nada toca prod
    monkeypatch.setattr(appmod, "_REPO_ROOT", str(tmp_path))
    monkeypatch.setenv("PWA_PASSWORD", "mvp-testing")
    with TestClient(appmod.app) as c:
        yield c


def _token(client, user_id="usr_admin"):
    resp = client.post("/api/auth/login", json={"password": "mvp-testing", "user_id": user_id})
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def test_change_password_ok_runtime_and_persistence(client, tmp_path):
    token = _token(client)
    resp = client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "mvp-testing", "new_password": "campoNuevo123"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True

    # La nueva password funciona en runtime...
    r_new = client.post("/api/auth/login", json={"password": "campoNuevo123", "user_id": "usr_admin"})
    assert r_new.status_code == 200

    # ...y la vieja deja de funcionar
    r_old = client.post("/api/auth/login", json={"password": "mvp-testing", "user_id": "usr_admin"})
    assert r_old.status_code == 401

    # ...y quedó persistida en .env (efímero, en tmp_path)
    env_file = Path(tmp_path) / ".env"
    assert env_file.exists()
    assert 'PWA_PASSWORD="campoNuevo123"' in env_file.read_text()


def test_change_password_actual_incorrecto(client):
    token = _token(client)
    resp = client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "papanoel", "new_password": "campoNuevo123"},
    )
    assert resp.status_code == 401


def test_change_password_new_corta_rechazada(client):
    token = _token(client)
    resp = client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "mvp-testing", "new_password": "abc"},
    )
    assert resp.status_code == 422  # validación Pydantic min_length=8


def test_change_password_identica_rechazada(client):
    token = _token(client)
    resp = client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "mvp-testing", "new_password": "mvp-testing"},
    )
    assert resp.status_code == 400


def test_change_password_solo_admin(client):
    token = _token(client, user_id="usr_jose")
    resp = client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={"current_password": "mvp-testing", "new_password": "campoNuevo123"},
    )
    assert resp.status_code == 403


def test_change_password_requires_auth(client):
    resp = client.post(
        "/api/auth/change-password",
        json={"current_password": "mvp-testing", "new_password": "campoNuevo123"},
    )
    assert resp.status_code == 401


def test_e2e_token_backdoor_gate(client, monkeypatch):
    from src.server.app import extraer_datos_token

    # Sin APP_ENV => rechazado
    monkeypatch.delenv("APP_ENV", raising=False)
    assert extraer_datos_token("e2e-valid-auth-token") is None

    # Con APP_ENV=production => rechazado
    monkeypatch.setenv("APP_ENV", "production")
    assert extraer_datos_token("e2e-valid-auth-token") is None

    # Con APP_ENV=e2e => permitido
    monkeypatch.setenv("APP_ENV", "e2e")
    datos = extraer_datos_token("e2e-valid-auth-token")
    assert datos is not None
    assert datos["user_id"] == "usr_admin"

    # Con APP_ENV=test => permitido
    monkeypatch.setenv("APP_ENV", "test")
    assert extraer_datos_token("e2e-valid-auth-token") is not None


def test_login_pin_removido(client):
    # El endpoint legado /api/auth/login-pin debe dar 404/405
    resp = client.post("/api/auth/login-pin", json={"user_id": "usr_admin", "pin": "1234"})
    assert resp.status_code in (404, 405)
