"""Tests unitarios para la capa de aplicación: Intents y Query Builder."""
import unittest

from src.application.intents import IntentType
from src.application.query_builder import construir_consulta_intent


class TestQueryBuilder(unittest.TestCase):
    def test_intent_consultar_ficha_animal(self):
        res = construir_consulta_intent(
            IntentType.CONSULTAR_FICHA_ANIMAL.value,
            {"crotal_4": "1045"}
        )
        self.assertIsNotNone(res.sql)
        self.assertIn("crotal_4 = ?", res.sql)
        self.assertEqual(res.params, ["1045"])
        self.assertEqual(res.tipo_resultado, "animales")

    def test_intent_listar_animales_corral(self):
        res = construir_consulta_intent(
            IntentType.LISTAR_ANIMALES_CORRAL.value,
            {"corral": "Dueña", "solo_activos": True}
        )
        self.assertIsNotNone(res.sql)
        self.assertIn("UPPER(corral) LIKE ?", res.sql)
        self.assertIn("estado = 'A'", res.sql)
        self.assertEqual(res.params, ["%DUEÑA%"])
        self.assertEqual(res.tipo_resultado, "animales")

    def test_intent_consultar_partos_madre(self):
        res = construir_consulta_intent(
            IntentType.CONSULTAR_PARTOS_MADRE.value,
            {"crotal_4": "0391"}
        )
        self.assertIsNotNone(res.sql)
        self.assertIn("madre_crotal = (", res.sql)
        self.assertEqual(res.params, ["0391"])
        self.assertEqual(res.tipo_resultado, "partos")

    def test_intent_vacas_sin_parir_con_corral(self):
        res = construir_consulta_intent(
            IntentType.LISTAR_VACAS_SIN_PARIR.value,
            {"corral": "Espadaña"}
        )
        self.assertIsNotNone(res.sql)
        self.assertIn("total_partos = 0", res.sql)
        self.assertEqual(res.params, ["%ESPADAÑA%"])

    def test_intent_supresiones_activas(self):
        res = construir_consulta_intent(
            IntentType.CONSULTAR_SUPRESIONES_ACTIVAS.value,
            {"limite": 15}
        )
        self.assertIsNotNone(res.sql)
        self.assertIn("tiempo_carne > 0", res.sql)
        self.assertEqual(res.params, [15])
        self.assertEqual(res.tipo_resultado, "recetas")

    def test_intent_traspasos_121_a_122(self):
        res = construir_consulta_intent(
            IntentType.LISTAR_ULTIMOS_TRASPASOS.value,
            {"origen": "121", "destino": "122", "limite": 10}
        )
        self.assertIsNotNone(res.sql)
        self.assertIn("m.origen LIKE ?", res.sql)
        self.assertEqual(res.params, ["%121%", "%122%", 10])
        self.assertEqual(res.tipo_resultado, "movimientos")

    def test_intent_informativo_sin_sql(self):
        res = construir_consulta_intent(
            IntentType.CONSULTA_INFORMATIVA_GENERAL.value,
            {"respuesta": "Los terneros deben identificarse antes de los 20 días de vida."}
        )
        self.assertIsNone(res.sql)
        self.assertEqual(res.tipo_resultado, "texto")
        self.assertIn("20 días", res.respuesta_directa)


if __name__ == "__main__":
    unittest.main()
