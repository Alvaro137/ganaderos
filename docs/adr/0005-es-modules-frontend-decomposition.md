# ADR 0005: Descomposición Modular del Frontend en ES Modules

* **Estado:** Aceptado
* **Fecha:** 2026-09-22
* **Decisores:** Equipo de Arquitectura Web Ganaderos Campo

## Contexto y Planteamiento del Problema
El frontend del cliente residía originariamente en un archivo monolítico de más de 2.200 líneas (`pwa/js/app.js`), donde convergían:
- Manipulación directa del DOM.
- Adaptadores de WebAssembly e IndexedDB.
- Control del sintetizador de voz y Web Speech API.
- Lógica de negocio (edades, tiempos de retiro sanitario, trazabilidad).
- Plantillas HTML de 5 vistas diferentes con interpolación de strings.

Este acoplamiento impedía la testabilidad unitaria en entornos sin navegador (CI), propiciaba inyecciones HTML (XSS) y aumentaba drásticamente el riesgo de errores de sintaxis o colisiones en el objeto global `window`.

## Alternativas Consideradas
1. **Migración a un framework SPA (React / Vue / Svelte):** Descartada en esta etapa. Añade cadenas de compilación pesadas (Vite/Webpack, Node_modules gigantes) y dependencias que complican el despliegue directo en edge o el servido sin build tools.
2. **Modularización en ES Modules Nativos (Vanilla JS):** Seleccionada. El estándar ECMAScript Modules (`import`/`export`) es soportado de forma nativa por todos los navegadores modernos y por Node.js sin necesidad de empaquetadores ni transpilación.

## Decisión
Dividir el cliente en módulos especializados bajo `pwa/js/modules/`:
1. **`config.js`:** Estado reactivo central (`AppState`), utilidades de sanitización anti-XSS (`escapeHtml`), formateadores y pila de navegación histórica.
2. **`db.js`:** Capa de acceso a datos que expone métodos tipados y consultas preparadas con `?`.
3. **`auth.js`:** Gestión de tokens Bearer y pantalla de autenticación.
4. **`voice.js`:** `VoiceManager` con soporte dual para Web Speech API y fallback con `MediaRecorder` + Groq Whisper.
5. **`heuristics.js`:** Suprimido en ADR 0008 (YAGNI & KISS) en favor de Degradación Grácil en `views/assistant_view.js` y asistente conectado Cloud/Edge.
6. **Vistas Especializadas:**
   - `views/cattle_view.js`: Listado de animales, teclado numérico táctil de campo y split-view.
   - `views/detail_view.js`: Ficha individual, madre, árbol de partos y lote.
   - `views/sanitary_view.js`: Recetas oficiales y tiempos de retirada en carne.
   - `views/feeds_view.js`: Compras de piensos, albaranes y costes.
   - `views/movements_view.js`: Trazabilidad y Libro Oficial de Movimientos.
   - `views/assistant_view.js`: Asistente conversacional con selector de modelos y renderizado estructurado.
7. **`app.js`:** Coordinador mínimo de 110 líneas para enrutamiento de pestañas y registro del Service Worker.

## Consecuencias

### Positivas
- **Cero Empaquetadores:** No requiere Webpack, Vite ni Rollup; el código se sirve directamente al navegador con `<script type="module">`.
- **Testabilidad en CI con Node.js:** Lógica pura como heurísticas, formateo, navegación y sanitización se ejecuta en segundos en CI con `node tests/frontend/test_modules.mjs`.
- **Mantenibilidad y Colaboración:** Cada vista y adaptador tecnológico reside en su propio archivo con responsabilidades claramente delimitadas.

### Negativas / Desafíos
- **Compatibilidad con Navegadores Antiguos:** Requiere navegadores con soporte de ES Modules (cualquier navegador lanzado a partir de 2018).
