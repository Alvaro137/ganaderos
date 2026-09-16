"""Pasarela de comunicación con modelos de lenguaje mediante Tool/Intent Calling estructurado."""
import json
import os
from typing import Any, Optional, Tuple
import urllib.error
import urllib.request

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

    payload = {
        "model": "llama-3.3-70b-versatile",
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


def clasificar_intencion_heuristica(prompt: str) -> Tuple[str, dict[str, Any]]:
    """Parser determinista y local (Offline Fallback) para consultas en campo sin cobertura."""
    p = prompt.strip().lower()

    # 1. Búsqueda directa de 4 dígitos de crotal
    import re
    m_crotal = re.search(r"\b(\d{4})\b", p)
    if ("parto" in p or "cría" in p or "hijo" in p) and m_crotal:
        return IntentType.CONSULTAR_PARTOS_MADRE.value, {"crotal_4": m_crotal.group(1)}
    if m_crotal and ("ficha" in p or "vaca" in p or "animal" in p or len(p) <= 6):
        return IntentType.CONSULTAR_FICHA_ANIMAL.value, {"crotal_4": m_crotal.group(1)}

    # 2. Corrales conocidos
    for c in ["dueña", "espadaña", "rivera", "vega", "cebadero"]:
        if c in p:
            return IntentType.LISTAR_ANIMALES_CORRAL.value, {"corral": c.upper(), "solo_activos": True}

    # 3. Vacas sin parir / vacías
    if "sin parir" in p or "vacia" in p or "vacía" in p:
        return IntentType.LISTAR_VACAS_SIN_PARIR.value, {}

    # 4. Supresiones sanitarias
    if "supresion" in p or "supresión" in p or "retirada" in p or "medicamento" in p:
        return IntentType.CONSULTAR_SUPRESIONES_ACTIVAS.value, {"limite": 20}

    # 5. Traspasos al cebadero
    if "traspaso" in p or "cebadero" in p:
        return IntentType.LISTAR_ULTIMOS_TRASPASOS.value, {"origen": "121", "destino": "122", "limite": 20}

    # 6. Compras de pienso
    if "pienso" in p or "alimento" in p or "compra" in p:
        return IntentType.CONSULTAR_COMPRAS_ALIMENTO.value, {"limite": 20}

    return IntentType.CONSULTA_INFORMATIVA_GENERAL.value, {
        "respuesta": "No se pudo clasificar la consulta de forma determinista en modo sin cobertura."
    }


def resolver_intencion_usuario(
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None
) -> Tuple[str, dict[str, Any], bool]:
    """Resuelve la intención mediante LLM si hay conectividad, o mediante parser local en caso contrario.
    
    Devuelve: (nombre_intent, argumentos, es_offline)
    """
    # Intentar primero con el proveedor online si hay clave
    claves = _obtener_claves_api()
    if claves["groq"]:
        res_online = clasificar_intencion_groq(prompt, historial, api_key=claves["groq"])
        if res_online:
            return res_online[0], res_online[1], False

    # Fallback determinista offline
    nombre, args = clasificar_intencion_heuristica(prompt)
    return nombre, args, True
