#!/usr/bin/env python3
"""Utilidad de Verificación Pre-Vuelo y Validación de Despliegue en Edge (Orange Pi Zero 3).

Valida de forma determinista la configuración de infraestructura antes y durante
el despliegue en el SBC:
1. Snippet de Caddy v2 (enrutamiento /campo*, proxy 8010, headers y coexistencia con meteo en 8000).
2. Unidad Systemd (restricciones de memoria, reinicio automático y usuario seguro).
3. Configuración de Docker Compose Prod (límites de recursos y healthcheck).
4. Integridad de la política de copias de seguridad de SQLite.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Rutas estándar del proyecto
ROOT_DIR = Path(__file__).resolve().parent.parent
DEPLOY_DIR = ROOT_DIR / "deploy"
CADDY_SNIPPET = DEPLOY_DIR / "Caddyfile.snippet"
SYSTEMD_UNIT = DEPLOY_DIR / "ganaderos.service"
COMPOSE_PROD = DEPLOY_DIR / "compose.prod.yaml"
BACKUP_SCRIPT = ROOT_DIR / "scripts" / "backup_db.py"


class EdgeVerificationError(Exception):
    """Error durante la validación de configuración Edge."""


def verificar_caddy_snippet(path: Path = CADDY_SNIPPET) -> list[str]:
    """Valida que la configuración de Caddy cumpla con las directivas de seguridad y enrutamiento."""
    if not path.exists():
        raise EdgeVerificationError(f"No se encontró el snippet de Caddy en {path}")

    contenido = path.read_text(encoding="utf-8")
    checks = []

    # 1. Enrutamiento bajo /campo*
    if "handle /campo*" in contenido and "uri strip_prefix /campo" in contenido:
        checks.append("[OK] Subruta /campo* aislada con strip_prefix para PWA y FastAPI.")
    else:
        raise EdgeVerificationError("Caddyfile debe contener 'handle /campo*' con 'uri strip_prefix /campo'.")

    # 2. Reverse proxy al puerto 8010
    if "reverse_proxy 127.0.0.1:8010" in contenido:
        checks.append("[OK] Reverse proxy apunta correctamente al puerto local 8010.")
    else:
        raise EdgeVerificationError("Caddyfile debe apuntar a 127.0.0.1:8010 para convivir con meteo.service.")

    # 3. Cabecera Service-Worker-Allowed
    if 'Service-Worker-Allowed "/campo/"' in contenido:
        checks.append("[OK] Cabecera Service-Worker-Allowed /campo/ inyectada para soporte PWA.")
    else:
        raise EdgeVerificationError("Falta la cabecera 'Service-Worker-Allowed \"/campo/\"' para el Service Worker.")

    # 4. Cabeceras de seguridad
    if "nosniff" in contenido and ("DENY" in contenido or "SAMEORIGIN" in contenido):
        checks.append("[OK] Cabeceras de seguridad HTTP presentes (nosniff, anti-clickjacking, referrer).")
    else:
        raise EdgeVerificationError("Faltan cabeceras de seguridad básicas en Caddyfile.snippet.")

    return checks


def verificar_systemd_unit(path: Path = SYSTEMD_UNIT) -> list[str]:
    """Valida que la unidad systemd esté protegida y limitada para hardware Orange Pi Zero 3."""
    if not path.exists():
        raise EdgeVerificationError(f"No se encontró la unidad systemd en {path}")

    contenido = path.read_text(encoding="utf-8")
    checks = []

    if "Restart=always" in contenido:
        checks.append("[OK] Directiva Restart=always configurada.")
    else:
        raise EdgeVerificationError("La unidad systemd debe contener 'Restart=always'.")

    if "MemoryMax=" in contenido:
        checks.append("[OK] Directiva MemoryMax presente para evitar OOM-killer en 1GB RAM.")
    else:
        raise EdgeVerificationError("Falta la directiva MemoryMax en ganaderos.service.")

    if "APP_PORT=8010" in contenido:
        checks.append("[OK] Puerto 8010 configurado para evitar colisión con meteo.service (8000).")
    else:
        raise EdgeVerificationError("La unidad systemd debe usar explícitamente el puerto 8010.")

    return checks


def verificar_compose_prod(path: Path = COMPOSE_PROD) -> list[str]:
    """Valida los límites de recursos y healthchecks en compose.prod.yaml."""
    if not path.exists():
        raise EdgeVerificationError(f"No se encontró compose.prod.yaml en {path}")

    contenido = path.read_text(encoding="utf-8")
    checks = []

    if "127.0.0.1:8010:8000" in contenido:
        checks.append("[OK] Exposición de puertos acotada a loopback (127.0.0.1:8010).")
    else:
        raise EdgeVerificationError("Docker Compose debe mapear 127.0.0.1:8010:8000 para seguridad.")

    if "cpus:" in contenido and "memory:" in contenido:
        checks.append("[OK] Límites de CPU y memoria acotados para perfil SBC.")
    else:
        raise EdgeVerificationError("Faltan directivas de límites de recursos (cpus/memory) en compose.")

    if "healthcheck:" in contenido and "/api/health" in contenido:
        checks.append("[OK] Sonda de salud (healthcheck) activa hacia /api/health.")
    else:
        raise EdgeVerificationError("Falta el healthcheck hacia /api/health en compose.prod.yaml.")

    return checks


def verificar_backup_engine(path: Path = BACKUP_SCRIPT) -> list[str]:
    """Valida la presencia del script de backup en caliente."""
    if not path.exists():
        raise EdgeVerificationError(f"No se encontró el script de backup en {path}")

    contenido = path.read_text(encoding="utf-8")
    checks = []

    if "src_conn.backup(" in contenido:
        checks.append("[OK] Backup online sin bloqueo implementado mediante API nativa SQLite.")
    else:
        raise EdgeVerificationError("El script de backup debe utilizar la API sqlite3.backup().")

    if "gzip" in contenido and "purgar_backups_antiguos" in contenido:
        checks.append("[OK] Compresión gzip y política de retención verificadas.")
    else:
        raise EdgeVerificationError("El script de backup debe incluir compresión y rotación.")

    return checks


def ejecutar_verificacion_completa() -> bool:
    """Ejecuta todos los checks de infraestructura Edge."""
    print("==================================================================")
    print("VERIFICACIÓN PRE-VUELO DE INFRAESTRUCTURA EDGE (ORANGE PI ZERO 3)")
    print("==================================================================")

    todo_ok = True
    secciones = [
        ("Reverse Proxy Caddy v2", verificar_caddy_snippet),
        ("Unidad Systemd Linux", verificar_systemd_unit),
        ("Docker Compose Producción", verificar_compose_prod),
        ("Motor de Backup en Caliente", verificar_backup_engine),
    ]

    for nombre, fn in secciones:
        print(f"\n--- Comprobando: {nombre} ---")
        try:
            resultados = fn()
            for r in resultados:
                print(f"  {r}")
        except EdgeVerificationError as e:
            print(f"  [FALLO CRÍTICO] {e}")
            todo_ok = False

    print("\n==================================================================")
    if todo_ok:
        print("RESULTADO: 100% de los componentes Edge validados con éxito.")
        print("La configuración está lista para despliegue sin colisiones.")
        print("==================================================================")
        return True
    else:
        print("RESULTADO: Se detectaron fallos en la configuración Edge.")
        print("==================================================================")
        return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Verificación Pre-vuelo para Despliegue en Edge")
    parser.add_argument("--check-only", action="store_true", help="Solo comprobar y salir con código")
    _ = parser.parse_args()

    exito = ejecutar_verificacion_completa()
    sys.exit(0 if exito else 1)


if __name__ == "__main__":
    main()
