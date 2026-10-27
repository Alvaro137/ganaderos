"""Pasarela de comunicación con FreeLLMApi (Smart Router unificado).

Enruta consultas en lenguaje natural mediante Tool / Function Calling tipado
a través del router unificado de FreeLLMApi (OpenAI-compatible).
FreeLLMApi gestiona de forma autónoma la selección de modelos ('auto'), rotación
ante códigos 429 y cuotas de proveedores gratuitos.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional, Tuple

import httpx

from src.application.intents import CATALOGO_HERRAMIENTAS_LLM, IntentType

logger = logging.getLogger("ganaderos.ai")

SYSTEM_INSTRUCTION = """Eres el clasificador de intenciones del sistema de gestión de vacuno extensivo Ganaderos Campo.
Tu única función es analizar la consulta del ganadero y seleccionar la herramienta/función más adecuada del catálogo con sus parámetros correspondientes.

Reglas del dominio:
- Crotales: Si el usuario indica un número de 4 dígitos (ej. "1045", "8549"), es el crotal del animal. Usa crotal_4.
- Corrales/Lotes: Nombres como Dueña, Espadaña, Rivera, Vega, Cebadero corresponden al parámetro corral.
- Explotaciones: 121 es reproducción/vida, 122 es cebadero. Los traslados entre ellas son traspasos, nunca ventas.
- Si la pregunta es conceptual o informativa (ej. sanidad, consejos generales), utiliza la función 'consulta_informativa_general'.
"""

_MODELO_DEFAULT = [
    {
        "provider": "freellmapi",
        "model": "auto",
        "url": "http://localhost:3001/v1/chat/completions",
        "name": "FreeLLMApi Smart Router (Auto)",
    }
]


def _obtener_config_freellm() -> tuple[str, str]:
    """Obtiene la URL base y la clave unificada de FreeLLMApi desde variables de entorno o archivo .env."""
    base_url = (
        os.environ.get("FREELLM_BASE_URL")
        or os.environ.get("FREELLMAPI_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or "http://localhost:3001/v1"
    ).rstrip("/")

    api_key = (
        os.environ.get("Unified_AK")
        or os.environ.get("UNIFIED_AK")
        or os.environ.get("FREELLM_API_KEY")
        or os.environ.get("GROQ_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or ""
    )

    if not api_key:
        posibles_env = [
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"),
            os.path.join(os.getcwd(), ".env"),
        ]
        for env_path in posibles_env:
            if os.path.isfile(env_path):
                try:
                    with open(env_path, "r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if not line or line.startswith("#") or "=" not in line:
                                continue
                            k, v = line.split("=", 1)
                            k, v = k.strip(), v.strip().strip("'\"")
                            if k in ("Unified_AK", "UNIFIED_AK", "FREELLM_API_KEY", "GROQ_API_KEY") and not api_key:
                                api_key = v
                            elif k in ("FREELLM_BASE_URL", "FREELLMAPI_BASE_URL") and "FREELLM_BASE_URL" not in os.environ:
                                base_url = v.rstrip("/")
                except Exception:
                    pass
                break

    return base_url, api_key


def obtener_modelos_priorizados() -> list[dict[str, Any]]:
    """Devuelve la configuración del router inteligente FreeLLMApi."""
    base_url, _ = _obtener_config_freellm()
    return [
        {
            "provider": "freellmapi",
            "model": "auto",
            "url": f"{base_url}/chat/completions",
            "name": "FreeLLMApi Smart Router (Auto)",
        }
    ]


MODELOS_PRIORIZADOS = obtener_modelos_priorizados()


def _construir_payload_tool_calling(
    model: str,
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None,
) -> dict[str, Any]:
    messages = [{"role": "system", "content": SYSTEM_INSTRUCTION}]
    if historial:
        for msg in historial[-4:]:
            messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
    messages.append({"role": "user", "content": prompt})

    return {
        "model": model,
        "messages": messages,
        "tools": CATALOGO_HERRAMIENTAS_LLM,
        "tool_choice": "auto",
        "temperature": 0.1,
    }


def _procesar_respuesta_tool_calling(
    data: dict[str, Any],
    model: str,
) -> Optional[Tuple[str, dict[str, Any]]]:
    try:
        choice = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as err:
        logger.warning(f"[FreeLLM Router] Formato inesperado de respuesta de {model}: {err}")
        return None

    if "tool_calls" in choice and choice["tool_calls"]:
        tool = choice["tool_calls"][0]["function"]
        nombre = tool["name"]
        try:
            args = json.loads(tool["arguments"])
        except (json.JSONDecodeError, TypeError) as json_err:
            logger.warning(f"[FreeLLM Router] Error al parsear argumentos de '{nombre}' en {model}: {json_err}")
            args = {}
        return nombre, args

    content = choice.get("content", "").strip() if choice.get("content") else ""
    if content:
        return IntentType.CONSULTA_INFORMATIVA_GENERAL.value, {"respuesta": content}
    return None


async def resolver_intencion_usuario(
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None,
    modelo_solicitado: Optional[str] = None,
    timeout: float = 10.0,
) -> Tuple[Optional[str], dict[str, Any], bool]:
    """Resuelve la intención del usuario delegando en FreeLLMApi de forma asíncrona."""
    base_url, api_key = _obtener_config_freellm()
    if not api_key:
        logger.warning("[FreeLLM Router] Unified_AK no configurada en entorno o .env")
        return None, {}, False

    model_name = modelo_solicitado if modelo_solicitado and modelo_solicitado != "auto" else "auto"
    url = f"{base_url}/chat/completions"
    payload = _construir_payload_tool_calling(model_name, prompt, historial)
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "GanaderosCampo/2.0",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code != 200:
                logger.warning(
                    f"[FreeLLM Router] {model_name} en {url} respondió HTTP {resp.status_code}: {resp.text[:200]}"
                )
                return None, {}, False
            resultado = _procesar_respuesta_tool_calling(resp.json(), model_name)
            if resultado:
                return resultado[0], resultado[1], False
    except httpx.TimeoutException:
        logger.warning(f"[FreeLLM Router] Timeout agotado ({timeout}s) al contactar con FreeLLMApi")
    except httpx.HTTPError as http_err:
        logger.warning(f"[FreeLLM Router] Error de transporte HTTP con FreeLLMApi: {http_err}")
    except Exception as e:
        logger.warning(f"[FreeLLM Router] Error inesperado en llamada a FreeLLMApi: {e}", exc_info=True)

    return None, {}, False


async def sintetizar_respuesta_llm(
    prompt: str,
    data: list[dict[str, Any]],
    modelo_solicitado: Optional[str] = None,
    timeout: float = 10.0,
) -> Optional[str]:
    """Genera una síntesis en lenguaje ganadero directo a través de FreeLLMApi."""
    base_url, api_key = _obtener_config_freellm()
    if not api_key:
        return None

    model_name = modelo_solicitado if modelo_solicitado and modelo_solicitado != "auto" else "auto"
    url = f"{base_url}/chat/completions"
    prompt_text = (
        f"Eres un asesor técnico y veterinario de una explotación de vacuno de carne en pastos.\n"
        f"El ganadero ha preguntado: '{prompt}'\n"
        f"Los datos obtenidos de la base de datos son:\n{json.dumps(data[:15], ensure_ascii=False)}\n"
        f"Resume en 1 o 2 frases breves, directas y claras en lenguaje ganadero la respuesta práctica."
    )

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": "Eres un asesor técnico ganadero. Resume en 1 o 2 frases breves y directas."},
            {"role": "user", "content": prompt_text},
        ],
        "temperature": 0.2,
        "max_tokens": 150,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "GanaderosCampo/2.0",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                res_data = resp.json()
                content = res_data["choices"][0]["message"]["content"].strip()
                if content:
                    return content
            else:
                logger.warning(f"[FreeLLM Synthesize] HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"[FreeLLM Synthesize] Fallo al sintetizar: {e}")

    return None


def clasificar_intencion_freellm(
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    timeout: float = 10.0,
) -> Optional[Tuple[str, dict[str, Any]]]:
    """Llamada síncrona a FreeLLMApi con Tool Calling nativo (para scripts CLI/benchmark)."""
    base_url, key = _obtener_config_freellm()
    clave_final = api_key or key
    if not clave_final:
        return None

    model_name = model or "auto"
    url = f"{base_url}/chat/completions"
    payload = _construir_payload_tool_calling(model_name, prompt, historial)
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {clave_final}",
        "User-Agent": "GanaderosCampo/2.0",
    }

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                return _procesar_respuesta_tool_calling(resp.json(), model_name)
            logger.warning(f"[FreeLLM Sync] HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"[FreeLLM Sync] Error: {e}")

    return None


# Alias para retrocompatibilidad con scripts de evaluación CLI
clasificar_intencion_groq = clasificar_intencion_freellm
