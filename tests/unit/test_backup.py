"""Tests unitarios para el script de backup y rotación de bases de datos."""
import gzip
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from scripts.backup_db import purgar_backups_antiguos, realizar_backup


class TestBackupDB(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)
        self.db_path = self.base_path / "test_censo.sqlite"
        self.backup_dir = self.base_path / "backups"

        # Crear base de datos de prueba
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("CREATE TABLE animales (crotal TEXT PRIMARY KEY, nombre TEXT);")
            conn.execute("INSERT INTO animales VALUES ('ES083710104599', 'Estrella');")
            conn.commit()
        finally:
            conn.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_backup_exitoso_y_comprimido(self):
        backup_file = realizar_backup(
            db_path=self.db_path,
            backup_dir=self.backup_dir,
            retencion=5,
            comprimir=True,
        )
        self.assertIsNotNone(backup_file)
        self.assertTrue(backup_file.exists())
        self.assertTrue(backup_file.name.endswith(".sqlite.gz"))

        # Descomprimir y verificar integridad relacional
        with gzip.open(backup_file, "rb") as gz:
            descomprimido = gz.read()

        dest_test = self.base_path / "restored.sqlite"
        dest_test.write_bytes(descomprimido)

        conn = sqlite3.connect(dest_test)
        try:
            cur = conn.cursor()
            cur.execute("SELECT crotal, nombre FROM animales;")
            row = cur.fetchone()
            self.assertEqual(row, ("ES083710104599", "Estrella"))
        finally:
            conn.close()

    def test_backup_sin_compresion(self):
        backup_file = realizar_backup(
            db_path=self.db_path,
            backup_dir=self.backup_dir,
            retencion=5,
            comprimir=False,
        )
        self.assertIsNotNone(backup_file)
        self.assertTrue(backup_file.exists())
        self.assertTrue(backup_file.name.endswith(".sqlite"))

        conn = sqlite3.connect(backup_file)
        try:
            cur = conn.cursor()
            cur.execute("SELECT nombre FROM animales;")
            self.assertEqual(cur.fetchone()[0], "Estrella")
        finally:
            conn.close()

    def test_rotacion_y_retencion(self):
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        # Crear 5 archivos simulados con marcas temporales diferentes
        archivos = []
        for i in range(5):
            f = self.backup_dir / f"ganaderos_backup_20260901_0{i}0000.sqlite.gz"
            f.write_text("dummy")
            # Forzar modificación de mtime
            t = time.time() - (5 - i) * 100
            import os
            os.utime(f, (t, t))
            archivos.append(f)

        # Retener solo 2
        purgados = purgar_backups_antiguos(self.backup_dir, retencion=2)
        self.assertEqual(len(purgados), 3)

        restantes = list(self.backup_dir.glob("ganaderos_backup_*.sqlite*"))
        self.assertEqual(len(restantes), 2)
        # Los restantes deben ser los dos más recientes
        nombres_restantes = [r.name for r in restantes]
        self.assertIn("ganaderos_backup_20260901_040000.sqlite.gz", nombres_restantes)
        self.assertIn("ganaderos_backup_20260901_030000.sqlite.gz", nombres_restantes)

    def test_db_origen_inexistente(self):
        resultado = realizar_backup(
            db_path=self.base_path / "inexistente.sqlite",
            backup_dir=self.backup_dir,
        )
        self.assertIsNone(resultado)

    def test_backup_to_usb_atomic_and_rotation(self):
        from scripts.backup_to_usb import backup_sqlite_atomico, rotar_copias_antiguas

        usb_dest = self.base_path / "usb_mount" / "backups"
        fichero_bak = usb_dest / "ganaderos_campo_20261017_120000.sqlite"
        backup_sqlite_atomico(self.db_path, fichero_bak)

        self.assertTrue(fichero_bak.exists())
        # Verificar contenido
        conn = sqlite3.connect(fichero_bak)
        try:
            self.assertEqual(conn.execute("SELECT count(*) FROM animales").fetchone()[0], 1)
        finally:
            conn.close()

        # Test rotación de copias antiguas
        for i in range(10):
            dummy = usb_dest / f"ganaderos_campo_202610{i:02d}_000000.sqlite"
            dummy.write_text("test")
            import os
            t = time.time() - (10 - i) * 100
            os.utime(dummy, (t, t))

        eliminados = rotar_copias_antiguas(usb_dest, max_copias=3)
        self.assertGreater(eliminados, 0)
        restantes = list(usb_dest.glob("ganaderos_campo_*.sqlite"))
        self.assertLessEqual(len(restantes), 4)


class TestSystemdBackupUnits(unittest.TestCase):
    def setUp(self):
        self.repo_root = Path(__file__).resolve().parents[2]
        self.service_path = self.repo_root / "deploy" / "ganaderos-backup.service"
        self.timer_path = self.repo_root / "deploy" / "ganaderos-backup.timer"

    def test_systemd_backup_files_exist(self):
        self.assertTrue(self.service_path.exists(), "ganaderos-backup.service must exist")
        self.assertTrue(self.timer_path.exists(), "ganaderos-backup.timer must exist")

    def test_systemd_backup_service_content(self):
        content = self.service_path.read_text(encoding="utf-8")
        self.assertIn("ConditionPathIsMountPoint=/mnt/usb", content)
        self.assertIn("Type=oneshot", content)
        self.assertIn("User=varo", content)
        self.assertIn("Group=varo", content)
        self.assertIn("WorkingDirectory=/home/varo/ganaderos_pwa", content)
        self.assertIn("backup_to_usb.py", content)
        self.assertIn("ProtectSystem=full", content)
        self.assertIn("ProtectHome=read-only", content)
        self.assertIn("ReadWritePaths=/mnt/usb", content)
        self.assertIn("NoNewPrivileges=true", content)

    def test_systemd_backup_timer_content(self):
        content = self.timer_path.read_text(encoding="utf-8")
        self.assertIn("OnCalendar=*-*-* 03:00:00", content)
        self.assertIn("Persistent=true", content)
        self.assertIn("RandomizedDelaySec=300", content)
        self.assertIn("Unit=ganaderos-backup.service", content)
        self.assertIn("WantedBy=timers.target", content)


if __name__ == "__main__":
    unittest.main()

