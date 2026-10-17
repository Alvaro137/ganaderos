# ADR 0007: Marco de evaluación cuantitativa del asistente de IA

- **Estado:** Aceptado
- **Fecha:** 2026-09-22
- **Decisores:** Álvaro Gil, Lead Systems Architect

## Contexto y planteamiento del problema

El asistente en lenguaje natural de Ganaderos Campo debe clasificar intenciones y extraer parámetros estructurados (crotales, lotes, fechas) de consultas de campo. Sin una batería de pruebas cuantitativa y reproducible, no es posible detectar regresiones ante modificaciones en las instrucciones del sistema (prompts) o en las definiciones de esquemas.

Se requiere un método sistemático para medir la exactitud en la asignación de intenciones, la cobertura de argumentos y la resistencia ante errores de transcripción o entradas anómalas, sin generar costes de API ni introducir latencias elevadas en el flujo de integración continua.

## Alternativas consideradas

1. Evaluación basada en modelos externos (DeepEval o Ragas): Descartada. Exige llamadas a modelos propietarios o ejecución local con dependencias de cálculo complejas (PyTorch), lo que añade coste económico, variabilidad en los resultados y tiempos excesivos en CI.
2. Plataformas externas de evaluación comparativa (BFCL v4 o Inspect): Descartada. Están orientadas a comparar modelos base de proveedores y no a verificar casos de uso específicos del dominio agropecuario en un repositorio de producción.
3. Batería de pruebas interna basada en métricas BFCL con datos en JSON: Seleccionada. Implementa un evaluador determinista en Python que calcula exactitud de intenciones, coincidencia de argumentos tipados y validación mediante esquemas Pydantic, sin dependencias de red en el proceso de verificación.

## Decisión

Adoptar una batería de pruebas interna determinista:
1. Crear un conjunto canónico de 60 casos de prueba en formato estructurado (`tests/eval/dataset_intents_campo.json`).
2. Implementar un ejecutor de pruebas (`scripts/run_ai_benchmark.py`) y una suite de pruebas de regresión (`tests/eval/test_benchmark_intents.py`).
3. Criterio de aceptación en integración continua: la ejecución falla si la exactitud global en la clasificación de intenciones cae por debajo del 90%.

## Consecuencias

### Positivas
- Sin coste de API en integración continua: las pruebas locales se ejecutan en menos de 0,1 segundos sin requerir credenciales externas.
- Reproducibilidad: cada solicitud de cambio (pull request) valida de forma automática que las modificaciones de esquemas o plantillas no degradan la tasa de acierto.
- Generación de informes estructurados: exportación directa de matrices de confusión y resúmenes de rendimiento en formato Markdown (`reports/eval_summary.md`).

### Negativas y limitaciones
- Mantenimiento del conjunto de datos: cada nueva intención de negocio exige registrar nuevos ejemplos representativos en el archivo JSON de evaluación.
