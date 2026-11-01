# Guía Operativa: Despliegue en Edge (Orange Pi Zero 3 / Linux aarch64)

Esta guía detalla el procedimiento de despliegue y mantenimiento de **Ganaderos Campo** en la placa SBC **Orange Pi Zero 3** ubicada en la explotación ganadera, conviviendo pacíficamente con la estación meteorológica (`meteo.service` en puerto 8000) y Boxeo Enigma (puerto 8020) bajo Cloudflare Zero Trust.

---

## 1. Arquitectura de Convivencia en el Servidor

```text
                        Internet / Cloudflare Edge (*.alvaro137.com)
                                           │
                                           ▼ (Cloudflare Tunnel)
                         ┌─────────────────────────────────┐
                         │      cloudflared daemon         │
                         └────────────────┬────────────────┘
                                           │
                                           ▼
                         ┌─────────────────────────────────┐
                         │   Caddy v2 (Reverse Proxy)      │
                         └────────────────┬────────────────┘
                                           │
       ┌───────────────────────────────────┼───────────────────────────────────┐
       │                                   │                                   │
campo.alvaro137.com                meteo.alvaro137.com                 boxeo.alvaro137.com
       │                                   │                                   │
       ▼                                   ▼                                   ▼
┌──────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
│ ganaderos.service (8010) │   │  meteo.service (8000)    │   │   boxeo.service (8020)   │
│   FastAPI + PWA Campo    │   │  Estación Meteorológica  │   │  Boxeo Enigma / Sniper   │
└──────────────┬───────────┘   └──────────────────────────┘   └──────────────────────────┘
               │
               ▼ (http://127.0.0.1:3001/v1)
┌────────────────────────────────────────────────────────┐
│  FreeLLMAPI Docker (:3001) - Red ai-net               │
│  (Almacenamiento USB en /mnt/usb para evitar desgaste)  │
└────────────────────────────────────────────────────────┘
```

---

## 2. Requisitos Previos en la Placa

- **Hardware:** Orange Pi Zero 3 (Linux aarch64).
- **Almacenamiento USB:** Unidad USB montada en `/mnt/usb` donde reside el `data-root` de Docker (`/mnt/usb/docker`) para proteger la tarjeta micro-SD de escrituras intensivas.
- **Servicios en ejecución:** Caddy v2 (`systemctl status caddy`), Cloudflared (`systemctl status cloudflared`).
- **Python:** Python 3.10 o superior con módulo `venv` (`sudo apt install python3-venv python3-pip`).

---

## 3. Procedimiento de Instalación Paso a Paso

### Paso 1: Clonar o Transferir el Código
En la sesión SSH de la Orange Pi (`ssh opi-lan` o por IP local):

```bash
cd /home/varo
git clone https://github.com/Alvaro137/ganaderos.git ganaderos_pwa
cd ganaderos_pwa
```

### Paso 2: Crear el Entorno Virtual y Dependencias
```bash
python3 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install -e .
```

### Paso 3: Configurar Variables de Entorno (`.env`)
Crear el archivo `/home/varo/ganaderos_pwa/.env`:

```bash
PWA_SECRET_KEY=<tu_token_seguro_hex>
Unified_AK=freellmapi-<tu_clave_unificada>
```

---

## 4. Configuración del Reverse Proxy (Caddy v2)

El archivo `/etc/caddy/Caddyfile` organiza los subdominios dedicados con redirección cruzada de subrutas legadas:

```caddy
http://campo.alvaro137.com {
    encode gzip
    redir /meteo* https://meteo.alvaro137.com{uri} 302
    redir /boxeo* https://boxeo.alvaro137.com{uri} 302

    @noCache {
        path /sw.js /index.html /manifest.json /
    }
    header @noCache Cache-Control "no-cache, no-store, must-revalidate"
    reverse_proxy 127.0.0.1:8010
}

http://meteo.alvaro137.com {
    encode gzip
    redir /campo* https://campo.alvaro137.com{uri} 302
    redir /boxeo* https://boxeo.alvaro137.com{uri} 302
    reverse_proxy 127.0.0.1:8000
}

http://boxeo.alvaro137.com {
    encode gzip
    redir /campo* https://campo.alvaro137.com{uri} 302
    redir /meteo* https://meteo.alvaro137.com{uri} 302
    reverse_proxy 127.0.0.1:8020
}

http://alvaro137.com, http://www.alvaro137.com {
    encode gzip
    redir /meteo* https://meteo.alvaro137.com{uri} 302
    redir /campo* https://campo.alvaro137.com{uri} 302
    redir /boxeo* https://boxeo.alvaro137.com{uri} 302
    redir / https://meteo.alvaro137.com 302
}
```

Recargar la configuración de Caddy sin interrumpir conexiones activas:

```bash
sudo systemctl reload caddy
```

---

## 5. Automatización de Copias de Seguridad (Cron)

Para proteger los datos del censo y los cambios diarios de la explotación, configurar un trabajo cron que ejecute el script de backup todas las noches a las 03:00 AM:

```bash
crontab -e
```

Añadir la siguiente línea:

```cron
0 3 * * * /home/varo/ganaderos_pwa/venv/bin/python /home/varo/ganaderos_pwa/scripts/backup_db.py >> /home/varo/ganaderos_pwa/backups/backup.log 2>&1
```

Este comando:
- Ejecuta una copia online no bloqueante de SQLite.
- La comprime en formato `.sqlite.gz`.
- Mantiene únicamente los 7 respaldos más recientes, purgando los antiguos.

---

## 6. Verificación Automatizada Pre-Vuelo (`scripts/verify_edge.py`)

Para validar que todos los archivos de configuración, límites de memoria y rutas están configurados correctamente sin colisiones antes de desplegar en producción, ejecuta el script de validación determinista:

```bash
python3 scripts/verify_edge.py
```

---

## 7. Verificación Final de la Instalación

1. **Web Meteorológica:** Acceder a `https://meteo.alvaro137.com/` y comprobar que la telemetría del ESP32 sigue operando con normalidad.
2. **Ganaderos Campo PWA:** Acceder a `https://campo.alvaro137.com/` y verificar:
   - Se muestra la pantalla de acceso con selección de operario / contraseña.
   - Se descarga la base de datos y se inicializa el motor SQLite WebAssembly offline.
   - El botón directo a "Meteo" en la cabecera redirige fluidamente a `https://meteo.alvaro137.com/`.
   - Poner el teléfono en modo avión y comprobar que la aplicación sigue funcionando offline.
