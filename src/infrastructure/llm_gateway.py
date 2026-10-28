"""Pasarela de comunicación con FreeLLMApi y Agente Autónomo Text-to-SQL.

Enruta consultas en lenguaje natural del ganadero mediante un Agente Text-to-SQL
con grounding de esquema de base de datos sin PII, validación y ejecución en
un Sandbox SQLite de solo lectura en el servidor, y auto-corrección de errores.
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional, Tuple

import httpx

from src.application.ai_domain_schema import construir_system_prompt_sql
from src.application.sql_sandbox import ejecutar_consulta_sandbox

logger = logging.getLogger("ganaderos.ai")


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


def _extraer_json_agente(texto: str) -> Optional[dict[str, Any]]:
    """Extrae de forma robusta la estructura de consulta del texto generado por el LLM."""
    if not texto or not isinstance(texto, str):
        return None

    # 1. Intento directo con json.loads
    try:
        return json.loads(texto.strip())
    except Exception:
        pass

    # 2. Bloque markdown ```json ... ```
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", texto, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except Exception:
            pass

    # 3. Primer '{' hasta el último '}'
    start = texto.find("{")
    end = texto.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(texto[start : end + 1])
        except Exception:
            pass

    # 4. Si el modelo devolvió SQL directo sin envoltorio JSON
    sql_match = re.search(r"(SELECT\s+.*)", texto, re.IGNORECASE | re.DOTALL)
    if sql_match:
        sql_clean = sql_match.group(1).strip().rstrip(";").replace("```", "").strip()
        return {
            "sql": sql_clean,
            "interpretacion": "Consulta analítica sobre el censo ganadero",
            "tipo_resultado": "general",
        }

    return None


def _deducir_tipo_resultado(filas: list[dict[str, Any]]) -> str:
    """Clasifica el resultado para que el frontend use la vista especializada óptima."""
    if not filas:
        return "general"
    keys = [k.lower() for k in filas[0].keys()]
    if len(filas) == 1 and len(keys) == 1 and any(k in keys[0] for k in ("count", "total", "suma", "cantidad", "cabezas")):
        return "conteo"
    if any(k in keys for k in ("crotal", "crotal_4")):
        return "animales"
    if any(k in keys for k in ("alimento", "precio_kg")):
        return "compras"
    if any(k in keys for k in ("medicamento", "receta", "dias_retirada")):
        return "recetas"
    return "general"


async def ejecutar_agente_ia_sql(
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None,
    db_path: Optional[Path] = None,
    modelo_solicitado: Optional[str] = None,
    timeout: float = 12.0,
    max_intentos: int = 2,
) -> dict[str, Any]:
    """Agente autónomo Text-to-SQL con Sandbox SQLite de solo lectura y auto-corrección de errores."""
    base_url, api_key = _obtener_config_freellm()
    if not api_key:
        logger.warning("[FreeLLM Agent] Unified_AK no configurada en entorno o .env")
        return {
            "ok": False,
            "error": "Sin credenciales",
            "detail": "Servicio de inferencia LLM no disponible o sin credenciales de API activas.",
        }

    model_name = modelo_solicitado if modelo_solicitado and modelo_solicitado != "auto" else "auto"
    url = f"{base_url}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "GanaderosCampo/2.0",
    }

    # Grounding de dominio y esquema sin PII
    system_prompt = construir_system_prompt_sql(db_path)
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    if historial:
        for msg in historial[-4:]:
            messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
    messages.append({"role": "user", "content": prompt})

    intento_actual = 0
    sql_generada: Optional[str] = None
    interpretacion_generada: str = "Consulta analítica sobre la explotación"
    tipo_resultado: str = "general"
    filas_obtenidas: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=timeout) as client:
        while intento_actual < max_intentos:
            intento_actual += 1
            payload = {
                "model": model_name,
                "messages": messages,
                "temperature": 0.1,
            }

            try:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code != 200:
                    logger.warning(f"[FreeLLM Agent] HTTP {resp.status_code}: {resp.text[:200]}")
                    break

                res_json = resp.json()
                contenido = res_json["choices"][0]["message"].get("content", "").strip()
                parsed = _extraer_json_agente(contenido)

                if not parsed:
                    # Respuesta directa en lenguaje natural
                    return {
                        "ok": True,
                        "sql": None,
                        "params": [],
                        "interpretacion": "Información general:",
                        "respuesta_directa": contenido,
                        "filas": [],
                        "tipo_resultado": "general",
                    }

                sql_generada = parsed.get("sql")
                interpretacion_generada = parsed.get("interpretacion") or interpretacion_generada
                tipo_resultado = parsed.get("tipo_resultado") or tipo_resultado

                # Caso sin SQL: respuesta conceptual directa
                if not sql_generada:
                    return {
                        "ok": True,
                        "sql": None,
                        "params": [],
                        "interpretacion": interpretacion_generada,
                        "respuesta_directa": parsed.get("respuesta_directa") or "Sin datos que consultar.",
                        "filas": [],
                        "tipo_resultado": tipo_resultado,
                    }

                # Si no hay base de datos local disponible para sandbox, devolver la SQL para el cliente
                if not db_path or not db_path.exists():
                    return {
                        "ok": True,
                        "sql": sql_generada,
                        "params": [],
                        "interpretacion": interpretacion_generada,
                        "respuesta_directa": None,
                        "filas": [],
                        "tipo_resultado": tipo_resultado,
                    }

                # Ejecutar en Sandbox SQLite de solo lectura en servidor
                exito, filas, error_sandbox = ejecutar_consulta_sandbox(db_path, sql_generada)

                if exito:
                    filas_obtenidas = filas
                    tipo_resultado = _deducir_tipo_resultado(filas) if tipo_resultado == "general" else tipo_resultado

                    # Síntesis ejecutiva en lenguaje ganadero sobre los datos
                    sintesis = await sintetizar_respuesta_llm(
                        prompt, filas_obtenidas[:15], modelo_solicitado=model_name
                    )

                    return {
                        "ok": True,
                        "sql": sql_generada,
                        "params": [],
                        "interpretacion": interpretacion_generada,
                        "respuesta_directa": sintesis,
                        "filas": filas_obtenidas,
                        "tipo_resultado": tipo_resultado,
                    }

                # Falló en sandbox: retroalimentar error al modelo para auto-corrección
                logger.warning(
                    f"[FreeLLM Agent] Fallo en Sandbox (intento {intento_actual}/{max_intentos}): {error_sandbox} | SQL: {sql_generada}"
                )
                messages.append({"role": "assistant", "content": contenido})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            f"La consulta generó el siguiente error en SQLite: {error_sandbox}.\n"
                            f"Corrige la sentencia SQL teniendo en cuenta las tablas y columnas exactas del esquema."
                        ),
                    }
                )

            except httpx.TimeoutException:
                logger.warning(f"[FreeLLM Agent] Timeout ({timeout}s) en intento {intento_actual}")
                break
            except Exception as e:
                logger.error(f"[FreeLLM Agent] Error inesperado: {e}", exc_info=True)
                break

    # Si se generó una consulta SQL válida que el sandbox no pudo ejecutar por timeout o tras agotar intentos
    if sql_generada:
        return {
            "ok": True,
            "sql": sql_generada,
            "params": [],
            "interpretacion": interpretacion_generada,
            "respuesta_directa": None,
            "filas": [],
            "tipo_resultado": tipo_resultado,
        }

    return {
        "ok": False,
        "error": "Error de inferencia",
        "detail": "Servicio de inferencia LLM no disponible o sin credenciales de API activas.",
    }


async def resolver_intencion_usuario(
    prompt: str,
    historial: Optional[list[dict[str, str]]] = None,
    modelo_solicitado: Optional[str] = None,
    db_path: Optional[Path] = None,
    timeout: float = 12.0,
) -> Tuple[Optional[str], dict[str, Any], bool]:
    """Adaptador de compatibilidad para contratos legados del asistente."""
    resultado = await ejecutar_agente_ia_sql(
        prompt=prompt,
        historial=historial,
        db_path=db_path,
        modelo_solicitado=modelo_solicitado,
        timeout=timeout,
    )
    if not resultado.get("ok"):
        return None, {}, False

    sql = resultado.get("sql")
    interpretacion = resultado.get("interpretacion") or "Consulta analítica sobre la explotación"
    tipo_resultado = resultado.get("tipo_resultado") or "general"
    resp_directa = resultado.get("respuesta_directa")

    if sql:
        args = {
            "sql": sql,
            "interpretacion": interpretacion,
            "tipo_resultado": tipo_resultado,
            "respuesta_directa": resp_directa,
        }
        return "consulta_sql_dinamica", args, False

    if resp_directa:
        return "consulta_informativa_general", {"respuesta": resp_directa}, False

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
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {clave_final}",
        "User-Agent": "GanaderosCampo/2.0",
    }
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
    }

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                content = data["choices"][0]["message"]["content"].strip()
                parsed = _extraer_json_agente(content)
                if parsed and parsed.get("sql"):
                    return "consulta_sql_dinamica", parsed
                return "consulta_informativa_general", {"respuesta": content}
            logger.warning(f"[FreeLLM Sync] HTTP {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"[FreeLLM Sync] Error: {e}")

    return None


clasificar_intencion_groq = clasificar_intencion_freellm
