"""Pasarela de comunicación multi-proveedor con modelos de lenguaje (LLM Router).

Enruta consultas en lenguaje natural mediante Tool / Function Calling tipado,
priorizando los modelos con mayor capacidad de razonamiento (Groq 120B, OpenRouter 70B, etc.)
y con degradación en cascada ante caídas o límites de cuota (HTTP 429).
Sin heurísticas offline de campo libre en producción.
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

# Lista priorizada predeterminada por nivel de inteligencia y razonamiento
_MODELOS_DEFAULT = [
    {
        "provider": "gemini",
        "model": "gemini-3.8-flash",
        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "name": "Gemini 3.8 Flash (Flagship Google AI)",
    },
    {
        "provider": "gemini",
        "model": "gemini-3.7-flash",
        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "name": "Gemini 3.7 Flash (Razonamiento Híbrido)",
    },
    {
        "provider": "gemini",
        "model": "gemini-3.6-flash",
        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "name": "Gemini 3.6 Flash (Alta Capacidad)",
    },
    {
        "provider": "gemini",
        "model": "gemini-3.5-flash",
        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "name": "Gemini 3.5 Flash (Generación Estable)",
    },
    {
        "provider": "mistral",
        "model": "mistral-large-2512",
        "url": "https://api.mistral.ai/v1/chat/completions",
        "name": "Mistral Large 2512 (Flagship Mistral AI)",
    },
    {
        "provider": "openrouter",
        "model": "poolside/laguna-s-2.1:free",
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "name": "OpenRouter Poolside Laguna S 2.1 (1.35T Flagship Free)",
    },
    {
        "provider": "openrouter",
        "model": "nex-agi/nex-n2.5-pro:free",
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "name": "OpenRouter Nex-N2.5-Pro (657B MoE Free)",
    },
    {
        "provider": "openrouter",
        "model": "inclusionai/ling-3.0-flash-sante:free",
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "name": "OpenRouter Ling 3.0 Flash Sante (327B Free)",
    },
    {
        "provider": "groq",
        "model": "qwen/qwen3.8-27b",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "name": "Groq Qwen 3.8 27B (Ultra-rápido)",
    },
    {
        "provider": "openrouter",
        "model": "qwen/qwen3.8-27b:free",
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "name": "OpenRouter Qwen 3.8 27B (Free)",
    },
    {
        "provider": "mistral",
        "model": "codestral-2508",
        "url": "https://api.mistral.ai/v1/chat/completions",
        "name": "Mistral Codestral 2508 (Razonamiento y Código)",
    },
    {
        "provider": "mistral",
        "model": "mistral-small-2603",
        "url": "https://api.mistral.ai/v1/chat/completions",
        "name": "Mistral Small 2603 (Rápido y Ligero)",
    },
    {
        "provider": "gemini",
        "model": "gemini-3.5-flash-lite",
        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "name": "Gemini 3.5 Flash Lite (Alta Cuota 500 RPD)",
    },
    {
        "provider": "gemini",
        "model": "gemini-3.1-flash-lite",
        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        "name": "Gemini 3.1 Flash Lite (Respaldo Ligero)",
    },
    {
        "provider": "openrouter",
        "model": "google/gemma-4-31b-it:free",
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "name": "OpenRouter Google Gemma 4 31B (Free)",
    },
    {
        "provider": "groq",
        "model": "openai/gpt-oss-120b",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "name": "Groq GPT OSS 120B (Último recurso / Fallback)",
    },
    {
        "provider": "groq",
        "model": "openai/gpt-oss-20b",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "name": "Groq GPT OSS 20B (Básico)",
    },
]

CONFIG_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "config", "ai_models_router.json")


def obtener_modelos_priorizados() -> list[dict[str, Any]]:
    """Carga los modelos ordenados por inteligencia desde config/ai_models_router.json o usa el default."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                modelos = data.get("modelos", [])
                if modelos:
                    return modelos
        except Exception as e:
            logger.warning(f"[LLM Gateway] No se pudo leer {CONFIG_FILE}: {e}")
    return _MODELOS_DEFAULT


MODELOS_PRIORIZADOS = obtener_modelos_priorizados()


