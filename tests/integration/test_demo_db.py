"""Tests para validar la integridad de la base de datos de demostración."""
import sqlite3
import sys
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DEMO_DB = ROOT_DIR / "pwa" / "ganaderos_demo.sqlite"


class TestDemoDatabase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not DEMO_DB.exists():
            from scripts.generate_demo_db import main as gen_main
            sys.argv = ["generate_demo_db.py", "--animales", "100"]
            gen_main()

    def setUp(self):
        self.conn = sqlite3.connect(DEMO_DB)
        self.conn.row_factory = sqlite3.Row

    def tearDown(self):
        self.conn.close()

    def test_tablas_principales_existen(self):
        cur = self.conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tablas = {r["name"] for r in cur.fetchall()}
        esperadas = {
            "animales", "partos", "movimientos", "recetas",
            "compras_alimento", "explotaciones", "meta"
        }
        self.assertTrue(esperadas.issubset(tablas), f"Faltan tablas: {esperadas - tablas}")

    def test_animales_crotales_y_estados(self):
        cur = self.conn.cursor()
        cur.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN estado='A' THEN 1 ELSE 0 END) AS activos FROM animales")
        res = cur.fetchone()
        self.assertGreater(res["total"], 50)
        self.assertGreater(res["activos"], 40)

    def test_busqueda_crotal_4(self):
        cur = self.conn.cursor()
        cur.execute("SELECT crotal, crotal_4, raza, corral FROM animales WHERE crotal_4 = '1045'")
        vaca = cur.fetchone()
        self.assertIsNotNone(vaca)
        self.assertEqual(vaca["crotal_4"], "1045")
        self.assertIn("ES08", vaca["crotal"])

    def test_trazabilidad_partos_madre(self):
        cur = self.conn.cursor()
        cur.execute("""
            SELECT p.id, p.madre_crotal, p.cria_sexo, a.crotal_4
            FROM partos p
            JOIN animales a ON p.madre_crotal = a.crotal
            LIMIT 5
        """)
        partos = cur.fetchall()
        self.assertGreater(len(partos), 0)
        for p in partos:
            self.assertIn(p["cria_sexo"], ("Macho", "Hembra"))

    def test_recetas_tiempo_supresion(self):
        cur = self.conn.cursor()
        cur.execute("SELECT COUNT(*) AS n FROM recetas WHERE tiempo_carne > 0")
        res = cur.fetchone()
        self.assertGreater(res["n"], 0)

    def test_compras_alimento_kg(self):
        cur = self.conn.cursor()
        cur.execute("SELECT SUM(kg) AS total_kg FROM compras_alimento")
        res = cur.fetchone()
        self.assertGreater(res["total_kg"], 10000)

    def test_movimientos_entre_explotaciones(self):
        cur = self.conn.cursor()
        cur.execute("SELECT COUNT(*) AS n FROM movimientos WHERE origen LIKE '%121' OR destino LIKE '%122'")
        res = cur.fetchone()
        self.assertGreater(res["n"], 0)


if __name__ == "__main__":
    unittest.main()
