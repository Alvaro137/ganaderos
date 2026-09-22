"""Tests unitarios para la capa de repositorios de infraestructura SQLite."""
import sqlite3
import unittest
from datetime import date

from src.domain.value_objects import Crotal
from src.infrastructure.repositories import (
    SQLiteAnimalRepository,
    SQLiteExplotacionRepository,
    SQLitePartoRepository,
    SQLiteRecetaRepository,
)


class TestSQLiteRepositories(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        cur = self.conn.cursor()

        # Schema mínimo para pruebas de repositorios
        cur.executescript("""
            CREATE TABLE animales (
                crotal TEXT PRIMARY KEY,
                nombre TEXT,
                sexo TEXT,
                raza TEXT,
                fecha_nacimiento TEXT,
                madre_crotal TEXT,
                padre_crotal TEXT,
                estado TEXT,
                vida INTEGER,
                corral TEXT,
                fecha_alta TEXT,
                fecha_ult_parto TEXT,
                total_partos INTEGER
            );

            CREATE TABLE partos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                madre_crotal TEXT,
                fecha_parto TEXT,
                cria_crotal TEXT,
                cria_sexo TEXT,
                incidencias TEXT
            );

            CREATE TABLE recetas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha TEXT,
                receta TEXT,
                medicamento TEXT,
                unidades REAL,
                dosis_unitaria REAL,
                n_animales INTEGER,
                veterinario TEXT,
                tiempo_carne INTEGER,
                tiempo_leche INTEGER,
                proveedor TEXT,
                cea TEXT
            );

            CREATE TABLE explotaciones (
                cea TEXT PRIMARY KEY,
                nombre TEXT,
                tipo TEXT
            );
        """)

        # Insertar datos de prueba
        cur.execute("""
            INSERT INTO animales VALUES (
                'ES083710104599', 'Estrella', 'Vaca', 'MORUCHA', '2020-03-15',
                NULL, NULL, 'A', 1, 'DUEÑA', '2020-03-15', '2024-04-10', 3
            )
        """)
        cur.execute("""
            INSERT INTO animales VALUES (
                'ES083710104600', 'BajaDemo', 'Toro', 'LIMUSIN', '2019-01-10',
                NULL, NULL, 'B', 0, 'ESPADAÑA', '2019-01-10', NULL, 0
            )
        """)

        cur.execute("""
            INSERT INTO partos (madre_crotal, fecha_parto, cria_crotal, cria_sexo, incidencias)
            VALUES ('ES083710104599', '2024-04-10', 'ES083710108888', 'Hembra', 'Parto normal sin asistencia')
        """)

        cur.execute("""
            INSERT INTO recetas (fecha, receta, medicamento, unidades, dosis_unitaria, n_animales, veterinario, tiempo_carne, tiempo_leche, proveedor, cea)
            VALUES ('2026-09-01', 'REC-2026-01', 'DRAXXIN 100mg', 50.0, 2.5, 20, 'COL-3701', 49, 0, 'FARMAVET', 'ES371261100121')
        """)

        cur.execute("""
            INSERT INTO explotaciones VALUES ('ES371261100121', 'Finca Dueña', 'Nodrizas')
        """)
        self.conn.commit()

        self.animal_repo = SQLiteAnimalRepository(self.conn)
        self.parto_repo = SQLitePartoRepository(self.conn)
        self.receta_repo = SQLiteRecetaRepository(self.conn)
        self.explotacion_repo = SQLiteExplotacionRepository(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_animal_repository_get_by_crotal(self):
        animal = self.animal_repo.get_by_crotal("ES083710104599")
        self.assertIsNotNone(animal)
        self.assertEqual(animal.crotal, Crotal("ES083710104599"))
        self.assertEqual(animal.nombre, "Estrella")
        self.assertEqual(animal.corral, "DUEÑA")
        self.assertTrue(animal.es_activo)
        self.assertTrue(animal.es_reproductora)
        self.assertEqual(animal.fecha_nacimiento, date(2020, 3, 15))
        self.assertEqual(animal.fecha_ult_parto, date(2024, 4, 10))

    def test_animal_repository_baja(self):
        animal = self.animal_repo.get_by_crotal("ES083710104600")
        self.assertIsNotNone(animal)
        self.assertFalse(animal.es_activo)
        self.assertFalse(animal.es_reproductora)

    def test_animal_repository_no_encontrado(self):
        animal = self.animal_repo.get_by_crotal("ES999999999999")
        self.assertIsNone(animal)

    def test_parto_repository_list_by_madre(self):
        partos = self.parto_repo.list_by_madre("ES083710104599")
        self.assertEqual(len(partos), 1)
        parto = partos[0]
        self.assertEqual(parto.madre_crotal, "ES083710104599")
        self.assertEqual(parto.fecha_parto, date(2024, 4, 10))
        self.assertEqual(parto.cria_crotal, "ES083710108888")
        self.assertEqual(parto.cria_sexo, "Hembra")

    def test_receta_repository_list_all_and_supresion(self):
        recetas = self.receta_repo.list_all()
        self.assertEqual(len(recetas), 1)
        receta = recetas[0]
        self.assertEqual(receta.medicamento, "DRAXXIN 100mg")
        self.assertEqual(receta.periodo_supresion.dias_carne, 49)
        self.assertEqual(receta.fecha, date(2026, 9, 1))
        # 1 Sep 2026 + 49 días = 20 Octubre 2026
        self.assertEqual(receta.fecha_limite_carne(), date(2026, 10, 20))

    def test_explotacion_repository_list_all(self):
        exps = self.explotacion_repo.list_all()
        self.assertEqual(len(exps), 1)
        self.assertEqual(exps[0]["cea"], "ES371261100121")


if __name__ == "__main__":
    unittest.main()
