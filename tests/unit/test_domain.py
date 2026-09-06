"""Tests unitarios para la capa de dominio ganadero."""
from datetime import date
import unittest

from src.domain.exceptions import CrotalInvalidoError, ExplotacionInvalidaError
from src.domain.models import Animal, Movimiento, RecetaSanitaria
from src.domain.value_objects import Crotal, ExplotacionCEA, PeriodoSupresion


class TestDomainValueObjects(unittest.TestCase):
    def test_crotal_valido(self):
        c = Crotal("ES083710104599")
        self.assertEqual(str(c), "ES083710104599")
        self.assertEqual(c.crotal_4, "4599")

    def test_crotal_normaliza_a_mayusculas(self):
        c = Crotal("  es083710104599  ")
        self.assertEqual(c.codigo, "ES083710104599")
        self.assertEqual(c.crotal_4, "4599")

    def test_crotal_invalido_longitud_o_formato(self):
        with self.assertRaises(CrotalInvalidoError):
            Crotal("ES12345")  # Demasiado corto
        with self.assertRaises(CrotalInvalidoError):
            Crotal("PT083710104599")  # País erróneo
        with self.assertRaises(CrotalInvalidoError):
            Crotal("ES08371010459A")  # Caracter no numérico

    def test_periodo_supresion_calculo_fechas(self):
        sup = PeriodoSupresion(dias_carne=28, dias_leche=0)
        f_trat = date(2026, 9, 1)
        f_fin = sup.calcular_fin_carne(f_trat)
        self.assertEqual(f_fin, date(2026, 9, 29))

        # En supresión antes del día 29
        self.assertTrue(sup.esta_en_supresion(f_trat, fecha_referencia=date(2026, 9, 28)))
        self.assertTrue(sup.esta_en_supresion(f_trat, fecha_referencia=date(2026, 9, 29)))
        # Liberado después del día 29
        self.assertFalse(sup.esta_en_supresion(f_trat, fecha_referencia=date(2026, 9, 30)))

    def test_periodo_supresion_cero_dias(self):
        sup = PeriodoSupresion(dias_carne=0)
        f_trat = date(2026, 9, 1)
        self.assertIsNone(sup.calcular_fin_carne(f_trat))
        self.assertFalse(sup.esta_en_supresion(f_trat))

    def test_explotacion_cea_clasificacion(self):
        cea_vida = ExplotacionCEA("ES371261100121")
        cea_cebo = ExplotacionCEA("ES371261100122")
        cea_ext = ExplotacionCEA("ES289999999999")

        self.assertTrue(cea_vida.es_vida)
        self.assertFalse(cea_vida.es_cebo)
        self.assertTrue(cea_vida.es_explotacion_propia)

        self.assertTrue(cea_cebo.es_cebo)
        self.assertFalse(cea_cebo.es_vida)
        self.assertTrue(cea_cebo.es_explotacion_propia)

        self.assertFalse(cea_ext.es_explotacion_propia)

    def test_explotacion_invalida(self):
        with self.assertRaises(ExplotacionInvalidaError):
            ExplotacionCEA("INVALID_CEA")


class TestDomainEntities(unittest.TestCase):
    def test_animal_activo_y_reproductora(self):
        vaca = Animal(
            crotal=Crotal("ES083710104599"),
            nombre="Estrella",
            sexo="Vaca",
            raza="MORUCHA",
            fecha_nacimiento=date(2020, 3, 15),
            madre_crotal="ES083710039122",
            padre_crotal=None,
            estado="A",
            vida=1,
            corral="DUEÑA",
            fecha_alta=date(2020, 3, 20),
            total_partos=4
        )
        self.assertTrue(vaca.es_activo)
        self.assertTrue(vaca.es_reproductora)
        self.assertGreater(vaca.edad_anios(fecha_referencia=date(2026, 9, 20)), 6.0)

    def test_movimiento_traspaso_interno_vs_externo(self):
        m_interno = Movimiento(
            crotal="ES083710104599",
            fecha=date(2026, 6, 1),
            tipo="TRASPASO",
            origen=ExplotacionCEA("ES371261100121"),
            destino=ExplotacionCEA("ES371261100122")
        )
        self.assertTrue(m_interno.es_traspaso_interno)
        self.assertTrue(m_interno.es_traspaso_a_cebadero)

        m_venta = Movimiento(
            crotal="ES083710104599",
            fecha=date(2026, 9, 1),
            tipo="VENTA",
            origen=ExplotacionCEA("ES371261100122"),
            destino=ExplotacionCEA("ES289999999999")
        )
        self.assertFalse(m_venta.es_traspaso_interno)


if __name__ == "__main__":
    unittest.main()
