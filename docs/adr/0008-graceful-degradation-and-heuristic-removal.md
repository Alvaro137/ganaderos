# ADR 0008: Supresión de Heurística Offline en favor de Asistente Híbrido Conectado y Degradación Grácil (YAGNI & KISS)

* **Estado:** Aceptado
* **Fecha:** 2026-09-22
* **Decisores:** Equipo de Arquitectura de Software y AI Engineering Ganaderos Campo
* **Enmienda a:** [ADR 0002 (Intent Calling Tipado vs. Text-to-SQL No Restringido)](./0002-typed-intent-calling-vs-raw-text-to-sql.md)

---

## Contexto y Planteamiento del Problema

En las iteraciones iniciales del sistema se introdujo un motor de "heurística offline" (`pwa/js/modules/heuristics.js` y `clasificar_intencion_heuristica` en `src/infrastructure/llm_gateway.py`) con el objetivo de clasificar intenciones en el cliente mediante expresiones regulares cuando no hubiera conectividad a internet.

Tras la maduración de la arquitectura de campo y el análisis riguroso de la experiencia operativa real, se identificaron fallas conceptuales críticas en este enfoque ("regex-driven AI"):
1. **Fragilidad ante Variaciones Dialectales:** Las expresiones regulares son rígidas y no escalan para procesar lenguaje natural en campo (ej. *"enséñame las vacas que parieron en mayo"* vs. *"partos de mayo"*). La heurística genera falsos positivos o clasificaciones erróneas que frustran al usuario.
2. **Violación Sistemática del Principio DRY:** Mantener un catálogo paralelo de 9 intenciones y expresiones regulares sincronizadas entre JavaScript en el cliente y Python en el servidor multiplicaba la deuda técnica y el coste de mantenimiento con cada nueva consulta o entidad.
3. **Incongruencia entre Voz y Red:** La transcripción de notas de voz en campo (Groq Whisper) ya requería conectividad de red con el servidor de explotación o la nube. Pretender que el asistente inteligente funcionara sin conexión únicamente para texto escrito por un ganadero con guantes a plena luz solar en una dehesa resolvía un caso de uso artificial.
4. **Claridad Arquitectónica:** El valor nuclear Offline-First del sistema reside en su base de datos relacional local en SQLite WebAssembly, que resuelve las búsquedas deterministas de censo, fichas de animales y genealogía en milisegundos sin necesidad de IA.

---

## Alternativas Consideradas

1. **Mantener y Expandir la Heurística de Expresiones Regulares:**
   - *Descartado:* Mayor acoplamiento, mantenimiento artesanal de regex infinitas y riesgo constante de desincronización entre frontend y backend.
2. **Embeber un Modelo de Lenguaje Local en el Navegador (WASM / ONNX / WebLLM):**
   - *Descartado:* Descargar modelos cuantizados de 1.5B a 3B parámetros (1.5 GB – 3 GB de memoria en el navegador móvil) en dispositivos de campo con memoria limitada y conexiones 3G/4G rurales es inviable y degradaría la batería de forma crítica.
3. **Asistente Híbrido Conectado (Cloud/Edge) con Degradación Grácil (Graceful Degradation):**
   - *Seleccionado:* Asignación honesta de responsabilidades:
     - **Offline (Cliente):** Datos relacionales puros, rápidos y deterministas en el dispositivo (SQLite WASM). El 100% de la operativa crítica de censo, ficha por 4 dígitos, corrales y alertas de supresión sanitaria funciona en modo avión.
     - **Online (Servidor / Edge):** Asistencia conversacional inteligente con LLM real (Llama 3.3 70B vía Groq) y transcripción de voz con Whisper.
     - **Degradación Grácil:** Si no hay cobertura, la interfaz del asistente informa con total transparencia del estado sin conexión y proporciona botones de acción directa hacia la búsqueda táctil por crotal o el censo de corrales, sin intentar adivinaciones heurísticas rotas.

---

## Decisión

1. **Supresión Limpia de Código (YAGNI & KISS):**
   - Eliminar `pwa/js/modules/heuristics.js` y retirar su precarga del Service Worker (`pwa/sw.js`, versión `ganaderos-campo-v13`).
   - Eliminar `clasificar_intencion_heuristica` del backend (`src/infrastructure/llm_gateway.py`).
2. **Degradación Grácil Reactiva en Frontend:**
   - `assistant_view.js` monitoriza `navigator.onLine` y escucha eventos `'online'` / `'offline'`.
   - Cuando no hay conexión, se muestra un banner explicativo amigable: *"El asistente por voz e IA requiere conexión con el servidor. La gestión de censo, fichas de animales y corrales sigue disponible 100% offline"*, junto con accesos rápidos al teclado numérico de crotal y a la vista de corrales.
   - El botón del micrófono se deshabilita visualmente en ausencia de red.
   - Si se produce una desconexión o timeout contra `/api/ai/intent`, el error de red se captura limpiamente presentando el mismo banner de degradación grácil.
3. **Backend Honesto y Tipado:**
   - `/api/ai/intent` devuelve HTTP 503 (`Service Unavailable`) con un mensaje estructurado si el servicio LLM no está accesible o no cuenta con credenciales activas.
   - `/api/ai/models` elimina la opción artificial `"offline"` de su catálogo, reflejando exclusivamente los modelos LLM y de transcripción disponibles.

---

## Consecuencias

### Positivas
- **Cero Duplicación de Lógica (DRY):** Se erradican más de 300 líneas de expresiones regulares y sincronización artificial.
- **Arquitectura Honesta y Robusta:** No hay pretensiones cosméticas de "IA offline" con regex. El sistema delega en un LLM de 70B parámetros cuando hay conexión y en un motor SQL relacional determinista cuando no la hay.
- **Reducción de Superficie de Fallos:** Eliminación de falsos positivos en consultas de campo mal parseadas por regex.
- **Excelente Experiencia de Usuario en Campo:** El usuario sabe exactamente qué funciones requieren red y cuáles son 100% offline, con redirección fluida a la búsqueda manual.

### Negativas / Desafíos
- El asistente por voz y en lenguaje natural no puede utilizarse en zonas de sombra total de cobertura sin un servidor Edge local (ej. Orange Pi en la manga o furgoneta). En esas situaciones, el ganadero utiliza el teclado numérico de 4 dígitos o los filtros táctiles por corral, que operan instantáneamente.
