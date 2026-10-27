"""Tests unitarios para la pasarela de modelos FreeLLMApi."""

import asyncio
from unittest.mock import MagicMock, patch

from src.infrastructure.llm_gateway import (
    _construir_payload_tool_calling,
    _obtener_config_freellm,
    _procesar_respuesta_tool_calling,
    clasificar_intencion_freellm,
    clasificar_intencion_groq,
    obtener_modelos_priorizados,
    resolver_intencion_usuario,
    sintetizar_respuesta_llm,
)


class TestFreeLLMGatewayConfig:
    def test_obtener_config_freellm_from_env(self, monkeypatch):
        monkeypatch.setenv("Unified_AK", "freellmapi-testkey123")
        monkeypatch.setenv("FREELLM_BASE_URL", "http://testserver:3001/v1")
        base_url, api_key = _obtener_config_freellm()
        assert base_url == "http://testserver:3001/v1"
        assert api_key == "freellmapi-testkey123"

    def test_obtener_config_freellm_defaults(self, monkeypatch):
        monkeypatch.delenv("Unified_AK", raising=False)
        monkeypatch.delenv("UNIFIED_AK", raising=False)
        monkeypatch.delenv("FREELLM_API_KEY", raising=False)
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("FREELLM_BASE_URL", raising=False)
        base_url, _ = _obtener_config_freellm()
        assert base_url == "http://localhost:3001/v1"

    def test_obtener_modelos_priorizados(self, monkeypatch):
        monkeypatch.setenv("FREELLM_BASE_URL", "http://localhost:3001/v1")
        modelos = obtener_modelos_priorizados()
        assert len(modelos) >= 1
        assert modelos[0]["model"] == "auto"
        assert modelos[0]["provider"] == "freellmapi"


class TestFreeLLMPayloadAndParsing:
    def test_construir_payload_tool_calling(self):
        payload = _construir_payload_tool_calling(
            model="auto",
            prompt="Consulta vaca 1045",
            historial=[{"role": "user", "content": "hola"}],
        )
        assert payload["model"] == "auto"
        assert payload["tool_choice"] == "auto"
        assert "tools" in payload
        assert len(payload["messages"]) == 3  # system + 1 history + prompt

    def test_procesar_respuesta_tool_calling_with_function(self):
        data = {
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "function": {
                                    "name": "consultar_ficha_animal",
                                    "arguments": '{"crotal_4": "1045"}',
                                }
                            }
                        ]
                    }
                }
            ]
        }
        res = _procesar_respuesta_tool_calling(data, "auto")
        assert res is not None
        nombre, args = res
        assert nombre == "consultar_ficha_animal"
        assert args == {"crotal_4": "1045"}

    def test_procesar_respuesta_content_fallback(self):
        data = {
            "choices": [
                {
                    "message": {
                        "content": "Respuesta directa general."
                    }
                }
            ]
        }
        res = _procesar_respuesta_tool_calling(data, "auto")
        assert res is not None
        nombre, args = res
        assert nombre == "consulta_informativa_general"
        assert args == {"respuesta": "Respuesta directa general."}

    def test_procesar_respuesta_malformed(self):
        assert _procesar_respuesta_tool_calling({}, "auto") is None
        assert _procesar_respuesta_tool_calling({"choices": []}, "auto") is None


class TestFreeLLMAsyncCalls:
    def test_resolver_intencion_usuario_success(self, monkeypatch):
        monkeypatch.setenv("Unified_AK", "freellmapi-key")
        monkeypatch.setenv("FREELLM_BASE_URL", "http://mock-api:3001/v1")

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "function": {
                                    "name": "consultar_ficha_animal",
                                    "arguments": '{"crotal_4": "2050"}',
                                }
                            }
                        ]
                    }
                }
            ]
        }

        async def _run():
            with patch("httpx.AsyncClient.post", return_value=mock_resp):
                return await resolver_intencion_usuario("vaca 2050")

        nombre, args, offline = asyncio.run(_run())
        assert nombre == "consultar_ficha_animal"
        assert args == {"crotal_4": "2050"}
        assert not offline

    def test_resolver_intencion_usuario_no_key(self, monkeypatch):
        monkeypatch.delenv("Unified_AK", raising=False)
        monkeypatch.delenv("UNIFIED_AK", raising=False)
        monkeypatch.delenv("FREELLM_API_KEY", raising=False)
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        async def _run():
            with patch("src.infrastructure.llm_gateway._obtener_config_freellm", return_value=("http://localhost:3001/v1", "")):
                return await resolver_intencion_usuario("vaca 2050")

        nombre, args, offline = asyncio.run(_run())
        assert nombre is None
        assert args == {}
        assert not offline

    def test_sintetizar_respuesta_llm_success(self, monkeypatch):
        monkeypatch.setenv("Unified_AK", "freellmapi-key")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "Tienes 12 vacas en Dueña."}}]
        }

        async def _run():
            with patch("httpx.AsyncClient.post", return_value=mock_resp):
                return await sintetizar_respuesta_llm("¿cuántas en Dueña?", [{"corral": "Dueña"}])

        res = asyncio.run(_run())
        assert res == "Tienes 12 vacas en Dueña."


class TestFreeLLMSyncCalls:
    def test_clasificar_intencion_freellm_sync(self, monkeypatch):
        monkeypatch.setenv("Unified_AK", "freellmapi-key")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "function": {
                                    "name": "consultar_censo_corral",
                                    "arguments": '{"corral": "Dueña"}',
                                }
                            }
                        ]
                    }
                }
            ]
        }

        with patch("httpx.Client.post", return_value=mock_resp):
            res = clasificar_intencion_freellm("censo Dueña")
            assert res is not None
            nombre, args = res
            assert nombre == "consultar_censo_corral"
            assert args == {"corral": "Dueña"}

    def test_clasificar_intencion_groq_alias(self, monkeypatch):
        assert clasificar_intencion_groq == clasificar_intencion_freellm
