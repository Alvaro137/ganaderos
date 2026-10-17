# ADR 0006: Despliegue en el extremo (Orange Pi Zero 3) y coexistencia de servicios

- **Estado:** Aceptado
- **Fecha:** 2026-09-22
- **Decisores:** Equipo de infraestructura y operaciones Ganaderos Campo

## Contexto y planteamiento del problema

En las instalaciones de la explotación ganadera, el servidor local es una placa monoplaca Orange Pi Zero 3 con procesador Allwinner H618 (4 núcleos ARM Cortex-A53 a 1.5 GHz, arquitectura aarch64) y 1 GB de memoria RAM LPDDR4, ejecutando Linux Debian/Ubuntu.

Este equipo ya ejecuta en producción el servicio meteorológico `meteo.service`, que recibe telemetría de la estación meteorológica en el puerto 8000 y se expone a internet mediante Caddy v2 (puertos 80 y 443 con HTTPS en `varo137.ddns.net`).

El despliegue de la aplicación de gestión ganadera debía cumplir tres condiciones:
1. Aislamiento respecto al servicio meteorológico: no modificar ni interrumpir el servicio en el puerto 8000 ni sus rutas en la raíz `/`.
2. Consumo controlado de memoria: la placa comparte 1 GB de RAM total. La aplicación ganadera debe operar con un límite inferior a 256 MB de RAM sin saturar la CPU.
3. Recuperación ante cortes eléctricos: el sistema debe reiniciar los servicios automáticamente al restablecerse el suministro eléctrico.

## Alternativas consideradas

1. Despliegue en servidor virtual en nube (AWS o Hetzner): Descartada. Impide el acceso en red de área local (LAN) si se interrumpe la conexión 4G o satelital en la finca.
2. Integración en el código del servicio meteorológico: Descartada. Ambas aplicaciones tienen ciclos de despliegue, dependencias y dominios funcionales distintos.
3. Servicio independiente en puerto local 8010 con subruta en Caddy: Seleccionada. Permite aislar los procesos y compartir el proxy inverso existente.

## Decisión

1. Asignación de puertos y enrutamiento:
   - La aplicación ganadera escucha en `127.0.0.1:8010` (interfaz loopback, accesible únicamente a través del proxy inverso).
   - En el archivo de configuración `Caddyfile`, se añade un bloque `handle /campo*` que aplica `uri strip_prefix /campo` y delega mediante `reverse_proxy 127.0.0.1:8010`.
   - El servicio meteorológico conserva sus rutas en `/`, `/api/` y `/static/`.
2. Aislamiento y control de procesos:
   - Configurar una unidad de systemd (`ganaderos.service`) con `Restart=always`, `RestartSec=5s`, límite de memoria `MemoryMax=350M` y ejecución bajo el usuario no privilegiado `varo`.
   - Proporcionar como alternativa el archivo `compose.prod.yaml` con restricción de memoria `mem_limit: 256M`.
3. Copias de seguridad de datos:
   - Programar el script `scripts/backup_db.py`, que utiliza la API de copia en caliente de SQLite (`sqlite3.Connection.backup`) para generar archivos comprimidos en gzip con retención de 7 copias.

## Consecuencias

### Positivas
- Operación independiente: ambos servicios conviven sin conflictos de puertos ni colisiones entre entornos de Python.
- Compresión eficiente de transferencias: la entrega de la base de datos de 2 MB y los módulos de JavaScript aprovecha la compresión nativa de Caddy (zstd y gzip).
- Reinicio automático: ante un corte eléctrico, systemd inicia el servicio en menos de 3 segundos tras el arranque del sistema operativo.

### Negativas y limitaciones
- Subruta en la aplicación web: el frontend requiere rutas relativas (`<base href="./">` y `fetch("./api/...")`) para operar tanto en la raíz como bajo el prefijo `/campo/`.
