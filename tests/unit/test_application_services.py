"""Tests unitarios para los servicios de aplicación de Ganaderos Campo."""
import unittest
from datetime import date, timedelta
from unittest.mock import MagicMock

from src.application.query_builder import QueryResult
from src.application.services import (
    AsistenteService,
    CensoService,
    GenealogiaService,
    SanidadService,
)
from src.domain.models import Animal, RecetaSanitaria
from src.domain.value_objects import Crotal, ExplotacionCEA, PeriodoSupresion


class TestApplicationServices(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.animal_repo = MagicMock()
        self.parto_repo = MagicMock()
        self.receta_repo = MagicMock()

        self.censo_service = CensoService(self.animal_repo)
        self.sanidad_service = SanidadService(self.receta_repo)
        self.genealogia_service = GenealogiaService(self.animal_repo, self.parto_repo)

    def test_censo_service_filtrado_activos_y_reproductoras(self):
        vaca_activa = Animal(
            crotal=Crotal("ES083710101111"),
            nombre="Luna",
            sexo="Vaca",
            raza="MORUCHA",
            fecha_nacimiento=date(2021, 1, 1),
            madre_crotal=None,
            padre_crotal=None,
            estado="A",
            vida=1,
            corral="DUEÑA",
            fecha_alta=date(2021, 1, 1)
        )
        toro_activo = Animal(
            crotal=Crotal("ES083710102222"),
            nombre="Bravo",
            sexo="Toro",
            raza="CHAROLES",
            fecha_nacimiento=date(2020, 5, 10),
            madre_crotal=None,
            padre_crotal=None,
            estado="A",
            vida=1,
            corral="DUEÑA",
            fecha_alta=date(2020, 5, 10)
        )

        self.animal_repo.list_activos.return_value = [vaca_activa, toro_activo]
        self.animal_repo.list_reproductoras.return_value = [vaca_activa]

        activos = self.censo_service.list_activos()
        self.assertEqual(len(activos), 2)
        self.assertIn(vaca_activa, activos)
        self.assertIn(toro_activo, activos)
        self.animal_repo.list_activos.assert_called_once()

        reproductoras = self.censo_service.list_reproductoras()
        self.assertEqual(len(reproductoras), 1)
        self.assertEqual(reproductoras[0], vaca_activa)
        self.animal_repo.list_reproductoras.assert_called_once()

    def test_sanidad_service_recetas_activas_en_supresion(self):
        hoy = date(2026, 9, 20)
        receta_vigente = RecetaSanitaria(
            fecha=date(2026, 9, 10),
            receta="REC-01",
            medicamento="ANTIBIOTICO A",
            unidades=20.0,
            dosis_unitaria=2.0,
            n_animales=10,
            veterinario="VET-01",
            periodo_supresion=PeriodoSupresion(dias_carne=28),
            proveedor="PROV",
            cea=ExplotacionCEA("ES371261100121")
        )
        receta_vencida = RecetaSanitaria(
            fecha=date(2026, 8, 1),
            receta="REC-02",
            medicamento="ANTIBIOTICO B",
            unidades=10.0,
            dosis_unitaria=1.0,
            n_animales=5,
            veterinario="VET-01",
            periodo_supresion=PeriodoSupresion(dias_carne=14),
            proveedor="PROV",
            cea=ExplotacionCEA("ES371261100121")
        )

        self.receta_repo.list_all.return_value = [receta_vigente, receta_vencida]

        activas = self.sanidad_service.get_recetas_activas(fecha_referencia=hoy)
        self.assertEqual(len(activas), 1)
        self.assertEqual(activas[0], receta_vigente)

    def test_genealogia_service_deteccion_vacas_sin_parir(self):
        hoy = date.today()
        # Vaca que parió hace 500 días (> 400 días límite)
        vaca_retrasada = Animal(
            crotal=Crotal("ES083710104444"),
            nombre="Retrasada",
            sexo="Vaca",
            raza="MORUCHA",
            fecha_nacimiento=date(2019, 1, 1),
            madre_crotal=None,
            padre_crotal=None,
            estado="A",
            vida=1,
            corral="DUEÑA",
            fecha_alta=date(2019, 1, 1),
            fecha_ult_parto=hoy - timedelta(days=500),
            total_partos=2
        )
        # Vaca al día (parió hace 100 días)
        vaca_al_dia = Animal(
            crotal=Crotal("ES083710105555"),
            nombre="Cumplidora",
            sexo="Vaca",
            raza="MORUCHA",
            fecha_nacimiento=date(2021, 1, 1),
            madre_crotal=None,
            padre_crotal=None,
            estado="A",
            vida=1,
            corral="DUEÑA",
            fecha_alta=date(2021, 1, 1),
            fecha_ult_parto=hoy - timedelta(days=100),
            total_partos=1
        )

        self.animal_repo.list_reproductoras.return_value = [vaca_retrasada, vaca_al_dia]

        problematicas = self.genealogia_service.check_vacas_sin_parir(dias_max=400)
        self.assertEqual(len(problematicas), 1)
        self.assertEqual(problematicas[0], vaca_retrasada)
        self.animal_repo.list_reproductoras.assert_called_once()

    async def test_asistente_service_procesar_intencion_valida(self):
        mock_resolver = MagicMock(return_value=("consultar_ficha_animal", {"crotal_4": "1045"}, False))
        mock_query_res = QueryResult(
            sql="SELECT * FROM animales WHERE crotal_4 = ?",
            params=["1045"],
            interpretacion="Consulta de ficha",
            tipo_resultado="vaca",
        )
        mock_builder = MagicMock(return_value=mock_query_res)

        asistente = AsistenteService(intent_resolver=mock_resolver, query_builder=mock_builder)
        res = await asistente.procesar_intencion("dame la 1045")

        self.assertIsNotNone(res)
        self.assertEqual(res.intent, "consultar_ficha_animal")
        self.assertEqual(res.args, {"crotal_4": "1045"})
        self.assertEqual(res.query_result, mock_query_res)
        self.assertFalse(res.offline_mode)
        mock_resolver.assert_called_once_with("dame la 1045", None, modelo_solicitado=None)
        mock_builder.assert_called_once_with("consultar_ficha_animal", {"crotal_4": "1045"})

    async def test_asistente_service_intent_no_resuelto(self):
        mock_resolver = MagicMock(return_value=(None, {}, False))
        mock_builder = MagicMock()

        asistente = AsistenteService(intent_resolver=mock_resolver, query_builder=mock_builder)
        res = await asistente.procesar_intencion("un prompt ininteligible")

        self.assertIsNone(res)
        mock_builder.assert_not_called()

    async def test_asistente_service_sin_resolvers(self):
        asistente = AsistenteService(intent_resolver=None, query_builder=None)
        with self.assertRaises(RuntimeError):
            await asistente.procesar_intencion("hola")


if __name__ == "__main__":
    unittest.main()
