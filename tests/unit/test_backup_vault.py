"""Tests unitarios para la infraestructura de Git Backup Vault."""
import os
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.infrastructure.backup_vault import (
    asegurar_repositorio_vault,
    generar_sql_dump,
    guardar_snapshot_en_vault,
    resolver_directorio_vault,
)


class TestBackupVault(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault_test_"))

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_resolver_directorio_vault(self):
        custom = self.tmp / "mi-vault"
        res = resolver_directorio_vault(custom)
        self.assertEqual(res, custom.resolve())

        with patch.dict(os.environ, {"GANADEROS_VAULT_DIR": str(custom)}):
            res_env = resolver_directorio_vault(None)
            self.assertEqual(res_env, custom.resolve())

    def test_generar_sql_dump(self):
        db_path = self.tmp / "test.sqlite"
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE vacas (id INTEGER PRIMARY KEY, crotal TEXT)")
        conn.execute("INSERT INTO vacas (crotal) VALUES ('ES090810288379')")
        conn.commit()
        conn.close()

        dump_path = self.tmp / "dumps" / "censo.sql"
        generar_sql_dump(db_path, dump_path)

        self.assertTrue(dump_path.exists())
        contenido = dump_path.read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE vacas", contenido)
        self.assertIn("ES090810288379", contenido)

    def test_asegurar_repositorio_vault(self):
        vault_dir = self.tmp / "local_vault"
        asegurar_repositorio_vault(vault_dir, remote_url="https://example.com/vault.git")

        self.assertTrue((vault_dir / ".git").exists())
        res_remote = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=str(vault_dir),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(res_remote.returncode, 0)
        self.assertIn("example.com/vault.git", res_remote.stdout)

    def test_guardar_snapshot_en_vault_completo(self):
        vault_dir = self.tmp / "local_vault"

        # Crear archivos dummy de base de datos
        db_access = self.tmp / "bdlibro.mdb"
        db_access.write_text("fake mdb content")

        db_sqlite = self.tmp / "campo.sqlite"
        conn = sqlite3.connect(db_sqlite)
        conn.execute("CREATE TABLE test (x INTEGER)")
        conn.execute("INSERT INTO test VALUES (42)")
        conn.commit()
        conn.close()

        # Configurar git localmente para evitar fallos de identity en CI
        asegurar_repositorio_vault(vault_dir, remote_url="https://example.com/vault.git")
        subprocess.run(["git", "config", "user.name", "Tester"], cwd=str(vault_dir), check=False)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=str(vault_dir), check=False)

        res = guardar_snapshot_en_vault(
            vault_dir=vault_dir,
            access_path=db_access,
            sqlite_path=db_sqlite,
            mensaje="backup: test snapshot",
            push=False,
        )

        self.assertTrue(res["ok"])
        self.assertTrue(res["cambios"])
        self.assertIsNotNone(res["commit"])
        self.assertTrue((vault_dir / "access" / "bdlibro.mdb").exists())
        self.assertTrue((vault_dir / "sqlite" / "ganaderos_campo.sqlite").exists())
        self.assertTrue((vault_dir / "dumps" / "censo_dump.sql").exists())
        self.assertTrue((vault_dir / "README.md").exists())

        # Segundo snapshot idéntico -> cambios: False
        res2 = guardar_snapshot_en_vault(
            vault_dir=vault_dir,
            access_path=db_access,
            sqlite_path=db_sqlite,
            mensaje="backup: snapshot repetido",
            push=False,
        )
        self.assertTrue(res2["ok"])
        self.assertFalse(res2["cambios"])
        self.assertIsNone(res2["commit"])

    @patch("subprocess.run")
    def test_guardar_snapshot_push_error_manejado(self, mock_run):
        vault_dir = self.tmp / "vault"
        vault_dir.mkdir(parents=True)
        (vault_dir / ".git").mkdir()

        # Simular respuestas git
        def mock_git(cmd, **kwargs):
            m = MagicMock()
            m.returncode = 0
            m.stdout = ""
            m.stderr = ""
            if "status" in cmd:
                m.stdout = "M access/bdlibro.mdb\n"
            elif "rev-parse" in cmd:
                m.stdout = "abc1234567\n"
            elif "push" in cmd:
                m.returncode = 1
                m.stderr = "Permission denied (publickey)"
            return m

        mock_run.side_effect = mock_git

        res = guardar_snapshot_en_vault(
            vault_dir=vault_dir,
            access_path=None,
            sqlite_path=None,
            mensaje="test",
            push=True,
        )
        self.assertTrue(res["ok"])
        self.assertFalse(res["pushed"])
        self.assertIn("Permission denied", res["message"])


if __name__ == "__main__":
    unittest.main()
