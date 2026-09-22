#!/usr/bin/env bash
# ==============================================================================
# Script de Despliegue y Actualización en Edge (Orange Pi Zero 3 / Linux aarch64)
# ==============================================================================
set -euo pipefail

DEPLOY_DIR="${1:-/home/varo/ganaderos_pwa}"
SERVICE_NAME="ganaderos.service"
HEALTH_URL="http://127.0.0.1:8010/api/health"

echo "=================================================================="
echo "Iniciando despliegue de Ganaderos Campo en Edge: ${DEPLOY_DIR}"
echo "=================================================================="

if [ ! -d "${DEPLOY_DIR}" ]; then
    echo "[!] Directorio de despliegue no existe: ${DEPLOY_DIR}"
    exit 1
fi

cd "${DEPLOY_DIR}"

# 1. Actualizar código desde repositorio git (si aplica)
if [ -d ".git" ]; then
    echo "[*] Obteniendo últimos cambios de Git (rama master)..."
    git fetch origin master
    git checkout master
    git pull origin master
fi

# 2. Configurar entorno virtual de Python si no existe
if [ ! -d "venv" ]; then
    echo "[*] Creando entorno virtual Python 3..."
    python3 -m venv venv
fi

# 3. Instalar / actualizar dependencias de producción
echo "[*] Instalando dependencias del proyecto..."
venv/bin/pip install --upgrade pip
venv/bin/pip install -e .

# 4. Asegurar existencia de base de datos
if [ ! -f "pwa/ganaderos_campo.sqlite" ] && [ ! -f "pwa/ganaderos_demo.sqlite" ]; then
    echo "[*] No se detectó base de datos previa. Generando dataset de demo..."
    venv/bin/python scripts/generate_demo_db.py --animales 150
fi

# 5. Ejecutar suite de pruebas de humo antes de reiniciar servicio
echo "[*] Verificando integridad con suite de pruebas..."
venv/bin/python -m unittest discover tests

# 6. Reiniciar servicio systemd
if command -v systemctl &> /dev/null && [ -f "/etc/systemd/system/${SERVICE_NAME}" ]; then
    echo "[*] Reiniciando servicio ${SERVICE_NAME}..."
    sudo systemctl daemon-reload
    sudo systemctl restart "${SERVICE_NAME}"
    sudo systemctl enable "${SERVICE_NAME}"
elif [ -f "deploy/compose.prod.yaml" ] && command -v docker &> /dev/null; then
    echo "[*] Reiniciando contenedores Docker Compose..."
    docker compose -f deploy/compose.prod.yaml up -d --build
else
    echo "[!] No se detectó systemd ni docker. Ejecución en segundo plano no configurada."
fi

# 7. Healthcheck y validación del endpoint en puerto 8010
echo "[*] Esperando a que el servicio esté listo en ${HEALTH_URL}..."
sleep 3

MAX_RETRIES=5
COUNT=0
HEALTHY=0

while [ $COUNT -lt $MAX_RETRIES ]; do
    if curl -sf "${HEALTH_URL}" > /dev/null; then
        HEALTHY=1
        break
    fi
    echo "    Reintentando conexión... ($((COUNT+1))/${MAX_RETRIES})"
    sleep 2
    COUNT=$((COUNT+1))
done

if [ $HEALTHY -eq 1 ]; then
    echo "[OK] Despliegue completado con éxito. Ganaderos Campo activo y respondiendo."
    curl -s "${HEALTH_URL}"
    echo ""
else
    echo "[ERROR] El servicio no respondió al healthcheck en ${HEALTH_URL}."
    exit 1
fi
