"""Tests unitarios para el script de conciliación PC <-> Access (sync_access_merge.py)."""
import json
import tempfile
import unittest
import urllib.error
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from scripts.sync_access_merge import (
    AccessReconciliationError,
    autenticar_hub,
    conciliar_partos_en_access,
    crear_backup,
    notificar_conciliacion,
    obtener_pendientes,
)


class TestSyncAccessMerge(unittest.TestCase):
    def test_crear_backup(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_file = Path(tmpdir) / "bdlibro.mdb"
            db_file.write_text("fake access content")

            backup = crear_backup(db_file)
            self.assertTrue(backup.exists())
            self.assertEqual(backup.parent.name, "backups")
            self.assertIn("bdlibro_backup_", backup.name)
            self.assertEqual(backup.read_text(), "fake access content")

    @patch("urllib.request.urlopen")
    def test_autenticar_hub_exitoso(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"token": "jwt-token-123"}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        token = autenticar_hub("http://localhost:8010", "mvp-testing")
        self.assertEqual(token, "jwt-token-123")

    @patch("urllib.request.urlopen")
    def test_autenticar_hub_error_credenciales(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="http://localhost:8010",
            code=401,
            msg="Unauthorized",
            hdrs={},
            fp=MagicMock(read=lambda: b"Contrase\xc3\xb1a incorrecta"),
        )
        with self.assertRaises(AccessReconciliationError) as ctx:
            autenticar_hub("http://localhost:8010", "password-erronea")
        self.assertIn("HTTP 401", str(ctx.exception))

    @patch("urllib.request.urlopen")
    def test_obtener_pendientes(self, mock_urlopen):
        mock_resp = MagicMock()
        pendientes_mock = [
            {"uuid": "u1", "tipo": "parto", "crotal": "ES012345678901"}
        ]
        mock_resp.read.return_value = json.dumps({"ok": True, "pendientes": pendientes_mock}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        res = obtener_pendientes("http://localhost:8010", "token-x", tipo="parto")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["uuid"], "u1")

    @patch("urllib.request.urlopen")
    def test_notificar_conciliacion(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"ok": True, "actualizados": 2}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        conciliados = [
            {"uuid": "u1", "crotal_asignado": "ES220800857601"},
            {"uuid": "u2", "crotal_asignado": "ES220800857602"},
        ]
        n = notificar_conciliacion("http://localhost:8010", "token-x", conciliados)
        self.assertEqual(n, 2)

    @patch("pyodbc.connect")
    def test_conciliar_partos_en_access_flujo_completo(self, mock_pyodbc):
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_pyodbc.return_value = mock_conn

        # Mock de consultas:
        # 1. Crotales libres
        # 2. Localizar madre
        # 3. @@IDENTITY para cod_movi
        mock_cur.fetchall.side_effect = [
            [("ES220800857601", "ES371261100121"), ("ES220800857602", "ES371261100121")],
        ]
        mock_cur.fetchone.side_effect = [
            ("ES090810288379", "0000", "DUEÑA", "ES371261100121", "ES371261100121", datetime(2025, 4, 10)),  # madre
            (5665,),  # @@IDENTITY
        ]

        partos = [
            {
                "uuid": "uuid-parto-1",
                "crotal": "ES090810288379",
                "ts_dispositivo": "2026-10-17T10:00:00",
                "payload": {
                    "fecha_parto": "2026-10-17",
                    "cria_sexo": "H",
                    "cria_crotal": None,
                },
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            conciliados = conciliar_partos_en_access(db_path, "pwd", partos, dry_run=False)

            self.assertEqual(len(conciliados), 1)
            self.assertEqual(conciliados[0]["uuid"], "uuid-parto-1")
            self.assertEqual(conciliados[0]["crotal_asignado"], "ES220800857601")
            self.assertEqual(conciliados[0]["madre_crotal"], "ES090810288379")

            # Verifica que se hizo commit
            mock_conn.commit.assert_called_once()
            mock_conn.rollback.assert_not_called()

    @patch("pyodbc.connect")
    def test_conciliar_partos_dry_run_hace_rollback(self, mock_pyodbc):
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_pyodbc.return_value = mock_conn

        mock_cur.fetchall.side_effect = [
            [("ES220800857601", "ES371261100121")],
        ]
        mock_cur.fetchone.side_effect = [
            ("ES090810288379", "0000", "DUEÑA", "ES371261100121", "ES371261100121", None),
            (5665,),
        ]

        partos = [
            {
                "uuid": "uuid-parto-dry",
                "crotal": "ES090810288379",
                "payload": {"fecha_parto": "2026-10-17", "cria_sexo": "M"},
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            conciliados = conciliar_partos_en_access(db_path, "pwd", partos, dry_run=True)
            self.assertEqual(len(conciliados), 1)
            mock_conn.commit.assert_not_called()
            mock_conn.rollback.assert_called_once()

    @patch("pyodbc.connect")
    def test_conciliar_partos_sin_crotales_lanza_error(self, mock_pyodbc):
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur
        mock_pyodbc.return_value = mock_conn

        # Crotales libres VACÍO
        mock_cur.fetchall.side_effect = [
            [],
        ]
        mock_cur.fetchone.side_effect = [
            ("ES090810288379", "0000", "DUEÑA", "ES371261100121", "ES371261100121", None),
        ]

        partos = [
            {
                "uuid": "uuid-parto-sin-crotal",
                "crotal": "ES090810288379",
                "payload": {"fecha_parto": "2026-10-17", "cria_sexo": "H"},
            }
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "bdlibro.mdb"
            db_path.write_text("test")

            with self.assertRaises(AccessReconciliationError) as ctx:
                conciliar_partos_en_access(db_path, "pwd", partos)
            self.assertIn("No quedan crotales en la tabla Crotales", str(ctx.exception))
            mock_conn.rollback.assert_called_once()


if __name__ == "__main__":
    unittest.main()
