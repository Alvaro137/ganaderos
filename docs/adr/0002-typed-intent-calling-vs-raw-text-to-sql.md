# ADR 0002: Invocación tipada de intenciones frente a text-to-sql libre

- **Estado:** Aceptado
- **Fecha:** 2026-09-20
- **Decisores:** Equipo de arquitectura y software de Ganaderos Campo

## Contexto y planteamiento del problema

Para agilizar las consultas durante el manejo de ganado, se requiere una interfaz en lenguaje natural que interprete preguntas de los operarios (por ejemplo, "¿Cuántas vacas han parido en Dueña este año?", "Dime las crías de la 1045", "Traspasos recientes al cebadero").

Generar sentencias SQL directamente con un modelo de lenguaje (text-to-sql libre) introduce tres problemas técnicos en un entorno de producción:
1. Riesgo de inyección SQL y alteración de datos: sentencias no previstas pueden modificar el estado o saturar recursos del cliente.
2. Consultas con esquema inexistente: los modelos de lenguaje pueden generar nombres de tablas, columnas o funciones no disponibles en SQLite.
3. Exposición de datos privados: el enfoque convencional suele enviar el esquema relacional completo o muestras de registros a un proveedor externo.

## Alternativas consideradas

1. Text-to-SQL directo con volcado de DDL en el prompt: Descartada. Presenta alta tasa de error sintáctico, mayor consumo de tokens y respuestas no deterministas.
2. Búsqueda vectorial y RAG semántico: Descartada. La indexación vectorial no resuelve agregaciones relacionales numéricas ni filtros relacionales exactos.
3. Invocación de intenciones tipadas con constructor SQL determinista: Seleccionada. El modelo de lenguaje se limita a extraer la intención y los parámetros validados.

## Decisión

Implementar un sistema desacoplado en dos capas:
1. Capa semántica (extractor de intenciones): un catálogo tipado (`src/application/intents.py`) define esquemas JSON Schema para las operaciones admitidas (`consultar_ficha_animal`, `consultar_censo_corral`, `consultar_vacas_sin_parir`, `consultar_supresion_lote`). El modelo de lenguaje (Llama 3.3 vía Groq) debe seleccionar exclusivamente una función del catálogo.
2. Capa determinista (`QueryBuilder`): el código de la aplicación valida los argumentos (crotales, lotes) y construye sentencias SQL parametrizadas con marcadores de posición (`?`). El motor SQLite local ejecuta la consulta.
3. Degradación controlada sin conexión (enmienda ADR 0008): el asistente por voz y lenguaje natural opera como servicio conectado. Cuando no hay red, la aplicación muestra avisos claros y dirige al usuario a la búsqueda manual por 4 dígitos de crotal y a las vistas de censo y lotes, que funcionan en local con SQLite WebAssembly.

## Consecuencias

### Positivas
- Prevención de inyección SQL: el uso de sentencias preparadas con parámetros ligados impide la ejecución de código SQL arbitrario.
- Eliminación de errores de sintaxis: las plantillas SQL se verifican mediante pruebas unitarias automatizadas.
- Privacidad de datos: hacia el servicio del modelo solo viaja la pregunta formulada ("vacas en Dueña"), sin transmitir el censo ni registros de la explotación.
- Degradación funcional clara: si la conexión falla o se agota la cuota del proveedor, el sistema redirige al usuario a la búsqueda directa por 4 dígitos en SQLite local.

### Negativas y limitaciones
- Catálogo cerrado de consultas: incorporar nuevas consultas requiere definir una nueva intención en el esquema y su correspondiente método en `QueryBuilder`.
