# ADR 0008: Supresión de heurística sin conexión en favor de asistente conectado y degradación controlada

- **Estado:** Aceptado
- **Fecha:** 2026-09-22
- **Decisores:** Equipo de arquitectura de software y desarrollo de Ganaderos Campo
- **Enmienda a:** [ADR 0002 (Invocación tipada de intenciones frente a text-to-sql libre)](./0002-typed-intent-calling-vs-raw-text-to-sql.md)

## Contexto y planteamiento del problema

En iteraciones previas se incluyó un módulo de heurística local (`pwa/js/modules/heuristics.js` y `clasificar_intencion_heuristica` en `src/infrastructure/llm_gateway.py`) para clasificar intenciones mediante expresiones regulares cuando no hubiera conexión a internet.

El uso en campo reveló cuatro problemas técnicos en este enfoque:
1. Rigidez ante variaciones del lenguaje: las expresiones regulares no admiten variaciones léxicas habituales en el habla rural (por ejemplo, "enséñame las vacas que parieron en mayo" frente a "partos de mayo"). La heurística arrojaba falsos positivos o clasificaciones erróneas.
2. Duplicación de lógica entre cliente y servidor: mantener sincronizado un catálogo de 9 intenciones y expresiones regulares en JavaScript y en Python aumentaba la deuda técnica en cada cambio de esquema o entidad.
3. Dependencia de red para la entrada por voz: la transcripción mediante Groq Whisper requiere conectividad con el servidor o la nube. Mantener el asistente sin conexión únicamente para texto manual resolvía un caso de uso infrecuente en campo.
4. Separación de responsabilidades: las operaciones críticas de censo, fichas individuales y genealogía ya se resuelven en milisegundos de forma determinista mediante el motor SQLite WebAssembly local, sin requerir procesamiento de lenguaje natural.

## Alternativas consideradas

1. Ampliar el catálogo de expresiones regulares: Descartada. Aumenta la complejidad del código, el acoplamiento y el riesgo de divergencia entre frontend y backend.
2. Ejecutar un modelo de lenguaje local en el navegador mediante WebAssembly o WebLLM: Descartada. Descargar modelos cuantizados de 1,5B a 3B parámetros (entre 1,5 GB y 3 GB de memoria en el navegador móvil) en dispositivos rurales con hardware modesto agota la memoria y la batería.
3. Asistente conectado con degradación controlada: Seleccionada. Delimita las capacidades según conectividad:
   - Operaciones locales en el cliente: consultas relacionales sobre SQLite WebAssembly. Las búsquedas por crotal de 4 dígitos, censos por lote y fichas sanitarias operan en modo local sin depender de la red.
   - Operaciones conectadas en servidor: interpretación en lenguaje natural con modelos LLM (Llama 3.3 vía Groq) y transcripción de audio con Whisper.
   - Degradación controlada: ante la ausencia de conexión, la interfaz notifica el estado y ofrece accesos directos al buscador por crotal y al censo por lote.

## Decisión

1. Eliminación de código heurístico redundante:
   - Eliminar `pwa/js/modules/heuristics.js` y su referencia en la precarga del Service Worker (`pwa/sw.js`, versión `ganaderos-campo-v13`).
   - Retirar la función `clasificar_intencion_heuristica` del backend (`src/infrastructure/llm_gateway.py`).
2. Degradación controlada en el cliente web:
   - El módulo `views/assistant_view.js` monitoriza el estado de red mediante `navigator.onLine` y los eventos `online` y `offline`.
   - Cuando no hay conexión, muestra un aviso informativo: "El asistente por voz e IA requiere conexión con el servidor. La gestión de censo, fichas de animales y corrales sigue disponible sin conexión", junto con accesos directos al teclado numérico de crotal y a la lista de lotes.
   - El botón de grabación por micrófono se deshabilita cuando el cliente detecta ausencia de conexión.
   - Si una llamada a `/api/ai/intent` termina por tiempo de espera o fallo de red, el error se captura y se muestra el mismo mensaje de degradación.
3. Respuestas tipadas en el backend:
   - El punto de enlace `/api/ai/intent` devuelve el código HTTP 503 (`Service Unavailable`) con un mensaje estructurado si el servicio de lenguaje no está disponible o carece de credenciales configuradas.
   - El punto de enlace `/api/ai/models` elimina la opción `"offline"` de su catálogo y lista únicamente los modelos remotos disponibles.

## Consecuencias

### Positivas
- Reducción de código duplicado: se eliminan más de 300 líneas de patrones de expresiones regulares y sincronizaciones entre lenguajes.
- Claridad técnica: las operaciones no conectadas se resuelven exclusivamente mediante el motor SQL relacional y las consultas conversacionales se delegan en el modelo de lenguaje cuando existe red.
- Reducción de fallos: se eliminan las clasificaciones incorrectas producidas por coincidencias parciales de expresiones regulares.
- Orientación clara al usuario: la interfaz comunica de forma explícita qué funciones requieren conectividad y ofrece acceso directo a los métodos de búsqueda locales.

### Negativas y limitaciones
- El asistente por voz y en lenguaje natural no opera en zonas sin señal de red o sin un servidor local en la explotación. En esas situaciones, los operarios deben utilizar la búsqueda numérica por los 4 dígitos del crotal o los filtros por lote.
