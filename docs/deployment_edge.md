# Guía Operativa: Despliegue en Edge (Orange Pi Zero 3 / Linux aarch64)

Esta guía detalla el procedimiento de despliegue y mantenimiento de **Ganaderos Campo** en la placa SBC **Orange Pi Zero 3** ubicada en la explotación ganadera, conviviendo pacíficamente con la estación meteorológica (`meteo.service` en puerto 8000).

---

## 1. Arquitectura de Convivencia en el Servidor

```text
                                Internet (HTTPS / 443)
                                          │
                                          ▼
                         ┌─────────────────────────────────┐
                         │   Caddy v2 (varo137.ddns.net)   │
                         └────────────────┬────────────────┘
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  │                                               │
             Ruta "/"                                       Ruta "/campo/*"
                  │                                               │
                  ▼                                               ▼
     ┌──────────────────────────┐                   ┌──────────────────────────┐
     │  meteo.service (Puerto)  │                   │ ganaderos.service (8010) │
     │     127.0.0.1:8000       │                   │      127.0.0.1:8010      │
     │  (Estación Meteorológica)│                   │   (FastAPI + PWA Campo)  │
     └──────────────────────────┘                   └──────────────────────────┘
```

---

## 2. Requisitos Previos en la Placa

- **Hardware:** Orange Pi Zero 3 (1 GB RAM, Linux aarch64).
- **Servicios en ejecución:** Caddy v2 (`systemctl status caddy`).
- **Python:** Python 3.10 o superior con módulo `venv` (`sudo apt install python3-venv python3-pip`).

---

## 3. Procedimiento de Instalación Paso a Paso

### Paso 1: Clonar o Transferir el Código
En la sesión SSH de la Orange Pi (`ssh varo@varo137.ddns.net` o por IP local):

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
cat << 'EOF' > /home/varo/ganaderos_pwa/.env
APP_PORT=8010
PWA_PASSWORD=mvp-testing
GROQ_API_KEY=gsk_tu_clave_de_groq_aqui
GANADEROS_DB_PATH=pwa/ganaderos_campo.sqlite
BACKUP_DIR=backups
BACKUP_RETENTION=7
EOF

chmod 600 /home/varo/ganaderos_pwa/.env
```

### Paso 4: Instalar la Unidad Systemd
Copiar la unidad preconfigurada al sistema:

```bash
sudo cp deploy/ganaderos.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ganaderos.service
```

Comprobar que el servicio arrancó limpiamente en el puerto `8010`:
```bash
sudo systemctl status ganaderos.service
curl -s http://127.0.0.1:8010/api/health
# Debe responder: {"status":"healthy","service":"ganaderos-campo","version":"2.0.0"}
```

---

## 4. Configuración del Reverse Proxy (Caddy v2)

Editar el archivo `/etc/caddy/Caddyfile`:

```bash
sudo nano /etc/caddy/Caddyfile
```

Añadir dentro del bloque del dominio `varo137.ddns.net` el contenido de `deploy/Caddyfile.snippet`:

```caddy
varo137.ddns.net {
    # 1. Rutas de Ganaderos Campo
    handle /campo* {
        uri strip_prefix /campo
        reverse_proxy 127.0.0.1:8010 {
            header_up Host {host}
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-Proto {scheme}
            buffer_requests false
        }
        encode zstd gzip
        header {
            Service-Worker-Allowed "/campo/"
            X-Content-Type-Options "nosniff"
            X-Frame-Options "SAMEORIGIN"
        }
    }

    # 2. Rutas de la Estación Meteorológica (conservadas intactas)
    handle {
        reverse_proxy 127.0.0.1:8000
    }
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

## 6. Verificación Final de la Instalación

1. **Web Meteorológica:** Acceder a `https://varo137.ddns.net/` y comprobar que la telemetría del ESP32 sigue operando con normalidad.
2. **Ganaderos Campo PWA:** Acceder a `https://varo137.ddns.net/campo/` y verificar:
   - Se muestra la pantalla de acceso con contraseña.
   - Introducir `mvp-testing`.
   - Se descarga la base de datos y se inicializa el motor SQLite WebAssembly.
   - Buscar por el crotal de 4 dígitos `1045` mediante el teclado táctil.
   - Poner el teléfono en modo avión y comprobar que la aplicación sigue funcionando offline.