def _obtener_claves_api() -> dict[str, str]:
    claves = {
        "groq": os.environ.get("GROQ_API_KEY") or os.environ.get("GROK_API_KEY", ""),
        "openrouter": os.environ.get("OPENROUTER_API_KEY", ""),
        "gemini": os.environ.get("GEMINI_API_KEY", ""),
        "mistral": os.environ.get("MISTRAL_API_KEY", ""),
    }
    if not all(claves.values()):
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
                            if k in ("GROQ_API_KEY", "GROK_API_KEY") and not claves["groq"]:
                                claves["groq"] = v
                            elif k == "OPENROUTER_API_KEY" and not claves["openrouter"]:
                                claves["openrouter"] = v
                            elif k == "GEMINI_API_KEY" and not claves["gemini"]:
                                claves["gemini"] = v
                            elif k == "MISTRAL_API_KEY" and not claves["mistral"]:
                                claves["mistral"] = v
                except Exception:
                    pass
                break
    return claves


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


def _obtener_headers_tool_calling(
    key: str,
    extra_headers: Optional[dict[str, str]] = None,
) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {key}",
        "User-Agent": "GanaderosCampo/2.0",
    }
    if extra_headers:
        headers.update(extra_headers)
    return headers


def _procesar_respuesta_tool_calling(
    data: dict[str, Any],
    model: str,
) -> Optional[Tuple[str, dict[str, Any]]]:
    try:
        choice = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as err:
        logger.warning(f"[LLM Router] Formato inesperado de respuesta de {model}: {err}")
        return None

    if "tool_calls" in choice and choice["tool_calls"]:
        tool = choice["tool_calls"][0]["function"]
        nombre = tool["name"]
        try:
            args = json.loads(tool["arguments"])
        except (json.JSONDecodeError, TypeError) as json_err:
            logger.warning(f"[LLM Router] Error al parsear argumentos de '{nombre}' en {model}: {json_err}")
            args = {}
        return nombre, args

    content = choice.get("content", "").strip() if choice.get("content") else ""
    if content:
        return IntentType.CONSULTA_INFORMATIVA_GENERAL.value, {"respuesta": content}
    return None


async def _ejecutar_tool_calling(
    url: str,
    key: str,
    model: str,
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None,
    timeout: float = 10.0,
    extra_headers: Optional[dict[str, str]] = None,
) -> Optional[Tuple[str, dict[str, Any]]]:
    """Ejecuta una petición estándar OpenAI-compatible con tools a un proveedor LLM de forma asíncrona."""
    payload = _construir_payload_tool_calling(model, prompt, historial)
    headers = _obtener_headers_tool_calling(key, extra_headers)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code != 200:
                logger.warning(
                    f"[LLM Router] {model} en {url} respondió HTTP {resp.status_code}: {resp.text[:200]}"
                )
                return None
            return _procesar_respuesta_tool_calling(resp.json(), model)
    except httpx.TimeoutException:
        logger.warning(f"[LLM Router] Timeout agotado ({timeout}s) al contactar con {model}")
    except httpx.HTTPError as http_err:
        logger.warning(f"[LLM Router] Error de transporte HTTP con {model}: {http_err}")
    except Exception as e:
        logger.warning(f"[LLM Router] Error inesperado en llamada a {model}: {e}", exc_info=True)

    return None


def _ejecutar_tool_calling_sync(
    url: str,
    key: str,
    model: str,
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None,
    timeout: float = 10.0,
    extra_headers: Optional[dict[str, str]] = None,
) -> Optional[Tuple[str, dict[str, Any]]]:
    """Versión síncrona con httpx.Client para scripts CLI que no corren en event loop."""
    payload = _construir_payload_tool_calling(model, prompt, historial)
    headers = _obtener_headers_tool_calling(key, extra_headers)

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload, headers=headers)
            if resp.status_code != 200:
                logger.warning(f"[LLM Router Sync] {model} respondió HTTP {resp.status_code}: {resp.text[:200]}")
                return None
            return _procesar_respuesta_tool_calling(resp.json(), model)
    except Exception as e:
        logger.warning(f"[LLM Router Sync] Error con {model}: {e}")
    return None


