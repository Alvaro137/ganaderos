"""Tests unitarios para la capa de acceso a datos Access (ACL)."""
import unittest
from datetime import datetime
from unittest.mock import MagicMock

from src.infrastructure.access_reader import (
    _fecha_iso,
    _limpiar_str,
    conn_str_for,
    leer_animales,
    leer_partos,
    tiene_controlador_access,
)


class TestAccessReader(unittest.TestCase):
    def test_limpiar_str(self):
        self.assertIsNone(_limpiar_str(None))
        self.assertIsNone(_limpiar_str("   "))
        self.assertEqual(_limpiar_str("  ES083710104599  "), "ES083710104599")

    def test_fecha_iso(self):
        self.assertIsNone(_fecha_iso(None))
        self.assertEqual(_fecha_iso(datetime(2026, 9, 21, 15, 30)), "2026-09-21")
        self.assertEqual(_fecha_iso("21/09/2026"), "2026-09-21")
        self.assertEqual(_fecha_iso("2026-09-21"), "2026-09-21")

    def test_conn_str_with_password(self):
        s = conn_str_for(MagicMock(resolve=lambda: r"C:\data\bdlibro.mdb"), password="test_password")
        self.assertIn("PWD=test_password;", s)
        self.assertIn("ExtendedAnsiSQL=1;", s)

    def test_tiene_controlador_returns_bool(self):
        res = tiene_controlador_access()
        self.assertIsInstance(res, bool)

    def test_leer_animales_con_mock(self):
        mock_cur = MagicMock()
        # Mock para Raza
        mock_cur.fetchall.side_effect = [
            [(1, "LIMUSIN")],  # Razas
            [("02", "Hembra")],  # Sexos
            [("ES083710104599", datetime(2022, 5, 10), 1, "02", None, None, "A", True, "Dueña", None, None, "Marquesa")],  # Animal
        ]
        res = leer_animales(mock_cur)
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["crotal"], "ES083710104599")
        self.assertEqual(res[0]["crotal_4"], "4599")
        self.assertEqual(res[0]["raza"], "LIMUSIN")
        self.assertEqual(res[0]["sexo"], "Hembra")
        self.assertEqual(res[0]["corral"], "Dueña")

    def test_leer_partos_con_mock(self):
        mock_cur = MagicMock()
        mock_cur.fetchall.return_value = [
            ("ES083710109999", datetime(2025, 3, 14), "02", "ES083710104599"),
        ]
        res = leer_partos(mock_cur)
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["cria_crotal"], "ES083710109999")
        self.assertEqual(res[0]["madre_crotal"], "ES083710104599")
        self.assertEqual(res[0]["fecha_parto"], "2025-03-14")


    def test_esta_bloqueada_por_access(self):
        import tempfile
        from pathlib import Path

        from src.infrastructure.access_reader import esta_bloqueada_por_access

        with tempfile.TemporaryDirectory() as tmpdir:
            p = Path(tmpdir) / "bdlibro.mdb"
            p.write_text("mdb")
            self.assertFalse(esta_bloqueada_por_access(p))

            ldb = Path(tmpdir) / "bdlibro.ldb"
            ldb.write_text("ldb")
            self.assertTrue(esta_bloqueada_por_access(p))

    def test_file_lock_descarta_lock_obsoleto_por_pid_muerto(self):
        import tempfile
        from pathlib import Path

        from src.infrastructure.access_reader import FileLock

        with tempfile.TemporaryDirectory() as tmpdir:
            lock_file = Path(tmpdir) / "test.lock"
            # Escribir un lock con un PID imposible (ej. 9999999)
            lock_file.write_text("LOCKED by test PID=9999999 2026-01-01T00:00:00\n", encoding="utf-8")

            # El FileLock debe detectar que el PID no existe, descartar el lock y adquirirlo con éxito
            lock = FileLock(lock_file, timeout=2.0)
            with lock:
                self.assertTrue(lock_file.exists())
                contenido = lock_file.read_text(encoding="utf-8")
                self.assertIn("ganaderos-campo", contenido)
            self.assertFalse(lock_file.exists())


if __name__ == "__main__":
    unittest.main()
