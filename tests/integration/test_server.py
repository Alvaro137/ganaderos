"""Tests de integración para el servidor HTTP y API Gateway."""
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from src.server.app import (
    PWAHandler,
    generar_auth_token,
    verificar_auth_token,
    verificar_password,
)


class MockPWARequest:
    def __init__(self, method="GET", path="/", headers=None, body=b""):
        self.method = method
        self.path = path
        self.headers = headers or {}
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()


class TestServerEndpoints(unittest.TestCase):
    def setUp(self):
        os.environ["PWA_PASSWORD"] = "test-secret-pass"
        os.environ["PWA_ALLOW_ANON_AI"] = "1"
        os.environ["PWA_ALLOW_ANON_DB"] = "1"

    def test_verificar_password(self):
        self.assertTrue(verificar_password("test-secret-pass"))
        self.assertFalse(verificar_password("wrong-pass"))

    def test_token_hmac_generacion_y_validacion(self):
        token = generar_auth_token(duracion_dias=1)
        self.assertTrue(verificar_auth_token(token))
        self.assertFalse(verificar_auth_token("token_invalido:123:abc"))

    def test_healthcheck_endpoint(self):
        handler = PWAHandler.__new__(PWAHandler)
        handler.path = "/api/health"
        handler.headers = {}
        handler.wfile = io.BytesIO()

        with patch.object(handler, "send_response") as mock_resp, \
             patch.object(handler, "send_header"), \
             patch.object(handler, "end_headers"):
            handler.do_GET()
            mock_resp.assert_called_with(200)

        data = json.loads(handler.wfile.getvalue().decode())
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["service"], "ganaderos-campo")

    def test_ai_intent_resolution_fallback_offline(self):
        handler = PWAHandler.__new__(PWAHandler)
        handler.path = "/api/ai/intent"
        handler.headers = {"Content-Length": "38"}
        handler.rfile = io.BytesIO(json.dumps({"prompt": "vaca 1045"}).encode())
        handler.wfile = io.BytesIO()

        with patch.object(handler, "esta_autenticado", return_value=True), \
             patch.object(handler, "send_response") as mock_resp, \
             patch.object(handler, "send_header"), \
             patch.object(handler, "end_headers"):
            handler.do_POST()
            mock_resp.assert_called_with(200)

        data = json.loads(handler.wfile.getvalue().decode())
        self.assertTrue(data["ok"])
        self.assertEqual(data["intent"], "consultar_ficha_animal")
        self.assertEqual(data["args"]["crotal_4"], "1045")
        self.assertIn("crotal_4 = ?", data["sql"])
        self.assertEqual(data["params"], ["1045"])
        self.assertTrue(data["offline_mode"])


if __name__ == "__main__":
    unittest.main()
