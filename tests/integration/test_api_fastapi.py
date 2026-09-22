import unittest

from fastapi.testclient import TestClient

from src.server.app import app


class TestFastAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_check(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "healthy", "service": "ganaderos-campo", "version": "2.0.0"})

    def test_auth_verify_unauthorized(self):
        # By default no token
        response = self.client.get("/api/auth/verify")
        # auto_error is False for security, so it returns None, thus authenticated is False
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["authenticated"])
