# Estudio Comparativo de Frameworks de Benchmarking y Evaluación de IA para Intent & Tool Calling

## 1. Introducción y Contexto del Dominio
En **Ganaderos Campo**, el asistente en lenguaje natural no es un chatbot conversacional genérico, sino un **agente de consulta transaccional y determinista** que opera en un entorno hostil (dehesas y fincas sin cobertura). Su misión es traducir lenguaje oral/escrito ganadero a **Intents Tipados** parametrizados que ejecutan consultas SQL relacionales sobre la base de datos de la explotación.

Para garantizar que el asistente no alucina, no corrompe datos y es robusto ante el ruido acústico y léxico del campo, se requiere una **suite de benchmarking y evaluación cuantitativa** integrada en el pipeline de ingeniería.

---

## 2. Análisis del Estado del Arte (Benchmarks y Frameworks)

| Framework / Benchmark | Enfoque Principal | Pros | Contras | Veredicto para Ganaderos Campo |
|---|---|---|---|---|
| **Berkeley Function Calling Leaderboard (BFCL v4)** | Evaluación AST de llamadas a funciones y validación estricta de argumentos. | Es el estándar de oro en la industria. Evalúa coincidencia sintáctica y semántica de parámetros. | Diseñado como plataforma de ranking global; pesado para ejecutar como test de commit en CI. | **Adoptar su metodología:** Evaluación AST y validación estricta de parámetros en nuestro harness. |
| **Promptfoo** | Testing declarativo de LLMs, tool calls, red-teaming y latencia vía CLI. | Muy ligero, compatible con CI/CD, reportes HTML visuales, aserciones deterministas (`is-json`, `javascript`). | Requiere runtime Node.js adicional si se aísla de Python. | **Excelente compatibilidad:** Diseñar el dataset en JSON estructurado compatible con Promptfoo. |
| **Confident AI (DeepEval)** | Pruebas de LLM estilo Pytest (`assert_test`) en ecosistemas Python. | Integración nativa con Pytest, métricas de `ToolCorrectnessMetric`. | Dependencias pesadas y necesidad frecuente de un "LLM-as-a-Judge" externo (costes de API y latencia). | **Inspiración métrica:** Usar métricas análogas de Tool Correctness implementadas de forma determinista y sin coste. |
| **Ragas** | Evaluación de arquitecturas RAG (Retrieval Augmented Generation). | Estándar para evaluar fidelidad de contexto recuperado (Faithfulness). | Orientado a embeddings y vector databases, no a Intent Calling / SQL relacional. | **Descartado:** No aplicable a nuestro modelo relacional local-first. |
| **Inspect (UK AISI)** | Evaluación de capacidades y seguridad en modelos de frontera. | Riguroso y formal para auditorías de alineamiento. | Excesivamente complejo para sistemas transaccionales en Edge. | **Descartado:** Complejidad accidental desproporcionada. |

---

## 3. Dimensiones y Métricas Formales de Evaluación

Para evitar "Architecture Theater" y medir la eficacia real sobre el terreno, se definen cuatro métricas cuantitativas obligatorias:

### 1. Exactitud de Selección de Intent ($Accuracy_{intent}$)
$$\text{Accuracy}_{\text{intent}} = \frac{\sum_{i=1}^{N} \mathbb{I}(\hat{y}_i = y_i)}{N} \ge 90\%$$
Mide si la consulta del ganadero se encamina al caso de uso correcto (ej. `consultar_partos_madre` frente a `listar_vacas_sin_parir`).

### 2. Concordancia Exacta de Parámetros ($ExactMatch_{args}$ / AST Match)
$$\text{Recall}_{\text{args}} = \frac{|Args_{\text{extraídos}} \cap Args_{\text{esperados}}|}{|Args_{\text{esperados}}|}$$
Verifica que los identificadores de crotal (4 dígitos o 14 dígitos), nombres de lotes/corrales y límites temporales sean extraídos exactamente con el tipo y valor esperados sin perder dígitos.

### 3. Validez de Esquema y Determinismo ($SchemaValidity$)
$$SchemaValidity = 100\%$$
Toda salida debe parsear sin excepciones contra los modelos Pydantic v2 (`IntentResponse`) y generar consultas SQL parametrizadas con placeholders `?`.

### 4. Perfil de Latencia y Eficiencia Edge
- **Motor Heurístico Offline:** $P_{95} \le 5\text{ ms}$ (ejecución instantánea en el dispositivo).
- **Gateway LLM Online (Groq Llama 3.3):** $P_{95} \le 1200\text{ ms}$ en condiciones de red 3G/4G.

---

## 4. Diseño del Dataset de Evaluación Ganadera (`dataset_intents_campo.json`)

El dataset consta de 60 casos de prueba divididos en 8 categorías del mundo real:
1. **Búsqueda Directa por Crotal:** 4 dígitos numéricos, crotales oficiales completos con prefijo de comunidad autónoma.
2. **Censo por Cercado o Corral:** Lotes específicos de la explotación (Dueña, Espadaña, Rivera, Vega, Cebadero).
3. **Reproducción y Vacas Nodrizas:** Detección de vacías, retrasos en el parto, primer parto tardío.
4. **Sanidad Animal y Supresiones:** Retiradas de carne por tratamientos veterinarios y medicamentos prescritos.
5. **Movimientos y Trazabilidad Oficial:** Traspasos entre códigos REGA/CEA (121 vida vs 122 cebadero).
6. **Alimentación y Costes:** Compras de pienso a cooperativas y consumo de lotes.
7. **Robustez ante Ruido Fonético de Whisper:** Palabras cortadas, transcripción en texto de números ("diez cuarenta y cinco"), sinónimos locales.
8. **Consultas Fuera de Alcance y Adversarias (Red-Teaming):** Inyecciones SQL (`'; DROP TABLE animales;--`), preguntas no ganaderas ("¿qué tiempo hace?", "¿cuéntame un chiste?").

---

## 5. Conclusión y Decisión Técnica
Se implementa un **harness determinista nativo en Python** respaldado por un dataset JSON estándar:
- **Cero reinvención de la rueda:** Adopta las métricas de BFCL v4 y la arquitectura de tests de DeepEval.
- **Sin costes por API:** Capaz de ejecutarse en local y en CI sin credenciales externas para pruebas de regresión deterministas.
- **Portabilidad:** Exportable a herramientas como Promptfoo mediante un CLI unificado (`scripts/run_ai_benchmark.py`).
