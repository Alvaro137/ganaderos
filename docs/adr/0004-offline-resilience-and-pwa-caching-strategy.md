# ADR 0004: Estrategia de Resiliencia Offline y Caché del Service Worker

* **Estado:** Aceptado
* **Fecha:** 2026-09-22
* **Decisores:** Equipo de Arquitectura Frontend Ganaderos Campo

## Contexto y Planteamiento del Problema
Una aplicación para el campo agropecuario debe comportarse como software de misión crítica: si el ganadero abre el teléfono en medio del pasto sin conexión, la interfaz debe cargar en < 1 segundo, acceder a los datos locales y no mostrar ninguna pantalla en blanco ni errores de carga de recursos.

## Alternativas Consideradas
1. **Network First con fallback a caché:** Inadecuado para campo. Provoca que el navegador espere tiempos de timeout de red (10 a 30 segundos) antes de recurrir a la caché, causando frustración y sensación de bloqueo.
2. **Cache Only sin actualización en caliente:** Riesgoso porque los usuarios pueden quedar atrapados en versiones antiguas del software sin posibilidad de recibir parches.
3. **Cache First para Assets Estáticos + Bypass Dinámico para APIs + Precaching Modular:** Seleccionado.

## Decisión
1. **Estrategia Cache First para Recursos de la Aplicación:**
   - HTML, CSS, fuentes, binarios WebAssembly (`sql-wasm.wasm`, `sql-wasm.js`) y módulos JavaScript (`pwa/js/modules/*.js`) se precachean durante el evento `install` del Service Worker.
   - En peticiones posteriores, los archivos se entregan instantáneamente desde la caché local sin tocar la red.
2. **Bypass para la API:**
   - Cualquier petición `POST` o ruta que contenga `/api/` se envía directamente a la red (o activa el fallback local si la red falla).
3. **Versionado Explícito:**
   - La constante `CACHE_NAME` (ej: `ganaderos-campo-v12`) se incrementa con cada release, purgando automáticamente caches obsoletas en el evento `activate`.

## Consecuencias

### Positivas
- **Arranque Instantáneo:** Carga de la aplicación en menos de 300 ms incluso con el dispositivo en modo avión.
- **Tolerancia Total a Zonas de Sombra:** El ganadero puede desplazarse entre zonas con cobertura y zonas sin señal sin que la interfaz sufra reinicios ni pérdidas de estado.

### Negativas / Desafíos
- **Control de Invalidez de Caché:** Cualquier cambio en los scripts o módulos debe ir acompañado de un incremento en la versión de caché del Service Worker para forzar la actualización en los clientes instalados.
