#!/usr/bin/env python3
"""Runner de Benchmarking y Evaluación Cuantitativa del Asistente de IA Ganadero.

Evalúa de forma determinista la precisión de clasificación de intenciones,
la extracción exacta de parámetros (AST Match) y la latencia del motor en campo.
Inspirado en los principios métricos de Berkeley Function Calling Leaderboard (BFCL v4).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List

# Asegurar importación del proyecto
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.application.query_builder import construir_consulta_intent
from src.infrastructure.llm_gateway import clasificar_intencion_heuristica

DATASET_PATH = ROOT_DIR / "tests" / "eval" / "dataset_intents_campo.json"
REPORTS_DIR = ROOT_DIR / "reports"


@dataclass
class EvalResult:
    case_id: str
    prompt: str
    categoria: str
    expected_intent: str
    predicted_intent: str
    intent_match: bool
    expected_args: Dict[str, Any]
    predicted_args: Dict[str, Any]
    args_match: bool
    query_built_ok: bool
    latency_ms: float
    error_msg: str = ""


def evaluar_caso(case: dict) -> EvalResult:
    prompt = case["prompt"]
    expected_intent = case["intent_esperado"]
    expected_args = case.get("args_esperados", {})

    t0 = time.perf_counter()
    predicted_intent, predicted_args = clasificar_intencion_heuristica(prompt)
    latency_ms = (time.perf_counter() - t0) * 1000.0

    intent_match = (predicted_intent == expected_intent)

    # Validación de argumentos esperados (AST Match)
    args_match = True
    for k, v in expected_args.items():
        val_pred = predicted_args.get(k)
        if str(val_pred).upper() != str(v).upper():
            args_match = False
            break

    # Validación de construcción de consulta determinista sin excepciones
    query_ok = False
    err = ""
    try:
        q = construir_consulta_intent(predicted_intent, predicted_args)
        if q and (q.sql or q.tipo_resultado == "texto" or q.respuesta_directa):
            query_ok = True
    except Exception as e:
        err = str(e)

    return EvalResult(
        case_id=case["id"],
        prompt=prompt,
        categoria=case.get("categoria", "general"),
        expected_intent=expected_intent,
        predicted_intent=predicted_intent,
        intent_match=intent_match,
        expected_args=expected_args,
        predicted_args=predicted_args,
        args_match=args_match,
        query_built_ok=query_ok,
        latency_ms=latency_ms,
        error_msg=err
    )


def ejecutar_benchmark(dataset_file: Path = DATASET_PATH) -> tuple[List[EvalResult], dict]:
    if not dataset_file.exists():
        raise FileNotFoundError(f"Dataset de evaluación no encontrado en {dataset_file}")

    with open(dataset_file, "r", encoding="utf-8") as f:
        cases = json.load(f)

    results: List[EvalResult] = []
    for c in cases:
        results.append(evaluar_caso(c))

    total = len(results)
    correct_intents = sum(1 for r in results if r.intent_match)
    correct_args = sum(1 for r in results if r.args_match)
    queries_ok = sum(1 for r in results if r.query_built_ok)

    accuracy_intent = (correct_intents / total) if total > 0 else 0.0
    accuracy_args = (correct_args / total) if total > 0 else 0.0
    query_success_rate = (queries_ok / total) if total > 0 else 0.0

    latencies = sorted([r.latency_ms for r in results])
    p50_lat = latencies[int(len(latencies) * 0.50)]
    p95_lat = latencies[int(len(latencies) * 0.95)]
    mean_lat = sum(latencies) / len(latencies)

    # Métricas por categoría
    categorias: dict[str, dict[str, int]] = {}
    for r in results:
        cat = r.categoria
        if cat not in categorias:
            categorias[cat] = {"total": 0, "correct": 0}
        categorias[cat]["total"] += 1
        if r.intent_match:
            categorias[cat]["correct"] += 1

    category_breakdown = {
        cat: {
            "total": data["total"],
            "correct": data["correct"],
            "accuracy": round(data["correct"] / data["total"], 3)
        }
        for cat, data in categorias.items()
    }

    metrics = {
        "total_cases": total,
        "correct_intents": correct_intents,
        "intent_accuracy": round(accuracy_intent, 4),
        "args_accuracy": round(accuracy_args, 4),
        "query_validity_rate": round(query_success_rate, 4),
        "latency_p50_ms": round(p50_lat, 4),
        "latency_p95_ms": round(p95_lat, 4),
        "latency_mean_ms": round(mean_lat, 4),
        "category_breakdown": category_breakdown
    }

    return results, metrics


def generar_reporte_markdown(metrics: dict, results: List[EvalResult], out_file: Path) -> None:
    out_file.parent.mkdir(parents=True, exist_ok=True)
    fallos = [r for r in results if not r.intent_match or not r.args_match]

    md = f"""# Informe Cuantitativo de Evaluación del Asistente IA (Benchmark Ganadero)

