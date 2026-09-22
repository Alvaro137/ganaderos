"""Tests unitarios para el script de verificación pre-vuelo de Edge."""

import tempfile
import unittest
from pathlib import Path

from scripts.verify_edge import (
    EdgeVerificationError,
    verificar_backup_engine,
    verificar_caddy_snippet,
    verificar_compose_prod,
    verificar_systemd_unit,
)


class TestVerifyEdge(unittest.TestCase):
    def test_verificar_caddy_valido(self):
        snippet = """
        handle /campo* {
            uri strip_prefix /campo
            reverse_proxy 127.0.0.1:8010
            header Service-Worker-Allowed "/campo/"
            header {
                X-Content-Type-Options nosniff
                X-Frame-Options DENY
            }
        }
        """
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".snippet", encoding="utf-8") as f:
            f.write(snippet)
            temp_path = Path(f.name)

        try:
            checks = verificar_caddy_snippet(temp_path)
            self.assertEqual(len(checks), 4)
        finally:
            temp_path.unlink()

    def test_verificar_caddy_invalido_falta_strip(self):
        snippet = "handle /campo* { reverse_proxy 127.0.0.1:8010 }"
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".snippet", encoding="utf-8") as f:
            f.write(snippet)
            temp_path = Path(f.name)

        try:
            with self.assertRaises(EdgeVerificationError):
                verificar_caddy_snippet(temp_path)
        finally:
            temp_path.unlink()

    def test_verificar_systemd_valido(self):
        unit = """
        [Service]
        Restart=always
        MemoryMax=350M
        Environment=APP_PORT=8010
        ExecStart=/usr/local/bin/uvicorn src.server.app:app --port 8010
        """
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".service", encoding="utf-8") as f:
            f.write(unit)
            temp_path = Path(f.name)

        try:
            checks = verificar_systemd_unit(temp_path)
            self.assertEqual(len(checks), 3)
        finally:
            temp_path.unlink()

    def test_verificar_systemd_falta_memoria(self):
        unit = "Restart=always\nAPP_PORT=8010"
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".service", encoding="utf-8") as f:
            f.write(unit)
            temp_path = Path(f.name)

        try:
            with self.assertRaises(EdgeVerificationError):
                verificar_systemd_unit(temp_path)
        finally:
            temp_path.unlink()

    def test_verificar_compose_valido(self):
        compose = """
        services:
          ganaderos-campo:
            ports:
              - "127.0.0.1:8010:8000"
            deploy:
              resources:
                limits:
                  cpus: '0.75'
                  memory: 256M
            healthcheck:
              test: ["CMD", "curl", "-f", "http://127.0.0.1:8000/api/health"]
        """
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".yaml", encoding="utf-8") as f:
            f.write(compose)
            temp_path = Path(f.name)

        try:
            checks = verificar_compose_prod(temp_path)
            self.assertEqual(len(checks), 3)
        finally:
            temp_path.unlink()

    def test_verificar_backup_engine_valido(self):
        backup_content = """
        src_conn.backup(dst_conn)
        gzip.open(...)
        def purgar_backups_antiguos(...):
        """
        with tempfile.NamedTemporaryFile("w+", delete=False, suffix=".py", encoding="utf-8") as f:
            f.write(backup_content)
            temp_path = Path(f.name)

        try:
            checks = verificar_backup_engine(temp_path)
            self.assertEqual(len(checks), 2)
        finally:
            temp_path.unlink()


if __name__ == "__main__":
    unittest.main()
