# ADR 0007: Framework de Benchmarking y Evaluación Cuantitativa del Asistente de IA

- **Estado:** Aceptado
- **Fecha:** 2026-09-22
- **Decisores:** Álvaro Gil, Lead Systems Architect

---

## Contexto y Declaración del Problema

El asistente de lenguaje natural de Ganaderos Campo debe operar tanto online (Groq LLM Llama 3.3) como offline (motor heurístico de expresiones regulares y tokenización). En auditorías de software senior, un asistente sin una suite de evaluación cuantitativa se cataloga como "vibe coding".

Necesitamos una metodología estándar y reproducible para evaluar cuantitativamente la precisión de clasificación de intenciones, la extracción de parámetros de negocio (crotales, lotes, fechas) y la robustez ante ruido acústico y ataques de inyección, sin incurrir en costes prohibitivos de API ni dependencias pesadas en CI.

---

## Opciones Consideradas

1. **Framework pesado con LLM-as-a-Judge (DeepEval / Ragas):** Requiere llamadas a APIs de OpenAI o modelos pesados locales (PyTorch). Introduce lentitud, coste por token y variabilidad estocástica en CI.
2. **Plataforma Externa Específica (BFCL v4 CLI / Inspect):** Diseñada para comparar modelos fundacionales, no para testing continuo de casos de uso agrotech en repositorios de producción.
3. **Harness Estandarizado Basado en Métricas BFCL con Dataset JSON Portable (Seleccionada):** Implementa un evaluador determinista en Python que calcula Accuracy de Intents, Recall de Argumentos (AST match) y validación de esquemas Pydantic, desacoplado de proveedores externos para CI y compatible con Promptfoo.

---

## Decisión Tomada

Se adopta la **Opción 3**:
1. Creación de un dataset canónico de 60 casos de uso ganaderos (`tests/eval/dataset_intents_campo.json`).
2. Implementación de un runner de benchmarking (`scripts/run_ai_benchmark.py`) y una suite de pruebas de regresión (`tests/eval/test_benchmark_intents.py`).
3. Quality Gate en CI: La suite fallará si la exactitud de clasificación de intents del motor desciende del 90%.

---

## Consecuencias

### Positivas
- **Cero costes de ejecución en CI:** El harness offline evalúa de forma instantánea (< 0.1s) sin necesidad de API keys.
- **Reproducibilidad:** Cada pull request valida cuantitativamente que ningún cambio en prompts o reglas introduce regresiones en frases de campo.
- **Transparencia:** Generación automática de matrices de confusión y resúmenes Markdown en `reports/eval_summary.md`.

### Negativas
- Requiere mantener actualizado el dataset de frases cuando se añadan nuevos tipos de intents de negocio.
