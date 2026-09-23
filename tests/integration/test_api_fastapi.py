import os
import unittest

from fastapi.testclient import TestClient

from src.server.app import app


class TestFastAPI(unittest.TestCase):
    def setUp(self):
        os.environ["PWA_ALLOW_ANON_DB"] = "1"
        self.client = TestClient(app)

    def test_health_check(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "healthy", "service": "ganaderos-campo", "version": "2.0.0"})

    def test_auth_verify_unauthorized(self):
        response = self.client.get("/api/auth/verify")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["authenticated"])

    def test_ai_models_endpoint(self):
        response = self.client.get("/api/ai/models")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertTrue(any(m["id"] == "auto" for m in data["models"]))
        self.assertTrue(any("qwen" in m["id"] or "gemini" in m["id"] or "free" in m["id"] for m in data["models"]))
        self.assertTrue(all(m["id"] != "offline" for m in data["models"]))

    def test_ai_synthesize_endpoint(self):
        payload = {
            "prompt": "¿Cuántas vacas hay en Dueña?",
            "data": [{"crotal_4": "1045", "corral": "DUEÑA"}]
        }
        response = self.client.post("/api/ai/synthesize", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertIn("sintesis", data)
        self.assertIn("1", data["sintesis"])

    def test_ai_intent_endpoint_success(self):
        import sys
        from unittest.mock import patch
        app_mod = sys.modules["src.server.app"]
        with patch.object(app_mod, "resolver_intencion_usuario", return_value=("consultar_ficha_animal", {"crotal_4": "1045"}, False)):
            payload = {"prompt": "vaca 1045"}
            response = self.client.post("/api/ai/intent", json=payload)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertTrue(data["ok"])
            self.assertEqual(data["args"].get("crotal_4"), "1045")
            self.assertIn("sql", data)
            self.assertFalse(data["offline_mode"])

    def test_ai_intent_endpoint_service_unavailable(self):
        import sys
        from unittest.mock import patch
        app_mod = sys.modules["src.server.app"]
        with patch.object(app_mod, "resolver_intencion_usuario", return_value=(None, {}, False)):
            payload = {"prompt": "consulta sin conexion"}
            response = self.client.post("/api/ai/intent", json=payload)
            self.assertEqual(response.status_code, 503)
            self.assertIn("Servicio de inferencia LLM no disponible", response.json()["detail"])

    def test_censo_list_animales(self):
        response = self.client.get("/api/censo/animales")
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json(), list)

    def test_censo_crotal_invalido_domain_error(self):
        response = self.client.get("/api/censo/animales/CROTAL_INVALIDO")
        self.assertEqual(response.status_code, 422)
        data = response.json()
        self.assertFalse(data["ok"])
        self.assertEqual(data["error"], "CrotalInvalidoError")
        self.assertIn("formato oficial", data["detail"])

    def test_auth_login_success_and_token_validation(self):
        # 1. Login exitoso con contraseña por defecto
        login_resp = self.client.post("/api/auth/login", json={"password": "mvp-testing"})
        self.assertEqual(login_resp.status_code, 200)
        token = login_resp.json()["token"]
        self.assertIn(".", token)

        # 2. Verificación de token legítimo
        headers = {"Authorization": f"Bearer {token}"}
        verify_resp = self.client.get("/api/auth/verify", headers=headers)
        self.assertEqual(verify_resp.status_code, 200)
        self.assertTrue(verify_resp.json()["authenticated"])

        # 3. Verificación de token manipulado / firma inválida
        tampered_token = token[:-4] + "ffff"
        verify_bad = self.client.get("/api/auth/verify", headers={"Authorization": f"Bearer {tampered_token}"})
        self.assertEqual(verify_bad.status_code, 200)
        self.assertFalse(verify_bad.json()["authenticated"])

    def test_auth_login_failure(self):
        login_resp = self.client.post("/api/auth/login", json={"password": "password_incorrecta"})
        self.assertEqual(login_resp.status_code, 401)

    def test_auth_users_list(self):
        response = self.client.get("/api/auth/users")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        users = data["users"]
        self.assertGreaterEqual(len(users), 3)
        user_ids = [u["id"] for u in users]
        self.assertIn("usr_admin", user_ids)
        self.assertIn("usr_paco", user_ids)
        self.assertIn("usr_vet", user_ids)

    def test_auth_login_pin_success_and_verify(self):
        # Login de Paco con PIN por defecto '0000'
        login_resp = self.client.post("/api/auth/login-pin", json={"user_id": "usr_paco", "pin": "0000"})
        self.assertEqual(login_resp.status_code, 200)
        data = login_resp.json()
        self.assertTrue(data["ok"])
        self.assertIn("token", data)
        self.assertEqual(data["user"]["id"], "usr_paco")
        self.assertEqual(data["user"]["rol"], "vaquero")

        # Verificar token retornado
        token = data["token"]
        verify_resp = self.client.get("/api/auth/verify", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(verify_resp.status_code, 200)
        vdata = verify_resp.json()
        self.assertTrue(vdata["authenticated"])
        self.assertEqual(vdata["user"]["id"], "usr_paco")
        self.assertEqual(vdata["user"]["rol"], "vaquero")

    def test_auth_login_pin_failure(self):
        login_resp = self.client.post("/api/auth/login-pin", json={"user_id": "usr_paco", "pin": "9999"})
        self.assertEqual(login_resp.status_code, 401)
        self.assertIn("PIN incorrecto", login_resp.json()["detail"])

    def test_ai_transcribe_payload_too_large(self):
        # Simular fichero de audio mayor a 10MB
        huge_content = b"0" * (10 * 1024 * 1024 + 1024)
        files = {"file": ("big_audio.webm", huge_content, "audio/webm")}
        response = self.client.post("/api/ai/transcribe", files=files)
        self.assertEqual(response.status_code, 413)
        self.assertIn("supera el límite", response.json()["detail"])

