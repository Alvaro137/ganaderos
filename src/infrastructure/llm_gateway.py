"""Pasarela de comunicación con modelos de lenguaje mediante Tool/Intent Calling estructurado."""
import json
import logging
import os
import re
import unicodedata
import urllib.error
import urllib.request
from typing import Any, Optional, Tuple

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
                except Exception as json_err:
                    logger.warning(f"[LLM Gateway] Error al decodificar argumentos JSON de la herramienta '{nombre}': {json_err}")
                    args = {}
                return nombre, args

            # Si el modelo respondió en texto directo
            content = choice.get("content", "").strip()
            if content:
                return IntentType.CONSULTA_INFORMATIVA_GENERAL.value, {"respuesta": content}

    except urllib.error.HTTPError as http_err:
        logger.warning(f"[LLM Gateway] Error HTTP al comunicar con Groq ({http_err.code}): {http_err.reason}")
    except urllib.error.URLError as url_err:
        logger.warning(f"[LLM Gateway] Error de conexión URL con Groq: {url_err.reason}")
    except Exception as e:
        logger.error(f"[LLM Gateway] Error inesperado en llamada a Groq: {e}", exc_info=True)

    return None


def _normalizar_texto(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", texto).encode("ASCII", "ignore").decode("utf-8")
    return texto.lower().strip()


def clasificar_intencion_offline(prompt: str) -> Tuple[str, dict[str, Any]]:
    """Clasificador semántico y extractor determinista para modo offline y resiliencia."""
    p_norm = _normalizar_texto(prompt)

    # Detección de ataques o consultas fuera de dominio (adversarios)
    patrones_adversarios = [
        r"drop\s+table",
        r"select\s+\*",
        r"--;",
        r"contrasena",
        r"password",
        r"capital\s+de",
        r"chiste",
        r"tiempo\s+va\s+a\s+hacer",
        r"clima",
    ]
    for pat in patrones_adversarios:
        if re.search(pat, p_norm):
            return IntentType.CONSULTA_INFORMATIVA_GENERAL.value, {}

    # Sanitización de espaciado Whisper (ej: '10 45' -> '1045')
    prompt_sanitizado = re.sub(r"\b(\d{2})\s+(\d{2})\b", r"\1\2", prompt)
    p_norm_s = _normalizar_texto(prompt_sanitizado)

    crotal_4 = None
    match_oficial = re.search(r"\b[A-Za-z]{2}\d{10,12}\b", prompt_sanitizado)
    if match_oficial:
        crotal_4 = match_oficial.group(0)[-4:]
    else:
        match_4 = re.search(r"\b(\d{4})\b", prompt_sanitizado)
        if match_4:
            crotal_4 = match_4.group(1)

    if any(k in p_norm_s for k in ["parto", "cria", "hijo", "descendencia", "becerro"]):
        if any(k in p_norm_s for k in ["sin parir", "vacia", "no paren"]):
            return IntentType.LISTAR_VACAS_SIN_PARIR.value, {}
        if crotal_4:
            return IntentType.CONSULTAR_PARTOS_MADRE.value, {"crotal_4": crotal_4}

    if any(k in p_norm_s for k in ["sin parir", "vacia", "no paren", "nodrizas"]):
        return IntentType.LISTAR_VACAS_SIN_PARIR.value, {}

    if any(k in p_norm_s for k in ["retirada", "supresion", "tiempo de carne", "medicamento", "receta", "tratamiento"]):
        if any(k in p_norm_s for k in ["mas usado", "mas recetado", "mas frecuente", "frecuente"]):
            return IntentType.CONSULTAR_MEDICAMENTO_MAS_USADO.value, {}
        return IntentType.CONSULTAR_SUPRESIONES_ACTIVAS.value, {}

    if any(k in p_norm_s for k in ["pienso", "alimento", "albaran", "tolva"]):
        return IntentType.CONSULTAR_COMPRAS_ALIMENTO.value, {}

    corrales_conocidos = {
        "duena": "DUEÑA",
        "espadana": "ESPADAÑA",
        "rivera": "RIVERA",
        "vega": "VEGA",
        "cebadero": "CEBADERO",
    }
    # Distinguir traspasos de corrales
    if any(k in p_norm_s for k in ["traspaso", "trasladado", "movimiento"]):
        if "reciente" in p_norm_s and "cebadero" in p_norm_s:
            return IntentType.LISTAR_ULTIMOS_TRASPASOS.value, {"origen": "121", "destino": "122"}
        return IntentType.LISTAR_ULTIMOS_TRASPASOS.value, {}

    for alias, nombre_oficial in corrales_conocidos.items():
        if alias in p_norm_s:
            return IntentType.LISTAR_ANIMALES_CORRAL.value, {"corral": nombre_oficial}

    if crotal_4:
        return IntentType.CONSULTAR_FICHA_ANIMAL.value, {"crotal_4": crotal_4}

    return IntentType.CONSULTA_INFORMATIVA_GENERAL.value, {}


def resolver_intencion_usuario(
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None
) -> Tuple[Optional[str], dict[str, Any], bool]:
    """Resuelve la intención del usuario delegando en el LLM (Cloud/Edge) con fallback local.

    En caso de haber conectividad y credenciales válidas, utiliza inferencia online.
    Si el LLM no está disponible, falla o no hay internet en campo, recurre al
    clasificador determinista de alta precisión para no interrumpir el servicio.
    """
    claves = _obtener_claves_api()
    if claves["groq"]:
        res_online = clasificar_intencion_groq(prompt, historial, api_key=claves["groq"])
        if res_online:
            return res_online[0], res_online[1], False

    # Fallback determinista local-first para resiliencia offline en campo
    intent_offline, args_offline = clasificar_intencion_offline(prompt)
    if intent_offline and intent_offline != IntentType.CONSULTA_INFORMATIVA_GENERAL.value:
        return intent_offline, args_offline, True

    return None, {}, False
