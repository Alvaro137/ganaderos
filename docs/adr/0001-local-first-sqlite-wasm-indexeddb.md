# ADR 0001: Motor Relacional Local-First mediante SQLite WebAssembly e IndexedDB

* **Estado:** Aceptado
* **Fecha:** 2026-09-20
* **Decisores:** Equipo de Arquitectura de Software Ganaderos Campo

## Contexto y Planteamiento del Problema
Las explotaciones de vacuno de carne en régimen extensivo en España (dehesas de Salamanca, Extremadura, Andalucía) operan frecuentemente en zonas con cobertura móvil nula o intermitente ("zonas de sombra"). El ganadero sobre el terreno necesita:
1. Buscar animales instantáneamente por los últimos 4 dígitos del crotal oficial (de 14 dígitos).
2. Consultar relaciones complejas: árbol genealógico (madre -> hijos), historial reproductivo (partos por año), corrales/lotes y periodos de supresión de medicamentos veterinarios.
3. Garantizar latencia cero e invulnerabilidad a caídas de red o cortes de servidor.

Las arquitecturas cliente-servidor tradicionales fallan en este escenario porque una consulta HTTP sin señal bloquea o degrada la experiencia del usuario.

## Alternativas Consideradas
1. **API REST Online con caché HTTP estándar:** Descartada. No permite realizar búsquedas relacionales arbitrarias ni consultas complejas cuando la conexión falla.
2. **IndexedDB Nativo o Dexie.js:** Descartada para consultas complejas. IndexedDB es un almacén clave-valor documental sin optimizador de consultas SQL relacionales, lo que obliga a implementar joins, agregaciones y filtros en JavaScript imperativo en memoria.
3. **SQLite WebAssembly (sql.js) persistido en IndexedDB (Local-First):** Seleccionada. El servidor compila y entrega un snapshot relacional de SQLite (`ganaderos_campo.sqlite`). El cliente móvil carga el binario en WebAssembly y lo persiste en IndexedDB (`censo_storage`).

## Decisión
Adoptar la arquitectura **Local-First con SQLite compilado a WebAssembly (sql.js)**:
- El navegador descarga una copia optimizada de la base de datos relacional durante la sincronización inicial o periódica.
- El archivo binario se almacena en el `IndexedDB` del dispositivo.
- Cada búsqueda o filtro se ejecuta localmente mediante sentencias SQL estándar con parámetros ligados (`?`), utilizando el motor de SQLite a velocidad nativa en WebAssembly.

## Consecuencias

### Positivas
- **100% Autónomo en Campo:** La aplicación puede operar indefinidamente sin señal 4G/5G.
- **Rendimiento Inmediato:** Las consultas relacionales complejas (joins entre animales, partos y recetas) se resuelven en < 5 milisegundos directamente en la CPU del dispositivo.
- **Privacidad Estricta:** Los datos de manejo y trazabilidad del ganadero no necesitan transmitirse por la red para cada interacción de búsqueda.

### Negativas / Desafíos
- **Tamaño de Descarga Inicial:** El cliente debe descargar el binario SQLite (generalmente entre 1 MB y 4 MB para explotaciones de 500 a 5.000 animales). Se mitiga mediante compresión gzip/brotli y barra de progreso interactiva.
- **Persistencia en Memoria:** Las consultas se ejecutan sobre la instancia en memoria de SQL.js; cualquier mutación local requiere volcar el buffer binario nuevamente a IndexedDB.
