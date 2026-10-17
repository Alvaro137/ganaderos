# ADR 0001: Motor relacional local-first mediante SQLite WebAssembly e IndexedDB

- **Estado:** Aceptado
- **Fecha:** 2026-09-20
- **Decisores:** Equipo de arquitectura de software Ganaderos Campo

## Contexto y planteamiento del problema

Las explotaciones de vacuno de carne en régimen extensivo operan con frecuencia en zonas rurales con cobertura móvil nula o intermitente. El ganadero en campo requiere:
1. Buscar animales por los últimos 4 dígitos del crotal oficial de 14 dígitos.
2. Consultar relaciones entre entidades: genealogía (madre y descendencia), historial de partos, lotes y periodos de supresión de medicamentos veterinarios.
3. Ejecutar consultas sin depender de la conectividad de red ni de la disponibilidad de un servidor remoto.

Las arquitecturas cliente-servidor convencionales no resuelven este escenario porque una petición HTTP bloquea o interrumpe la interfaz ante la falta de señal.

## Alternativas consideradas

1. API REST con caché HTTP estándar: Descartada. No permite ejecutar búsquedas relacionales arbitrarias ni consultas estructuradas cuando falla la conexión.
2. IndexedDB nativo o Dexie.js: Descartada. IndexedDB es un almacén documental de clave-valor sin motor de optimización SQL. Requiere implementar combinaciones (joins), agrupaciones y filtros mediante código imperativo en JavaScript.
3. SQLite WebAssembly (sql.js) persistido en IndexedDB: Seleccionada. El servidor entrega una instantánea relacional de SQLite (`ganaderos_campo.sqlite`). El cliente web carga el binario en WebAssembly y lo almacena localmente en IndexedDB (`censo_storage`).

## Decisión

Adoptar una arquitectura local-first basada en SQLite compilado a WebAssembly (sql.js):
- El navegador descarga una copia de la base de datos relacional durante la sincronización inicial o periódica.
- El archivo binario se almacena en el IndexedDB del dispositivo.
- Cada búsqueda o filtro se ejecuta localmente mediante sentencias SQL parametrizadas con marcadores de posición (`?`), utilizando el motor SQLite en WebAssembly.

## Consecuencias

### Positivas
- Operación sin conexión: la aplicación funciona de forma continua sin cobertura 4G o 5G.
- Latencia baja: las consultas relacionales entre animales, partos y recetas se ejecutan en menos de 5 milisegundos en la CPU local.
- Privacidad de datos: los registros de manejo y trazabilidad no requieren transmisión por red en cada consulta.

### Negativas y limitaciones
- Tamaño de descarga inicial: el cliente debe transferir el binario SQLite (entre 1 MB y 4 MB para censos de 500 a 5.000 animales). Se mitiga mediante compresión gzip o brotli y un indicador visual de progreso.
- Persistencia en memoria: las consultas operan sobre la instancia en memoria de sql.js. Cada mutación local exige escribir el búfer binario en IndexedDB.
