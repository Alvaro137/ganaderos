"""Pasarela de comunicación con modelos de lenguaje mediante Tool/Intent Calling estructurado."""
import json
import os
import urllib.error
import urllib.request
from typing import Any, Optional, Tuple

from src.application.intents import CATALOGO_HERRAMIENTAS_LLM, IntentType

SYSTEM_INSTRUCTION = """Eres el clasificador de intenciones del sistema de gestión de vacuno extensivo Ganaderos Campo.
Tu única función es analizar la consulta del ganadero y seleccionar la herramienta/función más adecuada del catálogo con sus parámetros correspondientes.

Reglas del dominio:
- Crotales: Si el usuario indica un número de 4 dígitos (ej. "1045", "8549"), es el crotal del animal. Usa crotal_4.
- Corrales/Lotes: Nombres como Dueña, Espadaña, Rivera, Vega, Cebadero corresponden al parámetro corral.
- Explotaciones: 121 es reproducción/vida, 122 es cebadero. Los traslados entre ellas son traspasos, nunca ventas.
- Si la pregunta es conceptual o informativa (ej. sanidad, consejos generales), utiliza la función 'consulta_informativa_general'.
"""


def _obtener_claves_api() -> dict[str, str]:
    return {
        "groq": os.environ.get("GROQ_API_KEY") or os.environ.get("GROK_API_KEY", ""),
        "gemini": os.environ.get("GEMINI_API_KEY", ""),
        "openrouter": os.environ.get("OPENROUTER_API_KEY", ""),
    }


def clasificar_intencion_groq(
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None,
    api_key: Optional[str] = None
) -> Optional[Tuple[str, dict[str, Any]]]:
    """Llama a Groq Cloud con Tool Calling nativo."""
    key = api_key or _obtener_claves_api()["groq"]
    if not key:
        return None

    messages = [{"role": "system", "content": SYSTEM_INSTRUCTION}]
    if historial:
        for msg in historial[-4:]:
            messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
    messages.append({"role": "user", "content": prompt})

    model_name = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
    payload = {
        "model": model_name,
        "messages": messages,
        "tools": CATALOGO_HERRAMIENTAS_LLM,
        "tool_choice": "auto",
        "temperature": 0.1,
    }

    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            "User-Agent": "GanaderosCampo/2.0"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            choice = data["choices"][0]["message"]

            if "tool_calls" in choice and choice["tool_calls"]:
                tool = choice["tool_calls"][0]["function"]
                nombre = tool["name"]
                try:
                    args = json.loads(tool["arguments"])
                except Exception:
                    args = {}
                return nombre, args

            # Si el modelo respondió en texto directo
            content = choice.get("content", "").strip()
            if content:
                return IntentType.CONSULTA_INFORMATIVA_GENERAL.value, {"respuesta": content}

    except Exception as e:
        print(f"[LLM Gateway] Error en llamada a Groq: {e}")

    return None


def resolver_intencion_usuario(
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None
) -> Tuple[Optional[str], dict[str, Any], bool]:
    """Resuelve la intención del usuario delegando en el LLM (Cloud/Edge).

    En caso de no haber conectividad o no tener credenciales de inferencia,
    retorna (None, {}, False) para permitir degradación grácil hacia la interfaz táctil.

    Devuelve: (nombre_intent, argumentos, False)
    """
    claves = _obtener_claves_api()
    if claves["groq"]:
        res_online = clasificar_intencion_groq(prompt, historial, api_key=claves["groq"])
        if res_online:
            return res_online[0], res_online[1], False

    return None, {}, False