def clasificar_intencion_groq(
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> Optional[Tuple[str, dict[str, Any]]]:
    """Llama a Groq Cloud con Tool Calling nativo (síncrono, para scripts CLI)."""
    key = api_key or _obtener_claves_api()["groq"]
    if not key:
        return None
    model_name = model or os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
    return _ejecutar_tool_calling_sync(
        url="https://api.groq.com/openai/v1/chat/completions",
        key=key,
        model=model_name,
        prompt=prompt,
        historial=historial,
    )


def clasificar_intencion_openrouter(
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> Optional[Tuple[str, dict[str, Any]]]:
    """Llama a OpenRouter con Tool Calling nativo (síncrono, para scripts CLI)."""
    key = api_key or _obtener_claves_api()["openrouter"]
    if not key:
        return None
    model_name = model or "meta-llama/llama-3.3-70b-instruct"
    extra = {
        "HTTP-Referer": "https://ganaderos.local",
        "X-Title": "Ganaderos Campo",
    }
    return _ejecutar_tool_calling_sync(
        url="https://openrouter.ai/api/v1/chat/completions",
        key=key,
        model=model_name,
        prompt=prompt,
        historial=historial,
        extra_headers=extra,
    )


async def resolver_intencion_usuario(
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None,
    modelo_solicitado: Optional[str] = None,
) -> Tuple[Optional[str], dict[str, Any], bool]:
    """Resuelve la intención del usuario delegando en la lista priorizada de modelos de IA de forma asíncrona."""
    claves = _obtener_claves_api()
    modelos = obtener_modelos_priorizados()

    # Si se solicitó un modelo específico que no sea "auto"
    if modelo_solicitado and modelo_solicitado != "auto":
        for candidato in modelos:
            if candidato["model"] == modelo_solicitado:
                prov = candidato["provider"]
                key = claves.get(prov)
                if key:
                    res = await _ejecutar_tool_calling(
                        url=candidato["url"],
                        key=key,
                        model=candidato["model"],
                        prompt=prompt,
                        historial=historial,
                        extra_headers={"HTTP-Referer": "https://ganaderos.local", "X-Title": "Ganaderos Campo"} if prov == "openrouter" else None,
                    )
                    if res:
                        return res[0], res[1], False
                break

    # Router en cascada: orden de mayor a menor capacidad de razonamiento
    for candidato in modelos:
        prov = candidato["provider"]
        key = claves.get(prov)
        if not key:
            continue

        extra_hdrs = {"HTTP-Referer": "https://ganaderos.local", "X-Title": "Ganaderos Campo"} if prov == "openrouter" else None
        res = await _ejecutar_tool_calling(
            url=candidato["url"],
            key=key,
            model=candidato["model"],
            prompt=prompt,
            historial=historial,
            extra_headers=extra_hdrs,
        )
        if res:
            return res[0], res[1], False

    # Todos los proveedores online agotados o sin conectividad
    return None, {}, False


async def sintetizar_respuesta_llm(
    prompt: str,
    data: list[dict[str, Any]],
    modelo_solicitado: Optional[str] = None,
) -> Optional[str]:
    """Genera la síntesis en lenguaje ganadero utilizando la lista priorizada de modelos de forma asíncrona."""
    claves = _obtener_claves_api()
    modelos = obtener_modelos_priorizados()
    prompt_text = (
        f"Eres un asesor técnico y veterinario de una explotación de vacuno de carne en pastos.\n"
        f"El ganadero ha preguntado: '{prompt}'\n"
        f"Los datos obtenidos de la base de datos son:\n{json.dumps(data[:15], ensure_ascii=False)}\n"
        f"Resume en 1 o 2 frases breves, directas y claras en lenguaje ganadero la respuesta práctica."
    )

    candidatos_a_probar = []
    if modelo_solicitado and modelo_solicitado != "auto":
        candidatos_a_probar = [m for m in modelos if m["model"] == modelo_solicitado]
    if not candidatos_a_probar:
        candidatos_a_probar = modelos

    for candidato in candidatos_a_probar:
        prov = candidato["provider"]
        key = claves.get(prov)
        if not key:
            continue

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            "User-Agent": "GanaderosCampo/2.0",
        }
        if prov == "openrouter":
            headers["HTTP-Referer"] = "https://ganaderos.local"
            headers["X-Title"] = "Ganaderos Campo"

        payload = {
            "model": candidato["model"],
            "messages": [
                {"role": "system", "content": "Eres un asesor técnico ganadero. Resume en 1 o 2 frases breves y directas."},
                {"role": "user", "content": prompt_text},
            ],
            "temperature": 0.2,
            "max_tokens": 150,
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(candidato["url"], json=payload, headers=headers)
                if resp.status_code == 200:
                    res_data = resp.json()
                    content = res_data["choices"][0]["message"]["content"].strip()
                    if content:
                        return content
                else:
                    logger.warning(f"[Synthesize Router] {candidato['name']} respondió HTTP {resp.status_code}")
        except httpx.TimeoutException:
            logger.warning(f"[Synthesize Router] Timeout con {candidato['name']}")
        except httpx.HTTPError as e:
            logger.warning(f"[Synthesize Router] Error de transporte con {candidato['name']}: {e}")
        except Exception as e:
            logger.warning(f"[Synthesize Router] Fallo inesperado con {candidato['name']}: {e}", exc_info=True)

    return None
