"""Tests de integración para el Agente Autónomo Text-to-SQL con Sandbox SQLite y auto-corrección."""

import asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.infrastructure.llm_gateway import (
    ejecutar_agente_ia_sql,
    resolver_intencion_usuario,
)

DEMO_DB = Path(__file__).resolve().parent.parent.parent / "pwa" / "ganaderos_demo.sqlite"


class TestAIAgentSandboxIntegration:
    def test_agente_ia_sql_generates_and_executes_select(self, monkeypatch):
        monkeypatch.setenv("Unified_AK", "freellmapi-test")
        monkeypatch.setenv("FREELLM_BASE_URL", "http://mock-api:3001/v1")

        llm_response = {
            "choices": [
                {
                    "message": {
                        "content": '{"sql": "SELECT COUNT(*) AS total_cabezas FROM animales WHERE estado = \'A\'", "interpretacion": "Censo total de animales activos", "tipo_resultado": "conteo"}'
                    }
                }
            ]
        }
        mock_post = MagicMock()
        mock_post.status_code = 200
        mock_post.json.return_value = llm_response

        async def _run():
            with patch("httpx.AsyncClient.post", return_value=mock_post):
                return await ejecutar_agente_ia_sql(
                    prompt="¿cuántas vacas activas hay?",
                    db_path=DEMO_DB,
                )

        res = asyncio.run(_run())
        assert res["ok"]
        assert res["sql"] == "SELECT COUNT(*) AS total_cabezas FROM animales WHERE estado = 'A'"
        assert res["interpretacion"] == "Censo total de animales activos"
        assert res["tipo_resultado"] == "conteo"
        assert len(res["filas"]) == 1
        assert res["filas"][0]["total_cabezas"] > 0

    def test_agente_ia_sql_self_correction_on_error(self, monkeypatch):
        """Simula que el modelo comete un error de columna en la ronda 1 y se auto-corrige en la ronda 2."""
        monkeypatch.setenv("Unified_AK", "freellmapi-test")
        monkeypatch.setenv("FREELLM_BASE_URL", "http://mock-api:3001/v1")

        # Ronda 1: SQL con columna inexistente
        resp_erronea = MagicMock()
        resp_erronea.status_code = 200
        resp_erronea.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": '{"sql": "SELECT columna_inexistente_123 FROM animales", "interpretacion": "Consulta fallida"}'
                    }
                }
            ]
        }

        # Ronda 2: SQL corregida tras recibir el mensaje de error de SQLite
        resp_corregida = MagicMock()
        resp_corregida.status_code = 200
        resp_corregida.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": '{"sql": "SELECT crotal_4, estado FROM animales WHERE estado = \'A\' LIMIT 5", "interpretacion": "Animales activos corregidos", "tipo_resultado": "animales"}'
                    }
                }
            ]
        }

        call_count = 0

        async def mock_post_call(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return resp_erronea
            return resp_corregida

        async def _run():
            with patch("httpx.AsyncClient.post", side_effect=mock_post_call):
                return await ejecutar_agente_ia_sql(
                    prompt="animales en censo",
                    db_path=DEMO_DB,
                    max_intentos=2,
                )

        res = asyncio.run(_run())
        assert res["ok"]
        assert call_count >= 2  # Hubo retroalimentación y reintento
        assert "crotal_4" in res["sql"]
        assert len(res["filas"]) > 0

    def test_agente_ia_conceptual_without_sql(self, monkeypatch):
        monkeypatch.setenv("Unified_AK", "freellmapi-test")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": '{"sql": null, "interpretacion": "Definición sanitaria:", "respuesta_directa": "El tiempo de supresión es el periodo de espera obligatorio tras aplicar un fármaco.", "tipo_resultado": "general"}'
                    }
                }
            ]
        }

        async def _run():
            with patch("httpx.AsyncClient.post", return_value=mock_resp):
                return await ejecutar_agente_ia_sql(
                    prompt="¿qué es el tiempo de supresión?",
                    db_path=DEMO_DB,
                )

        res = asyncio.run(_run())
        assert res["ok"]
        assert res["sql"] is None
        assert "tiempo de supresión" in res["respuesta_directa"]

    def test_resolver_intencion_usuario_backward_compatibility(self, monkeypatch):
        monkeypatch.setenv("Unified_AK", "freellmapi-test")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": '{"sql": "SELECT crotal_4 FROM animales WHERE crotal_4 = \'1045\'", "interpretacion": "Ficha 1045", "tipo_resultado": "animales"}'
                    }
                }
            ]
        }

        async def _run():
            with patch("httpx.AsyncClient.post", return_value=mock_resp):
                return await resolver_intencion_usuario("vaca 1045", db_path=DEMO_DB)

        nombre, args, offline = asyncio.run(_run())
        assert nombre == "consulta_sql_dinamica"
        assert args["sql"] == "SELECT crotal_4 FROM animales WHERE crotal_4 = '1045'"
        assert not offline
