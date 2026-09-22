# ADR 0002: Intent Calling Tipado vs. Text-to-SQL No Restringido

* **Estado:** Aceptado
* **Fecha:** 2026-09-20
* **Decisores:** Equipo de Arquitectura y AI Engineering Ganaderos Campo

## Contexto y Planteamiento del Problema
Para facilitar la consulta rápida en manga o a caballo, se requiere un asistente conversacional capaz de interpretar preguntas en lenguaje natural ("¿Cuántas vacas han parido en Dueña este año?", "Dime las crías de la 1045", "Traspasos recientes al cebadero").

En la industria es común pedirle a un LLM que genere directamente sentencias SQL (`Text-to-SQL libre`). Sin embargo, en un entorno ganadero de producción este patrón presenta riesgos inaceptables:
1. **Riesgo de Inyección SQL y Destrucción de Datos:** Aunque la base sea de solo lectura en cliente, sentencias maliciosas o alucinadas pueden corromper la sesión o ejecutar comandos no previstos.
2. **Alucinaciones de Esquema:** Los LLMs inventan nombres de tablas, columnas o funciones inexistentes en SQLite, causando fallos en tiempo de ejecución.
3. **Falta de Privacidad:** En Text-to-SQL convencional, se suele enviar el esquema completo o muestras de datos a la nube para guiar al modelo.

## Alternativas Consideradas
1. **Text-to-SQL Directo (Prompt con DDL hacia OpenAI/Groq):** Descartado por vulnerabilidad a alucinaciones, sobrecoste de tokens y riesgo de consultas no deterministas.
2. **Embeddings Vectoriales y RAG Semántico:** Descartado para consultas cuantitativas estructuradas ("¿Cuántas vacas...?", "¿Fecha del último parto?"). Los vectores no resuelven agregaciones relacionales exactas.
3. **Tool Calling / Intent Calling Tipado con Constructor SQL Determinista:** Seleccionado. El LLM se restringe estrictamente a un extractor de intención y argumentos cerrados.

## Decisión
Implementar un sistema de dos capas desacopladas:
1. **Capa Semántica (Extractor de Intención):** Un catálogo cerrado de herramientas tipadas (`src/application/intents.py`) define esquemas JSON Schema de las intenciones soportadas (ej: `consultar_ficha_animal`, `consultar_censo_corral`, `consultar_vacas_sin_parir`, `consultar_supresion_lote`). El LLM (Groq Llama 3.3) debe invocar obligatoriamente una función del catálogo.
2. **Capa Determinista (`QueryBuilder`):** El código de la aplicación valida los argumentos (crotales, corrales) y ensambla una sentencia SQL pre-verificada usando parámetros ligados (`?`). La base de datos local ejecuta la consulta parametrizada.
3. **Asistente Híbrido Conectado y Degradación Grácil (Enmienda ADR 0008):** El asistente en lenguaje natural y dictado por voz se define como un servicio conectado asistido por servidor/Cloud. Cuando no hay red, la aplicación aplica *Degradación Grácil* transparente, guiando al ganadero al buscador directo por 4 dígitos de crotal y a las vistas de censo y corrales, que son 100% Offline-First en SQLite WASM local (sustituyendo el fallback heurístico inicial por simplicidad y robustez, conforme a YAGNI y KISS).

## Consecuencias

### Positivas
- **Inmunidad a Inyecciones SQL:** Al usar sentencias parametrizadas generadas por código probado, es imposible inyectar código SQL arbitrario.
- **Tasa Cero de Errores Sintácticos:** Todas las plantillas SQL son validadas exhaustivamente mediante pruebas unitarias.
- **Privacidad Absoluta de Datos:** A la nube del LLM solo viaja la pregunta formulada ("vacas en Dueña"), nunca el censo de animales ni los datos de la explotación.
- **Degradación Elegante:** Si la red se cae o la cuota de la API se agota, el sistema degrada de forma transparente hacia la navegación táctil y búsqueda determinista por 4 dígitos de la base SQLite WASM local.

### Negativas / Desafíos
- **Catálogo Finito de Consultas:** Nuevos tipos de preguntas complejas requieren registrar una nueva intención y su correspondiente método en `QueryBuilder`.