- **Fecha:** {time.strftime("%Y-%m-%d %H:%M:%S")}
- **Total de Casos Evaluados:** {metrics['total_cases']}
- **Exactitud Global de Intent (Accuracy):** {metrics['intent_accuracy'] * 100:.1f}%
- **Exactitud de Argumentos (AST Match):** {metrics['args_accuracy'] * 100:.1f}%
- **Validez de Consultas SQL Generadas:** {metrics['query_validity_rate'] * 100:.1f}%
- **Latencia de Inferencia P95:** {metrics['latency_p95_ms']:.3f} ms (Motor Offline)

---

## 1. Desglose por Categoría de Campo

| Categoría | Casos | Aciertos | Precisión (%) |
|---|---|---|---|
"""
    for cat, data in metrics["category_breakdown"].items():
        md += f"| `{cat}` | {data['total']} | {data['correct']} | {data['accuracy'] * 100:.1f}% |\n"

    md += """
---

## 2. Perfil de Rendimiento y Latencia

| Métrica | Tiempo (ms) |
|---|---|
| **Mediana (P50)** | """ + f"{metrics['latency_p50_ms']:.3f} ms |\n"
    md += f"| **Percentil 95 (P95)** | {metrics['latency_p95_ms']:.3f} ms |\n"
    md += f"| **Media Aritmética** | {metrics['latency_mean_ms']:.3f} ms |\n"

    if fallos:
        md += """
---

## 3. Detalle de Casos con Discrepancia o Fallo

| ID | Prompt | Intent Esperado | Intent Predicho | Args Match |
|---|---|---|---|---|
"""
        for f in fallos:
            md += f"| `{f.case_id}` | \"{f.prompt}\" | `{f.expected_intent}` | `{f.predicted_intent}` | {'✅' if f.args_match else '❌'} |\n"
    else:
        md += "\n---\n\n## 3. Discrepancias\n\n✅ **Cero fallos:** Todos los casos del dataset superaron la clasificación y extracción de argumentos.\n"

    out_file.write_text(md, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Suite de Benchmarking de IA Ganadera")
    parser.add_argument("--min-accuracy", type=float, default=0.90, help="Umbral mínimo de exactitud (ej. 0.90)")
    parser.add_argument("--dataset", type=Path, default=DATASET_PATH, help="Ruta al dataset de evaluación")
    args = parser.parse_args()

    print("==================================================================")
    print("SUITE DE BENCHMARKING DE IA GANADERA (EVALUACIÓN CUANTITATIVA)")
    print("==================================================================")
    print(f"Cargando dataset: {args.dataset}...")

    results, metrics = ejecutar_benchmark(args.dataset)

    print("\nResultados Globales:")
    print(f"  - Total Casos:       {metrics['total_cases']}")
    print(f"  - Intent Accuracy:   {metrics['intent_accuracy'] * 100:.1f}% (Umbral: {args.min_accuracy * 100:.1f}%)")
    print(f"  - Args AST Match:    {metrics['args_accuracy'] * 100:.1f}%")
    print(f"  - Query SQL Validity:{metrics['query_validity_rate'] * 100:.1f}%")
    print(f"  - Latencia P95:      {metrics['latency_p95_ms']:.3f} ms")

    print("\nDesglose por Categoría:")
    for cat, data in metrics["category_breakdown"].items():
        estado = "[OK]" if data["accuracy"] >= args.min_accuracy else "[BAJO]"
        print(f"  {estado} {cat:<22}: {data['correct']}/{data['total']} ({data['accuracy']*100:.1f}%)")

    # Guardar reportes
    md_report = REPORTS_DIR / "eval_summary.md"
    json_report = REPORTS_DIR / "eval_latest.json"
    generar_reporte_markdown(metrics, results, md_report)
    json_report.write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")

    print("\nReportes generados en:")
    print(f"  - Markdown: {md_report}")
    print(f"  - JSON:     {json_report}")
    print("==================================================================")

    if metrics["intent_accuracy"] < args.min_accuracy:
        print(f"FALLO DE REGRESIÓN: Exactitud {metrics['intent_accuracy']*100:.1f}% inferior al umbral {args.min_accuracy*100:.1f}%.")
        sys.exit(1)
    else:
        print("EXITO: Suite de benchmarking superada conforme a los estándares de calidad.")
        sys.exit(0)


if __name__ == "__main__":
    main()
