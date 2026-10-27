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
        self.assertTrue(len(data["models"]) >= 1)
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

    def test_censo_get_animal_por_crotal_success(self):
        # 1. Obtener un crotal real del listado
        list_resp = self.client.get("/api/censo/animales")
        self.assertEqual(list_resp.status_code, 200)
        animales = list_resp.json()
        if animales:
            crotal_real = animales[0]["crotal"]
            resp = self.client.get(f"/api/censo/animales/{crotal_real}")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["crotal"], crotal_real)
            self.assertIn("sexo", data)
            self.assertIn("raza", data)
            self.assertGreaterEqual(data["edad_anios"], 0)

    def test_censo_get_animal_no_encontrado_404(self):
        # Crotal sintácticamente válido (14 chars) pero inexistente en censo
        resp = self.client.get("/api/censo/animales/ES089999999999")
        self.assertEqual(resp.status_code, 404)
        self.assertIn("no encontrado", resp.json()["detail"])

    def test_censo_crotal_invalido_domain_error(self):
        response = self.client.get("/api/censo/animales/CROTAL_INVALIDO")
        self.assertEqual(response.status_code, 422)
        data = response.json()
        self.assertFalse(data["ok"])
        self.assertEqual(data["error"], "CrotalInvalidoError")
        self.assertIn("formato oficial", data["detail"])

    def test_database_download_authorized_and_security(self):
        # 1. Con descarga anónima activada
        os.environ["PWA_ALLOW_ANON_DB"] = "1"
        resp = self.client.get("/api/database")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("content-type"), "application/octet-stream")
        self.assertEqual(
            resp.headers.get("cache-control"), "no-store, no-cache, must-revalidate, max-age=0"
        )
        self.assertIn("ganaderos_campo.sqlite", resp.headers.get("content-disposition", ""))
        self.assertGreater(len(resp.content), 1024)

        # 2. Con descarga anónima desactivada -> exige token Bearer
        os.environ["PWA_ALLOW_ANON_DB"] = "0"
        try:
            unauth_resp = self.client.get("/api/database")
            self.assertEqual(unauth_resp.status_code, 401)

            # Proporcionar token válido
            login_resp = self.client.post("/api/auth/login", json={"password": "mvp-testing"})
            token = login_resp.json()["token"]
            auth_resp = self.client.get("/api/database", headers={"Authorization": f"Bearer {token}"})
            self.assertEqual(auth_resp.status_code, 200)
            self.assertGreater(len(auth_resp.content), 1024)
        finally:
            os.environ["PWA_ALLOW_ANON_DB"] = "1"

    def test_auth_login_success_and_token_validation(self):
        # 1. Login exitoso con la contraseña compartida y operador seleccionado
        login_resp = self.client.post(
            "/api/auth/login", json={"password": "mvp-testing", "user_id": "usr_jose"}
        )
        self.assertEqual(login_resp.status_code, 200)
        data = login_resp.json()
        token = data["token"]
        self.assertIn(".", token)
        self.assertEqual(data["user"]["id"], "usr_jose")

        # 2. Login sin user_id -> operador por defecto (Álvaro, admin)
        default_resp = self.client.post("/api/auth/login", json={"password": "mvp-testing"})
        self.assertEqual(default_resp.status_code, 200)
        self.assertEqual(default_resp.json()["user"]["id"], "usr_admin")

        # 2b. Login con 'ganaderos'
        ganaderos_resp = self.client.post("/api/auth/login", json={"password": "ganaderos"})
        self.assertEqual(ganaderos_resp.status_code, 200)
        self.assertEqual(ganaderos_resp.json()["user"]["id"], "usr_admin")

        # 3. Verificación de token legítimo
        headers = {"Authorization": f"Bearer {token}"}
        verify_resp = self.client.get("/api/auth/verify", headers=headers)
        self.assertEqual(verify_resp.status_code, 200)
        self.assertTrue(verify_resp.json()["authenticated"])
        self.assertEqual(verify_resp.json()["user"]["id"], "usr_jose")

        # 4. Verificación de token manipulado / firma inválida
        tampered_token = token[:-4] + "ffff"
        verify_bad = self.client.get(
            "/api/auth/verify", headers={"Authorization": f"Bearer {tampered_token}"}
        )
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
        self.assertGreaterEqual(len(users), 5)
        user_ids = [u["id"] for u in users]
        self.assertIn("usr_admin", user_ids)
        self.assertIn("usr_jose", user_ids)
        self.assertIn("usr_amelia", user_ids)
        self.assertIn("usr_alex", user_ids)
        self.assertIn("usr_otro", user_ids)
        self.assertNotIn("usr_paco", user_ids)
        self.assertNotIn("usr_vet", user_ids)
        # Álvaro es el único admin; el resto comparten rol 'operador'
        roles = {u["id"]: u["rol"] for u in users}
        self.assertEqual(roles["usr_admin"], "admin")
        for uid in ("usr_jose", "usr_amelia", "usr_alex", "usr_otro"):
            self.assertEqual(roles[uid], "operador")

    def test_ai_transcribe_payload_too_large(self):
        # Simular fichero de audio mayor a 10MB
        huge_content = b"0" * (10 * 1024 * 1024 + 1024)
        files = {"file": ("big_audio.webm", huge_content, "audio/webm")}
        response = self.client.post("/api/ai/transcribe", files=files)
        self.assertEqual(response.status_code, 413)
        self.assertIn("supera el límite", response.json()["detail"])

    def test_admin_logs_sin_token_es_401(self):
        resp = self.client.get("/api/admin/logs")
        self.assertEqual(resp.status_code, 401)

    def test_admin_logs_operador_normal_es_403(self):
        token_jose = self.client.post("/api/auth/login", json={"password": "mvp-testing", "user_id": "usr_jose"}).json()["token"]
        resp = self.client.get("/api/admin/logs", headers={"Authorization": f"Bearer {token_jose}"})
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Solo el administrador", resp.json()["detail"])

    def test_admin_logs_admin_success(self):
        token_admin = self.client.post("/api/auth/login", json={"password": "mvp-testing", "user_id": "usr_admin"}).json()["token"]
        resp = self.client.get("/api/admin/logs?lines=50", headers={"Authorization": f"Bearer {token_admin}"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["ok"])
        self.assertIn("current_level", data)
        self.assertIn("log_dir", data)
        self.assertIsInstance(data["logs"], list)

    def test_admin_logs_level_change(self):
        token_admin = self.client.post("/api/auth/login", json={"password": "mvp-testing", "user_id": "usr_admin"}).json()["token"]
        # Cambiar a DEBUG
        resp = self.client.post("/api/admin/logs/level", json={"level": "DEBUG"}, headers={"Authorization": f"Bearer {token_admin}"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["new_level"], "DEBUG")

        # Restaurar a INFO
        resp_info = self.client.post("/api/admin/logs/level", json={"level": "INFO"}, headers={"Authorization": f"Bearer {token_admin}"})
        self.assertEqual(resp_info.status_code, 200)
        self.assertEqual(resp_info.json()["new_level"], "INFO")

        # Nivel inválido -> 422
        resp_bad = self.client.post("/api/admin/logs/level", json={"level": "NIVEL_INVALIDO"}, headers={"Authorization": f"Bearer {token_admin}"})
        self.assertEqual(resp_bad.status_code, 422)

    def test_database_meta_endpoint(self):
        resp = self.client.get("/api/database/meta")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["ok"])
        self.assertIn("mtime", data)
        self.assertIn("mtime_iso", data)
        self.assertIn("size_bytes", data)
        self.assertIn("filename", data)
        self.assertIsInstance(data["mtime"], int)
        self.assertEqual(
            resp.headers.get("cache-control"), "no-store, no-cache, must-revalidate, max-age=0"
        )
        self.assertGreater(data["size_bytes"], 0)

    def test_lonja_sync_endpoint(self):
        from unittest.mock import patch
        token = self.client.post("/api/auth/login", json={"password": "mvp-testing", "user_id": "usr_admin"}).json()["token"]
        with patch("scripts.sync_lonjas.sincronizar_cotizaciones_lonja", return_value=12):
            resp = self.client.post("/api/lonja/sync", headers={"Authorization": f"Bearer {token}"})
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data["ok"])
            self.assertEqual(data["registros"], 12)
            self.assertIn("12 cotizaciones", data["message"])

    def test_gzip_compression_on_large_responses(self):
        """Verifica que respuestas > 1000 bytes se compriman con gzip al solicitarlo."""
        resp = self.client.get("/api/censo/animales", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("content-encoding"), "gzip")
        self.assertIn("Accept-Encoding", resp.headers.get("vary", ""))

    def test_gzip_bypassed_for_small_responses(self):
        """Verifica que respuestas < 1000 bytes no se compriman aunque se solicite gzip."""
        resp = self.client.get("/api/health", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.headers.get("content-encoding"))

    def test_gzip_bypassed_when_identity_requested(self):
        """Verifica que con Accept-Encoding: identity la respuesta no se comprime."""
        resp = self.client.get("/api/censo/animales", headers={"Accept-Encoding": "identity"})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.headers.get("content-encoding"))

    def test_database_download_gzip_streaming_and_clean_decompression(self):
        """Verifica que la descarga de la base de datos se comprima y descomprima limpiamente."""
        os.environ["PWA_ALLOW_ANON_DB"] = "1"
        resp = self.client.get("/api/database", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("content-encoding"), "gzip")
        self.assertTrue(resp.content.startswith(b"SQLite format 3\x00"))
        self.assertGreaterEqual(len(resp.content), 1000)


