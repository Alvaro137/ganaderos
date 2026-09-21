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


if __name__ == "__main__":
    unittest.main()
