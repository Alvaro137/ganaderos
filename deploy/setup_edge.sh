#!/usr/bin/env bash
# ==============================================================================
# Script de Instalación y Aprovisionamiento "Zero-Touch" para Edge (Orange Pi)
# Automatiza: systemd service, auto-inyección en Caddy, venv, DB y healthcheck.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CURRENT_USER="${SUDO_USER:-$(whoami)}"
CURRENT_GROUP="$(id -gn "${CURRENT_USER}")"
SERVICE_DEST="/etc/systemd/system/ganaderos.service"
CADDYFILE="/etc/caddy/Caddyfile"
SNIPPET_FILE="${SCRIPT_DIR}/Caddyfile.snippet"

echo "=================================================================="
echo "⚡ Aprovisionamiento Automatizado Ganaderos Campo (Orange Pi SBC)"
echo "   Usuario: ${CURRENT_USER}:${CURRENT_GROUP}"
echo "   Directorio: ${REPO_DIR}"
echo "=================================================================="

# 1. Instalar y ajustar servicio systemd dinámicamente al usuario actual
echo "[1/5] Configurando unidad systemd en ${SERVICE_DEST}..."
sudo tee "${SERVICE_DEST}" > /dev/null <<EOF
[Unit]
Description=Ganaderos Campo PWA (Backend FastAPI & SQLite WASM Server)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${CURRENT_USER}
Group=${CURRENT_GROUP}
WorkingDirectory=${REPO_DIR}
Environment=PYTHONUNBUFFERED=1
Environment=APP_PORT=8010
EnvironmentFile=-${REPO_DIR}/.env

ExecStart=${REPO_DIR}/venv/bin/python scripts/run_server.py

Restart=always
RestartSec=5s

ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${REPO_DIR}/pwa ${REPO_DIR}/backups
NoNewPrivileges=true

MemoryMax=350M
MemoryHigh=280M

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ganaderos.service
echo "      [OK] Servicio systemd registrado y habilitado para inicio automático."

# 2. Inyección automatizada en Caddyfile si existe y no está ya configurado
echo "[2/5] Comprobando Reverse Proxy Caddy..."
if [ -f "${CADDYFILE}" ]; then
    if grep -q "handle /campo\*" "${CADDYFILE}"; then
        echo "      [OK] Subruta /campo* ya presente en ${CADDYFILE}."
    else
        echo "      [*] Inyectando bloque /campo* en ${CADDYFILE}..."
        sudo cp "${CADDYFILE}" "${CADDYFILE}.bak.$(date +%Y%m%d_%H%M%S)"
        
        # Inyectar antes del último cierre de bloque '}' del Caddyfile
        TMP_CADDY=$(mktemp)
        awk '
            BEGIN { p=1 }
            /\}/ { last_brace_line = NR }
            { lines[NR] = $0 }
            END {
                for (i = 1; i <= NR; i++) {
                    if (i == last_brace_line) {
                        print "\n    # --- Ganaderos Campo PWA (Inyectado Automáticamente) ---"
                        print "    handle /campo* {"
                        print "        uri strip_prefix /campo"
                        print "        reverse_proxy 127.0.0.1:8010 {"
                        print "            buffer_requests false"
                        print "        }"
                        print "        encode zstd gzip"
                        print "        header {"
                        print "            Service-Worker-Allowed \"/campo/\""
                        print "            X-Content-Type-Options \"nosniff\""
                        print "            X-Frame-Options \"SAMEORIGIN\""
                        print "        }"
                        print "    }"
                    }
                    print lines[i]
                }
            }
        ' "${CADDYFILE}" > "${TMP_CADDY}"
        
        sudo cp "${TMP_CADDY}" "${CADDYFILE}"
        rm -f "${TMP_CADDY}"
        
        # Validar y recargar Caddy
        if sudo caddy validate --config "${CADDYFILE}" &> /dev/null; then
            sudo systemctl reload caddy
            echo "      [OK] Caddyfile validado y recargado con éxito."
        else
            echo "      [!] Falló la validación de Caddy. Restaurando copia de seguridad..."
            sudo cp "${CADDYFILE}.bak.*" "${CADDYFILE}"
            sudo systemctl reload caddy
        fi
    fi
else
    echo "      [i] /etc/caddy/Caddyfile no encontrado. Puedes aplicar deploy/Caddyfile.snippet manualmente."
fi

# 3. Lanzar script de despliegue y validación de aplicación
echo "[3/5] Compilando entorno Python y pasando pruebas pre-vuelo..."
bash "${SCRIPT_DIR}/deploy_edge.sh" "${REPO_DIR}"

echo ""
echo "=================================================================="
echo "🎉 ¡Aprovisionamiento Edge Completado con Éxito!"
echo "   - Servicio systemd: active (running)"
echo "   - Puerto local:     127.0.0.1:8010"
echo "   - Métricas RAM:     Límite cgroup a 350 MB"
echo "   - URL de salud:     curl http://127.0.0.1:8010/api/health"
echo "=================================================================="
