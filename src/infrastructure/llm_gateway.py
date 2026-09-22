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
    import re
    p = prompt.strip().lower()

    # Normalizar espacios en números de 4 dígitos partidos por Whisper (ej. "10 45" -> "1045")
    p = re.sub(r"\b(\d{2})\s+(\d{2})\b", r"\1\2", p)

    # 0. Detección de crotal: 4 dígitos o crotal oficial completo (ej. ES083710104599 -> 4599)
    m_oficial = re.search(r"\b(?:es)?\d{8,12}(\d{4})\b", p)
    m_4dig = re.search(r"\b(\d{4})\b", p)
    crotal_detectado = m_4dig.group(1) if m_4dig else (m_oficial.group(1) if m_oficial else None)

    # 1. Partos / genealogía de madre
    palabras_parto = ["parto", "cría", "cria", "hijo", "descendencia", "becerro", "ternero", "nacid"]
    if crotal_detectado and any(w in p for w in palabras_parto):
        return IntentType.CONSULTAR_PARTOS_MADRE.value, {"crotal_4": crotal_detectado}

    # 2. Ficha de animal
    palabras_ficha = ["ficha", "vaca", "animal", "crotal", "dato"]
    if crotal_detectado and (any(w in p for w in palabras_ficha) or len(p.split()) <= 2):
        return IntentType.CONSULTAR_FICHA_ANIMAL.value, {"crotal_4": crotal_detectado}

    # 3. Traspasos y movimientos entre explotaciones (evaluar antes de corrales para 'cebadero')
    if "traspaso" in p or "traslad" in p or "movimiento" in p:
        return IntentType.LISTAR_ULTIMOS_TRASPASOS.value, {"origen": "121", "destino": "122", "limite": 20}

    # 4. Compras de pienso y gastos de alimentación (evaluar antes de corrales)
    if "pienso" in p or "alimento" in p or "compra" in p or "gasto" in p or "tolva" in p or "albaran" in p or "albarán" in p:
        return IntentType.CONSULTAR_COMPRAS_ALIMENTO.value, {"limite": 20}

    # 5. Medicamento más usado o tratamiento frecuente
    if ("medicamento" in p or "tratamiento" in p) and ("más" in p or "mas" in p or "frecuente" in p or "usado" in p or "recetad" in p):
        return IntentType.CONSULTAR_MEDICAMENTO_MAS_USADO.value, {"explotacion_codigo": "121", "limite": 10}

    # 6. Supresiones sanitarias / retirada de medicamentos
    if "supresion" in p or "supresión" in p or "retirada" in p or "tratamiento" in p or "medicamento" in p or "receta" in p:
        return IntentType.CONSULTAR_SUPRESIONES_ACTIVAS.value, {"limite": 20}

    # 7. Vacas sin parir / vacías
    if "sin parir" in p or "vacia" in p or "vacía" in p or "no pare" in p or "no paren" in p or "nodriza" in p:
        return IntentType.LISTAR_VACAS_SIN_PARIR.value, {}

    # 8. Corrales conocidos
    for c in ["dueña", "duena", "espadaña", "espadana", "rivera", "vega", "cebadero"]:
        if c in p:
            norm_c = "DUEÑA" if "due" in c else ("ESPADAÑA" if "espad" in c else c.upper())
            return IntentType.LISTAR_ANIMALES_CORRAL.value, {"corral": norm_c, "solo_activos": True}

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
