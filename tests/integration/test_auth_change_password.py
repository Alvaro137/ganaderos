"""Tests del endpoint de cambio de contraseña compartida (owner-only).

Sandbox: parchea `_buscar_archivo_sqlite` a None (lifespan sin tocar el demo) y
`_REPO_ROOT` a un directorio temporal efímero.
"""
import importlib
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

appmod = importlib.import_module("src.server.app")


class TestAuthChangePassword(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="auth_pwd_test_"))
        self._patch_buscar = patch.object(appmod, "_buscar_archivo_sqlite", return_value=None)
        self._patch_repo = patch.object(appmod, "_REPO_ROOT", str(self.tmp))
        self._patch_buscar.start()
        self._patch_repo.start()

        self._orig_pwd = os.environ.get("PWA_PASSWORD")
        os.environ["PWA_PASSWORD"] = "mvp-testing"

        self.client = TestClient(appmod.app)

    def tearDown(self):
        self._patch_buscar.stop()
        self._patch_repo.stop()
        if self._orig_pwd is not None:
            os.environ["PWA_PASSWORD"] = self._orig_pwd
        else:
            os.environ.pop("PWA_PASSWORD", None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _token(self, user_id="usr_admin"):
        resp = self.client.post("/api/auth/login", json={"password": "mvp-testing", "user_id": user_id})
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()["token"]

    def test_change_password_ok_runtime_and_persistence(self):
        token = self._token()
        resp = self.client.post(
            "/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "mvp-testing", "new_password": "campoNuevo123"},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertTrue(resp.json()["ok"])

        # La nueva password funciona en runtime...
        r_new = self.client.post("/api/auth/login", json={"password": "campoNuevo123", "user_id": "usr_admin"})
        self.assertEqual(r_new.status_code, 200)

        # ...y la vieja deja de funcionar
        r_old = self.client.post("/api/auth/login", json={"password": "mvp-testing", "user_id": "usr_admin"})
        self.assertEqual(r_old.status_code, 401)

        # ...y quedó persistida en .env efímero
        env_file = self.tmp / ".env"
        self.assertTrue(env_file.exists())
        self.assertIn('PWA_PASSWORD="campoNuevo123"', env_file.read_text(encoding="utf-8"))

    def test_change_password_actual_incorrecto(self):
        token = self._token()
        resp = self.client.post(
            "/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "papanoel", "new_password": "campoNuevo123"},
        )
        self.assertEqual(resp.status_code, 401)

    def test_change_password_new_corta_rechazada(self):
        token = self._token()
        resp = self.client.post(
            "/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "mvp-testing", "new_password": "abc"},
        )
        self.assertEqual(resp.status_code, 422)

    def test_change_password_identica_rechazada(self):
        token = self._token()
        resp = self.client.post(
            "/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "mvp-testing", "new_password": "mvp-testing"},
        )
        self.assertEqual(resp.status_code, 400)

    def test_change_password_solo_admin(self):
        token = self._token(user_id="usr_jose")
        resp = self.client.post(
            "/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"current_password": "mvp-testing", "new_password": "campoNuevo123"},
        )
        self.assertEqual(resp.status_code, 403)

    def test_change_password_requires_auth(self):
        resp = self.client.post(
            "/api/auth/change-password",
            json={"current_password": "mvp-testing", "new_password": "campoNuevo123"},
        )
        self.assertEqual(resp.status_code, 401)

    def test_e2e_token_backdoor_gate(self):
        from src.server.app import extraer_datos_token

        orig_env = os.environ.get("APP_ENV")
        try:
            # Sin APP_ENV => rechazado
            os.environ.pop("APP_ENV", None)
            self.assertIsNone(extraer_datos_token("e2e-valid-auth-token"))

            # Con APP_ENV=production => rechazado
            os.environ["APP_ENV"] = "production"
            self.assertIsNone(extraer_datos_token("e2e-valid-auth-token"))

            # Con APP_ENV=e2e => permitido
            os.environ["APP_ENV"] = "e2e"
            datos = extraer_datos_token("e2e-valid-auth-token")
            self.assertIsNotNone(datos)
            self.assertEqual(datos["user_id"], "usr_admin")

            # Con APP_ENV=test => permitido
            os.environ["APP_ENV"] = "test"
            self.assertIsNotNone(extraer_datos_token("e2e-valid-auth-token"))
        finally:
            if orig_env is not None:
                os.environ["APP_ENV"] = orig_env
            else:
                os.environ.pop("APP_ENV", None)

    def test_login_pin_removido(self):
        # El endpoint legado /api/auth/login-pin debe dar 404/405
        resp = self.client.post("/api/auth/login-pin", json={"user_id": "usr_admin", "pin": "1234"})
        self.assertIn(resp.status_code, (404, 405))
