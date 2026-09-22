#!/usr/bin/env python3
"""Programilla de Descubrimiento, Auditoría y Selección Multi-Proveedor de Modelos IA.

Inspecciona en tiempo real las APIs de OpenRouter, Google Gemini y Groq:
1. Filtra estrictamente el tier gratuito (:free) de OpenRouter con soporte de tool calling.
2. Descubre los modelos de Gemini Flash activos y los ordena por versión decimal decreciente (3.8 > 3.7 > 3.6 > ...).
3. Verifica los modelos activos en Groq para evitar dependencias descontinuadas.
4. Prioriza por nivel de inteligencia según directrices de rate-limits.md.
5. Permite ejecutar tests en vivo de Function Calling y exportar la configuración para el router backend.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Asegurar importación del proyecto
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.application.intents import CATALOGO_HERRAMIENTAS_LLM

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("select_models")

DEFAULT_CONFIG_PATH = ROOT_DIR / "config" / "ai_models_router.json"

# Ranking de inteligencia base para OpenRouter Free según rate-limits.md
OPENROUTER_FREE_INTELLIGENCE_WEIGHTS = {
    "poolside/laguna-s-2.1:free": 100,       # 1.35T Flagship
    "nex-agi/nex-n2.5-pro:free": 95,          # 657B MoE
    "inclusionai/ling-3.0-flash-sante:free": 90, # 327B Alto rendimiento
    "inclusionai/ling-3.0-flash-fin:free": 88,
    "inclusionai/ling-3.0-flash-vl:free": 85,
    "thinkingmachines/inkling-small:free": 82, # 149B
    "thinkingmachines/inkling:free": 80,
    "nex-agi/nex-n2.5-mini:free": 78,         # 123B
    "poolside/laguna-xs-2.1:free": 75,        # 100B
    "qwen/qwen3.8-27b:free": 70,              # 27B
    "nvidia/nemotron-3-super-120b-a12b:free": 68,
    "google/gemma-4-31b-it:free": 65,
    "google/gemma-4-26b-a4b-it:free": 60,
    "liquid/lfm-2.5-2.6b:free": 50,
}

# Ranking para modelos de Mistral AI según rate-limits.md
MISTRAL_INTELLIGENCE_WEIGHTS = {
    "mistral-large-2512": 98,
    "zai-glm-5-3": 92,
    "glm-5-2": 90,
    "codestral-2508": 88,
    "mistral-medium-latest": 85,
    "mistral-small-2603": 80,
    "ministral-14b-2512": 70,
    "ministral-8b-2512": 65,
    "ministral-3b-2512": 55,
}


def obtener_claves_entorno() -> Dict[str, str]:
    """Recupera las claves API desde variables de entorno o archivo .env en Orange Pi/local."""
    claves = {
        "groq": os.environ.get("GROQ_API_KEY") or os.environ.get("GROK_API_KEY", ""),
        "openrouter": os.environ.get("OPENROUTER_API_KEY", ""),
        "gemini": os.environ.get("GEMINI_API_KEY", ""),
        "mistral": os.environ.get("MISTRAL_API_KEY", ""),
    }
    # Intentar cargar .env si las variables no están en el entorno
    env_file = ROOT_DIR / ".env"
    if env_file.exists():
        try:
            with open(env_file, "r", encoding="utf-8") as f:
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
        except Exception as e:
            logger.warning(f"No se pudo parsear .env: {e}")

    return claves


def descubrir_openrouter_free() -> List[Dict[str, Any]]:
    """Consulta el catálogo de OpenRouter y extrae los modelos gratuitos con tool calling."""
    url = "https://openrouter.ai/api/v1/models"
    req = urllib.request.Request(url, headers={"User-Agent": "GanaderosCampo/2.0"})
    modelos_encontrados = []

    try:
        with urllib.request.urlopen(req, timeout=12.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for m in data.get("data", []):
                mid = m.get("id", "")
                if ":free" not in mid:
                    continue

                supported_params = m.get("supported_parameters", [])
                soporta_tools = "tools" in supported_params

                # Calcular peso de inteligencia
                peso = OPENROUTER_FREE_INTELLIGENCE_WEIGHTS.get(mid, 40)
                # Si el modelo tiene benchmarks en metadatos, considerar intelligence_index
                bench = m.get("benchmarks") or {}
                art_analysis = bench.get("artificial_analysis") or {}
                idx = art_analysis.get("intelligence_index")
                if isinstance(idx, (int, float)):
                    peso = max(peso, int(idx * 2))

                modelos_encontrados.append({
                    "provider": "openrouter",
                    "model": mid,
                    "name": f"OpenRouter {m.get('name', mid)}",
                    "url": "https://openrouter.ai/api/v1/chat/completions",
                    "soporta_tools": soporta_tools,
                    "score": peso,
                    "context_length": m.get("context_length", 0),
                })
    except Exception as e:
        logger.error(f"[OpenRouter] Error consultando catálogo: {e}")

    # Ordenar por score de inteligencia desc
    modelos_encontrados.sort(key=lambda x: x["score"], reverse=True)
    return modelos_encontrados


def parsear_version_gemini(model_id: str) -> float:
    """Extrae el número de versión decimal de modelos gemini-X.Y-flash."""
    m = re.search(r"gemini-(\d+(?:\.\d+)?)-flash", model_id)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return 0.0


def descubrir_gemini_models(api_key: str) -> List[Dict[str, Any]]:
    """Descubre los modelos de Gemini disponibles para la clave y los ordena por versión decimal decreciente."""
    if not api_key:
        return []

    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    req = urllib.request.Request(url, headers={"User-Agent": "GanaderosCampo/2.0"})
    candidatos = []

    try:
        with urllib.request.urlopen(req, timeout=12.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for m in data.get("models", []):
                name = m.get("name", "").replace("models/", "")
                methods = m.get("supportedGenerationMethods", [])
                if "generateContent" not in methods:
                    continue

                # Filtrar solo modelos conversacionales de texto/código (no TTS, no sólo imagen)
                if any(k in name for k in ["-tts", "-image", "customtools"]):
                    continue

                # Filtrar modelos relevantes de la familia flash
                if "gemini-" in name and "-flash" in name:
                    version = parsear_version_gemini(name)
                    # Descartar versiones pre-3.0 obsoletas o descontinuadas como 2.5
                    if version < 3.0:
                        continue

                    es_lite = "lite" in name
                    # Score proporcional a la versión decimal (ej. 3.8 -> 380, 3.8-lite -> 370)
                    score = int(version * 100) - (15 if es_lite else 0)

                    candidatos.append({
                        "provider": "gemini",
                        "model": name,
                        "name": f"Gemini {name} (Google AI)",
                        "url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                        "soporta_tools": True,
                        "score": score,
                        "version": version,
                        "es_lite": es_lite,
                    })
    except Exception as e:
        logger.error(f"[Gemini] Error consultando modelos: {e}")

    # Ordenar por score decreciente (3.8 > 3.7 > 3.6 > 3.5 > 3.5-lite > 3.1-lite)
    candidatos.sort(key=lambda x: x["score"], reverse=True)
    return candidatos


def descubrir_groq_models(api_key: str, excluir_gpt_oss: bool = False) -> List[Dict[str, Any]]:
    """Consulta los modelos activos en Groq y los ordena priorizando Qwen sobre gpt-oss."""
    if not api_key:
        return []

    url = "https://api.groq.com/openai/v1/models"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "GanaderosCampo/2.0",
        },
    )
    activos = []

    try:
        with urllib.request.urlopen(req, timeout=10.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            ids = [m.get("id", "") for m in data.get("data", [])]

            if "qwen/qwen3.8-27b" in ids:
                activos.append({
                    "provider": "groq",
                    "model": "qwen/qwen3.8-27b",
                    "name": "Groq Qwen 3.8 27B (Ultra-rápido)",
                    "url": "https://api.groq.com/openai/v1/chat/completions",
                    "soporta_tools": True,
                    "score": 75,
                })

            if not excluir_gpt_oss:
                if "openai/gpt-oss-120b" in ids:
                    activos.append({
                        "provider": "groq",
                        "model": "openai/gpt-oss-120b",
                        "name": "Groq GPT OSS 120B (Fallback final)",
                        "url": "https://api.groq.com/openai/v1/chat/completions",
                        "soporta_tools": True,
                        "score": 30,  # Relegado a score bajo
                    })
                if "openai/gpt-oss-20b" in ids:
                    activos.append({
                        "provider": "groq",
                        "model": "openai/gpt-oss-20b",
                        "name": "Groq GPT OSS 20B (Básico)",
                        "url": "https://api.groq.com/openai/v1/chat/completions",
                        "soporta_tools": True,
                        "score": 25,
                    })
    except Exception as e:
        logger.error(f"[Groq] Error consultando modelos: {e}")

    return activos


def descubrir_mistral_models(api_key: str) -> List[Dict[str, Any]]:
    """Descubre los modelos activos en Mistral AI y los clasifica por inteligencia."""
    if not api_key:
        return []

    url = "https://api.mistral.ai/v1/models"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "GanaderosCampo/2.0",
        },
    )
    candidatos = []
    try:
        with urllib.request.urlopen(req, timeout=10.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            ids = [m.get("id", "") for m in data.get("data", [])]
            for mid in ids:
                if any(k in mid for k in ["embed", "moderation"]):
                    continue
                score = MISTRAL_INTELLIGENCE_WEIGHTS.get(mid, 60)
                candidatos.append({
                    "provider": "mistral",
                    "model": mid,
                    "name": f"Mistral {mid}",
                    "url": "https://api.mistral.ai/v1/chat/completions",
                    "soporta_tools": True,
                    "score": score,
                })
    except Exception as e:
        logger.error(f"[Mistral] Error consultando modelos: {e}")

    candidatos.sort(key=lambda x: x["score"], reverse=True)
    return candidatos


def test_model_tool_calling(cand: Dict[str, Any], api_key: str) -> Tuple[bool, str]:
    """Prueba en vivo si el modelo responde a Tool Calling con el catálogo ganadero."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "GanaderosCampo/2.0",
    }
    if cand["provider"] == "openrouter":
        headers["HTTP-Referer"] = "https://ganaderos.local"
        headers["X-Title"] = "Ganaderos Campo"

    payload = {
        "model": cand["model"],
        "messages": [{"role": "user", "content": "Ver ficha de la vaca 1045"}],
        "tools": CATALOGO_HERRAMIENTAS_LLM,
        "tool_choice": "auto",
        "temperature": 0.1,
    }

    req = urllib.request.Request(
        cand["url"],
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=12.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            choice = data["choices"][0]["message"]
            if choice.get("tool_calls"):
                func_name = choice["tool_calls"][0]["function"]["name"]
                return True, f"Tool Call OK: {func_name}"
            content = choice.get("content", "").strip()
            return True, f"Texto directo: {content[:40]}..."
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        return False, f"HTTP {e.code}: {err_msg[:90]}"
    except Exception as e:
        return False, f"Error de red: {str(e)[:90]}"


def compilar_catalogo_priorizado(
    claves: Dict[str, str],
    excluir_gpt_oss: bool = False,
    probar_en_vivo: bool = False,
) -> List[Dict[str, Any]]:
    """Construye la lista ordenada global combinando Gemini, OpenRouter Free, Groq y Mistral."""
    logger.info("Iniciando descubrimiento de modelos en APIs...")

    modelos_gemini = descubrir_gemini_models(claves.get("gemini", ""))
    modelos_openrouter = descubrir_openrouter_free()
    modelos_groq = descubrir_groq_models(claves.get("groq", ""), excluir_gpt_oss=excluir_gpt_oss)
    modelos_mistral = descubrir_mistral_models(claves.get("mistral", ""))

    # Filtrar OpenRouter solo a aquellos con soporte explícito de tools
    openrouter_tools = [m for m in modelos_openrouter if m["soporta_tools"]]

    logger.info(
        f"Descubiertos: {len(modelos_gemini)} Gemini, {len(openrouter_tools)} OpenRouter Free (con tools), "
        f"{len(modelos_groq)} Groq, {len(modelos_mistral)} Mistral."
    )

    # Ensamblar por niveles de inteligencia
    # Nivel 1: Flagships máximos (Gemini 3.8/3.7/3.6/3.5 y Mistral Large)
    tier_1_flagships = [m for m in modelos_gemini if not m.get("es_lite", False)]
    tier_1_flagships += [m for m in modelos_mistral if m["score"] >= 95]

    # Nivel 2: OpenRouter Top Tier Free (score >= 80: Laguna S 2.1, Nex Pro, Ling Sante, Inkling)
    tier_2_openrouter_top = [m for m in openrouter_tools if m["score"] >= 80]

    # Nivel 3: Razonamiento rápido (Groq Qwen 27B, OpenRouter Qwen 27B, Codestral/Mistral Small)
    tier_3_fast_reasoning = [m for m in modelos_groq if "qwen" in m["model"]]
    tier_3_fast_reasoning += [m for m in openrouter_tools if "qwen" in m["model"] and m not in tier_2_openrouter_top]
    tier_3_fast_reasoning += [m for m in modelos_mistral if m["score"] < 95]

    # Nivel 4: Gemini High-Quota Tier (Lite: 3.5-lite, 3.1-lite con 500 RPD)
    tier_4_gemini_lite = [m for m in modelos_gemini if m.get("es_lite", False)]

    # Nivel 5: OpenRouter Secondary Free (score < 80)
    tier_5_openrouter_sec = [m for m in openrouter_tools if m["score"] < 80 and "qwen" not in m["model"]]

    # Nivel 6: Groq GPT-OSS (MANTENIDO COMO ÚLTIMO RECURSO / RED DE SEGURIDAD ANTES DE FALLAR)
    tier_6_safety_groq = [m for m in modelos_groq if "gpt-oss" in m["model"]]

    lista_completa = []
    vistos = set()
    for lista_tier in [
        tier_1_flagships,
        tier_2_openrouter_top,
        tier_3_fast_reasoning,
        tier_4_gemini_lite,
        tier_5_openrouter_sec,
        tier_6_safety_groq,
    ]:
        for cand in lista_tier:
            clave_unica = (cand["provider"], cand["model"])
            if clave_unica not in vistos:
                vistos.add(clave_unica)
                lista_completa.append(cand)

    if probar_en_vivo:
        logger.info("Ejecutando pruebas de Tool Calling en vivo...")
        validados = []
        for cand in lista_completa:
            prov = cand["provider"]
            key = claves.get(prov, "")
            if not key:
                logger.warning(f"Omitiendo test de {cand['name']}: Sin API Key para {prov}.")
                continue
            ok, msg = test_model_tool_calling(cand, key)
            logger.info(f"[{'PASS' if ok else 'FAIL'}] {cand['name']} ({cand['model']}) -> {msg}")
            if ok:
                validados.append(cand)
        return validados

    return lista_completa


def guardar_configuracion(modelos: List[Dict[str, Any]], destino: Path) -> None:
    """Exporta el catálogo ordenado a un archivo JSON legible para el router."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    salida = {
        "version": "1.0.0",
        "description": "Catalogo de modelos multi-proveedor priorizado por inteligencia y disponibilidad",
        "total_modelos": len(modelos),
        "modelos": [
            {
                "provider": m["provider"],
                "model": m["model"],
                "name": m["name"],
                "url": m["url"],
                "score": m.get("score", 0),
            }
            for m in modelos
        ],
    }
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(salida, f, indent=2, ensure_ascii=False)
    logger.info(f"Configuración guardada exitosamente en: {destino}")


def main():
    parser = argparse.ArgumentParser(description="Selector y auditor multi-proveedor de modelos IA ganaderos.")
    parser.add_argument("--test", action="store_true", help="Realiza una prueba real de Tool Calling en los modelos descubiertos.")
    parser.add_argument("--no-gpt-oss", action="store_true", help="Excluye completamente los modelos openai/gpt-oss-*.")
    parser.add_argument("--output", type=str, default=str(DEFAULT_CONFIG_PATH), help="Ruta de destino del archivo JSON.")
    parser.add_argument("--verbose", action="store_true", help="Muestra información detallada de cada modelo.")
    args = parser.parse_args()

    claves = obtener_claves_entorno()
    logger.info(f"Claves detectadas: Groq={'OK' if claves['groq'] else 'NO'}, OpenRouter={'OK' if claves['openrouter'] else 'NO'}, Gemini={'OK' if claves['gemini'] else 'NO'}")

    modelos = compilar_catalogo_priorizado(
        claves=claves,
        excluir_gpt_oss=args.no_gpt_oss,
        probar_en_vivo=args.test,
    )

    print("\n" + "=" * 80)
    print(f"{'#':<3} | {'PROVEEDOR':<11} | {'SCORE':<5} | {'MODELO':<42} | {'NOMBRE'}")
    print("-" * 80)
    for i, m in enumerate(modelos, 1):
        print(f"{i:<3} | {m['provider']:<11} | {m.get('score', 0):<5} | {m['model']:<42} | {m['name']}")
    print("=" * 80 + "\n")

    destino_path = Path(args.output)
    guardar_configuracion(modelos, destino_path)


if __name__ == "__main__":
    main()
