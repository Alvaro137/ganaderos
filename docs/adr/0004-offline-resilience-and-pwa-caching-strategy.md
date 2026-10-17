# ADR 0004: Estrategia de resiliencia sin conexión y caché del service worker

- **Estado:** Aceptado
- **Fecha:** 2026-09-22
- **Decisores:** Equipo de arquitectura frontend Ganaderos Campo

## Contexto y planteamiento del problema

En entornos ganaderos sin cobertura móvil, la aplicación debe cargar en menos de un segundo, acceder a los datos locales y evitar pantallas en blanco o errores de red en la carga de recursos estáticos.

## Alternativas consideradas

1. Estrategia con prioridad a la red (network first) con recuperación desde caché: Descartada. Obliga al navegador a esperar los tiempos de expiración de la red (entre 10 y 30 segundos) antes de consultar la caché local, lo que degrada la respuesta de la interfaz.
2. Solo caché (cache only) sin recarga de versiones: Descartada. Impide que los clientes reciban actualizaciones y correcciones de código cuando hay conexión disponible.
3. Prioridad a la caché (cache first) para recursos estáticos, envío directo a red para la API y precarga modular: Seleccionada. Garantiza disponibilidad inmediata de los archivos del cliente y mantiene dinámicas las llamadas al servidor.

## Decisión

1. Estrategia de prioridad a la caché para recursos estáticos:
   - Los documentos HTML, hojas de estilo CSS, fuentes tipográficas, binarios WebAssembly (`sql-wasm.wasm`, `sql-wasm.js`) y módulos JavaScript (`pwa/js/modules/*.js`) se precargan durante el evento `install` del Service Worker.
   - En peticiones sucesivas, estos archivos se entregan desde la caché local sin realizar peticiones de red.
2. Desvío directo para llamadas a la API:
   - Cualquier petición HTTP con método POST o cuya ruta contenga `/api/` se envía directamente a la red. Si la conexión falla, se activa la respuesta de degradación local.
3. Versionado explícito del almacenamiento en caché:
   - La constante `CACHE_NAME` (por ejemplo, `ganaderos-campo-v13`) se actualiza con cada versión del software. El evento `activate` del Service Worker elimina automáticamente las cachés de versiones previas.

## Consecuencias

### Positivas
- Tiempo de carga reducido: la interfaz carga en menos de 300 ms incluso con el dispositivo en modo avión.
- Continuidad operativa sin señal: los operarios pueden desplazarse entre zonas con y sin cobertura sin que la interfaz se reinicie ni pierda el estado en memoria.

### Negativas y limitaciones
- Gestión de invalidación de caché: cualquier modificación en archivos JavaScript o CSS requiere incrementar la constante `CACHE_NAME` del Service Worker para forzar la actualización en los clientes instalados.
