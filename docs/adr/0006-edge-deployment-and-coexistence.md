# ADR 0006: Despliegue en Edge (Orange Pi Zero 3) y Convivencia Pacífica de Servicios

* **Estado:** Aceptado
* **Fecha:** 2026-09-22
* **Decisores:** Equipo de Infraestructura y Operaciones Ganaderos Campo

## Contexto y Planteamiento del Problema
En la explotación ganadera (Espadaña / Dueña), la infraestructura de cómputo local consiste en un mini-servidor Single Board Computer (SBC) de bajo consumo: una **Orange Pi Zero 3** con procesador Allwinner H618 (4 núcleos ARM Cortex-A53 a 1.5 GHz, arquitectura `aarch64`) y 1 GB de RAM LPDDR4, ejecutando Linux Debian/Ubuntu.

En este mismo equipo ya se encuentra en producción activa un servicio meteorológico de campo (`meteo.service`), que recibe datos telemétricos de la estación Sainlogic en el puerto `8000` y está expuesto a internet mediante **Caddy v2** (puertos 80 y 443 con HTTPS automático hacia `varo137.ddns.net`).

El despliegue de **Ganaderos Campo** debía satisfacer tres requisitos no negociables:
1. **Convivencia Cero-Interferencia:** No modificar, degradar ni interrumpir el servicio meteorológico existente en el puerto `8000` ni sus rutas en la raíz `/`.
2. **Consumo Acotado de Recursos:** La placa dispone de solo 1 GB de RAM compartida. Ganaderos Campo debe operar con un límite estricto de memoria (< 256 MB RAM) y sin saturar la CPU.
3. **Tolerancia a Cortes Eléctricos en Finca:** Las tormentas y cortes de suministro en dehesas rurales son habituales; el sistema debe auto-recuperarse inmediatamente al restablecerse la corriente sin intervención humana.

## Alternativas Consideradas
1. **Despliegue en VPS en Nube (AWS/Hetzner):** Descartado. Viola la premisa de soberanía de datos y disponibilidad en red local (LAN) cuando se corta la conexión satelital o 4G de la finca.
2. **Sustitución o Fusión de la aplicación meteorológica:** Descartado. La estación meteorológica y la gestión ganadera tienen ciclos de vida, librerías y objetivos diferentes; fusionarlos generaría acoplamiento innecesario.
3. **Microservicio Aislado en Puerto Local 8010 con Subpath en Caddy:** Seleccionado.

## Decisión
1. **Asignación de Puertos y Enrutamiento:**
   - Ganaderos Campo escucha en `127.0.0.1:8010` (loopback local únicamente, invisible desde el exterior sin pasar por el reverse proxy).
   - En el `Caddyfile` principal, se añade una directiva `handle /campo*` que realiza `uri strip_prefix /campo` y reenvía el tráfico mediante `reverse_proxy 127.0.0.1:8010`.
   - La estación meteorológica mantiene el 100% de sus rutas intactas en `/`, `/api/` y `/static/`.
2. **Aislamiento y Recuperación del Proceso:**
   - Implementar unidad `systemd` (`ganaderos.service`) con directiva `Restart=always`, `RestartSec=5s`, límites de memoria `MemoryMax=350M` y usuario no privilegiado `varo`.
   - Como alternativa contenerizada, proporcionar `compose.prod.yaml` con límites Docker `mem_limit: 256M`.
3. **Resiliencia de Datos y Backups:**
   - Proporcionar el script `scripts/backup_db.py` que utiliza la API de backup online no bloqueante de SQLite (`sqlite3.Connection.backup`), generando archivos comprimidos con gzip y política de retención automática de 7 copias.

## Consecuencias

### Positivas
- **Convivencia Total:** Ambos sistemas operan independientemente sin colisiones de puertos ni dependencias de Python.
- **Rendimiento Óptimo:** La entrega de la base de datos de 2 MB y módulos ES se acelera mediante la compresión Zstandard/Gzip nativa de Caddy.
- **Auto-recuperación Instantánea:** Si la placa se apaga por corte eléctrico, `systemd` levanta el servicio en < 3 segundos al volver la energía.

### Negativas / Desafíos
- **Subpath en PWA:** El frontend debe utilizar rutas relativas (`<base href="./">` y `fetch("./api/...")`) para operar indistintamente tanto en la raíz como bajo el prefijo `/campo/`.
