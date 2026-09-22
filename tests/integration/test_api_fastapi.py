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
        self.assertTrue(any(m["id"] == "offline" for m in data["models"]))

    def test_ai_synthesize_endpoint(self):
        payload = {
            "prompt": "¿Cuántas vacas hay en Dueña?",
            "data": [{"crotal_4": "1045", "corral": "DUEÑA"}],
            "model_id": "offline"
        }
        response = self.client.post("/api/ai/synthesize", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertIn("sintesis", data)
        self.assertIn("1", data["sintesis"])

    def test_ai_intent_endpoint(self):
        payload = {
            "prompt": "vaca 1045"
        }
        response = self.client.post("/api/ai/intent", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["args"].get("crotal_4"), "1045")
        self.assertIn("sql", data)
