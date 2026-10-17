# ADR 0005: Descomposición modular del frontend en ES modules

- **Estado:** Aceptado
- **Fecha:** 2026-09-22
- **Decisores:** Equipo de arquitectura web Ganaderos Campo

## Contexto y planteamiento del problema

El frontend del cliente residía originariamente en un archivo monolítico de más de 2.200 líneas (`pwa/js/app.js`), que concentraba:
- Manipulación directa del DOM.
- Adaptadores para WebAssembly e IndexedDB.
- Control del sintetizador de voz y Web Speech API.
- Reglas de negocio sobre cálculo de edades, periodos de supresión de medicamentos y trazabilidad.
- Plantillas HTML de 5 vistas diferentes mediante interpolación de cadenas.

Este acoplamiento impedía ejecutar pruebas unitarias en entornos de integración continua basados en Node.js, dificultaba el control contra inyecciones XSS y aumentaba el riesgo de colisiones en el objeto global `window`.

## Alternativas consideradas

1. Migración a un framework SPA (React, Vue o Svelte): Descartada. Introduce herramientas de compilación obligatorias (Vite o Webpack) y dependencias externas que complican el despliegue directo en placas monoplaca sin fase de empaquetado.
2. Modularización mediante módulos nativos de ECMAScript (Vanilla JS): Seleccionada. El estándar ES Modules (`import`/`export`) cuenta con soporte nativo en navegadores modernos y en Node.js sin necesidad de herramientas de empaquetado ni transpilación.

## Decisión

Dividir el código del cliente en módulos específicos bajo el directorio `pwa/js/modules/`:
1. `config.js`: estado global reactivo (`AppState`), funciones de escape para mitigar XSS (`escapeHtml`), funciones de formato y control del historial de navegación.
2. `db.js`: capa de acceso a datos con consultas SQL parametrizadas mediante marcadores `?`.
3. `auth.js`: gestión de tokens Bearer y control de la vista de autenticación.
4. `voice.js`: clase `VoiceManager` con soporte para Web Speech API y grabación con `MediaRecorder` hacia Groq Whisper.
5. `heuristics.js`: retirado conforme a ADR 0008 para utilizar degradación controlada en `views/assistant_view.js`.
6. Módulos de vista:
   - `views/cattle_view.js`: listado de animales, teclado numérico de crotal y vista dividida.
   - `views/detail_view.js`: ficha individual, ascendencia materna, descendientes y lote.
   - `views/sanitary_view.js`: recetas oficiales y tiempos de espera de medicamentos.
   - `views/feeds_view.js`: registro de piensos, albaranes y costes.
   - `views/movements_view.js`: libro oficial de movimientos y trazabilidad.
   - `views/assistant_view.js`: interfaz del asistente y renderizado de resultados.
7. `app.js`: coordinador de 110 líneas para navegación entre pestañas e inicialización del Service Worker.

## Consecuencias

### Positivas
- Ausencia de empaquetadores: el navegador consume los archivos directamente mediante etiquetas `<script type="module">`.
- Pruebas unitarias en integración continua: los módulos de formateo, navegación y sanitización se validan en CI mediante `node tests/frontend/test_modules.mjs` sin requerir un navegador completo.
- Separación de responsabilidades: cada vista y adaptador de infraestructura se mantiene en un archivo independiente.

### Negativas y limitaciones
- Requisito de navegadores compatibles con ES modules: los clientes deben utilizar navegadores con soporte de importación modular nativa (disponible en versiones lanzadas a partir de 2018).
