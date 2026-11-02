#!/usr/bin/env python3
"""Lanzador Inteligente de Ganaderos 10 (Access Wrapper).

Orquesta el ciclo de vida de la aplicación de escritorio Ganaderos 10:
1. Pre-sincronización: Descarga partos y movimientos de campo desde el Hub y los inyecta en Access.
2. Ejecución: Lanza Ganaderos 10 (bdlibro.mdb) y monitoriza el proceso / bloqueo (.ldb).
3. Post-sincronización: Al cerrar Access, re-exporta el censo a SQLite, actualiza el Hub y respalda en Git Vault.
4. Notificación: Informa al usuario del resultado de la sincronización en el escritorio.
"""
from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

# Asegurar path del repositorio
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.infrastructure.access_reader import (  # noqa: E402
    detectar_python_32,
    detectar_ruta_bd,
    esta_bloqueada_por_access,
    tiene_controlador_access,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ganaderos.launcher")


def mostrar_notificacion_windows(titulo: str, mensaje: str) -> None:
    """Emite una notificación nativa en Windows sin dependencias externas."""
    if sys.platform != "win32":
        print(f"[{titulo}] {mensaje}")
        return

    ps_script = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; "
        "$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); "
        "$texts = $template.GetElementsByTagName('text'); "
        f"$texts.Item(0).AppendChild($template.CreateTextNode('{titulo}')) | Out-Null; "
        f"$texts.Item(1).AppendChild($template.CreateTextNode('{mensaje}')) | Out-Null; "
        "$toast = [Windows.UI.Notifications.ToastNotification]::new($template); "
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Ganaderos Campo').Show($toast);"
    )

    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
            capture_output=True,
            timeout=5,
            check=False,
        )
    except Exception as e:
        logger.debug(f"No se pudo mostrar notificación Windows: {e}")


def ejecutar_sync_access(
    source_mdb: Path,
    api_url: str,
    pwa_password: str,
    force_export: bool = False,
    dry_run: bool = False,
) -> bool:
    """Ejecuta el pipeline de sincronización delegando a sync_access_merge.py."""
    script_sync = ROOT_DIR / "scripts" / "sync_access_merge.py"
    if not script_sync.exists():
        logger.error(f"Script de sincronización no encontrado en {script_sync}")
        return False

    cmd = [
        sys.executable,
        str(script_sync),
        "--source",
        str(source_mdb),
        "--api-url",
        api_url,
        "--pwa-password",
        pwa_password,
    ]
    if force_export:
        cmd.append("--force-export")
    if dry_run:
        cmd.append("--dry-run")

    # Si estamos en 64-bit y no hay ODBC, delegar directamente al python 32-bit
    if not tiene_controlador_access():
        py32 = detectar_python_32()
        if py32:
            cmd[0] = str(py32)

    try:
        logger.info(f"Ejecutando sync: {' '.join(cmd[1:3])} (force={force_export})...")
        res = subprocess.run(cmd, capture_output=False, text=True, check=False)
        return res.returncode == 0
    except Exception as e:
        logger.warning(f"Fallo ejecutando sync: {e}")
        return False


def lanzar_ganaderos_access(mdb_path: Path, app_exe: Optional[Path] = None) -> bool:
    """Inicia el programa Ganaderos 10 o abre bdlibro.mdb con Microsoft Access."""
    if app_exe and Path(app_exe).exists():
        logger.info(f"Iniciando ejecutable Ganaderos 10: {app_exe}")
        try:
            subprocess.Popen([str(app_exe)])
            return True
        except Exception as e:
            logger.warning(f"No se pudo abrir ejecutable {app_exe}: {e}. Intentando abrir base de datos...")

    logger.info(f"Abriendo base de datos Access: {mdb_path}")
    try:
        if sys.platform == "win32":
            os.startfile(str(mdb_path))  # type: ignore[attr-defined]
            return True
        else:
            subprocess.Popen(["xdg-open", str(mdb_path)])
            return True
    except Exception as e:
        logger.error(f"Error abriendo {mdb_path}: {e}")
        return False


def esperar_cierre_access(mdb_path: Path, max_espera_inicio: int = 15) -> None:
    """Espera a que Access adquiera el bloqueo (.ldb) y luego monitorea hasta que se cierre."""
    logger.info("Esperando inicio de sesión en Access (.ldb)...")
    inicio = time.time()
    bloqueado = False

    while time.time() - inicio < max_espera_inicio:
        if esta_bloqueada_por_access(mdb_path):
            bloqueado = True
            logger.info("Access detectado en ejecución (.ldb activo).")
            break
        time.sleep(1)

    if not bloqueado:
        logger.info("No se detectó archivo .ldb tras el arranque (Access puede no haber iniciado o se cerró inmediatamente).")
        return

    logger.info("Monitorizando ejecución de Ganaderos 10... (esperando cierre para sincronizar)")
    while esta_bloqueada_por_access(mdb_path):
        time.sleep(2)

    logger.info("Access se ha cerrado (.ldb liberado).")
    # Pausa de seguridad para que el sistema de archivos libere cualquier descriptor residual
    time.sleep(2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Lanzador Inteligente y Wrapper de Sincronización para Ganaderos 10.")
    parser.add_argument("--source", type=Path, default=None, help="Ruta a bdlibro.mdb")
    parser.add_argument("--app-exe", type=Path, default=None, help="Ruta al ejecutable de Ganaderos 10 (opcional)")
    parser.add_argument(
        "--api-url",
        type=str,
        default=os.environ.get("GANADEROS_API_URL", "https://campo.alvaro137.com"),
        help="URL base del hub remoto",
    )
    parser.add_argument(
        "--pwa-password",
        type=str,
        default=os.environ.get("PWA_PASSWORD", "ganaderos"),
        help="Contraseña de la explotación",
    )
    parser.add_argument("--skip-pre-sync", action="store_true", help="Omite la sincronización previa a la apertura")
    parser.add_argument("--skip-post-sync", action="store_true", help="Omite la sincronización posterior al cierre")
    parser.add_argument("--dry-run", action="store_true", help="Modo simulación sin escribir en Access ni subir datos")
    parser.add_argument("--no-launch", action="store_true", help="Solo sincroniza sin lanzar Access (modo manual)")
    args = parser.parse_args()

    source = args.source or detectar_ruta_bd()
    if not source.exists():
        msg = f"Base de datos Access no encontrada en: {source}"
        logger.error(msg)
        mostrar_notificacion_windows("Ganaderos Campo - Error", msg)
        return 1

    print("==================================================")
    print("  GANADEROS 10 - LANZADOR INTELIGENTE CON SYNC")
    print("==================================================")
    print(f"  Base de datos: {source}")
    print(f"  Hub remoto:    {args.api_url}")
    print("==================================================")

    # 1. PRE-SYNC (Incorporar partos/movimientos del móvil antes de abrir)
    if not args.skip_pre_sync:
        if esta_bloqueada_por_access(source):
            logger.warning("Access ya está abierto (.ldb detectado). Omitiendo pre-sincronización para evitar colisiones.")
        else:
            print("\n[*] [1/3] Pre-sincronizando: descargando eventos de campo...")
            ok_pre = ejecutar_sync_access(
                source_mdb=source,
                api_url=args.api_url,
                pwa_password=args.pwa_password,
                force_export=False,
                dry_run=args.dry_run,
            )
            if ok_pre:
                logger.info("Pre-sincronización completada con éxito.")
            else:
                logger.warning("Pre-sincronización no pudo completarse (sin red o hub no disponible). Continuando con Access...")

    # Si se solicitó solo sincronización manual sin lanzar Access
    if args.no_launch:
        print("\n[*] Modo sin apertura de programa completado.")
        return 0

    # 2. LANZAR GANADEROS 10
    print("\n[*] [2/3] Iniciando Ganaderos 10...")
    abierto = lanzar_ganaderos_access(source, args.app_exe)
    if not abierto:
        msg = "No se pudo iniciar Microsoft Access / Ganaderos 10."
        logger.error(msg)
        mostrar_notificacion_windows("Ganaderos Campo", msg)
        return 1

    # Esperar mientras el usuario trabaja en Access
    esperar_cierre_access(source)

    # 3. POST-SYNC (Re-exportar SQLite consolidado, subir a Orange Pi y Git Vault)
    if not args.skip_post_sync:
        print("\n[*] [3/3] Post-sincronizando: exportando censo y respaldando...")
        ok_post = ejecutar_sync_access(
            source_mdb=source,
            api_url=args.api_url,
            pwa_password=args.pwa_password,
            force_export=True,
            dry_run=args.dry_run,
        )
        if ok_post:
            msg = "Censo sincronizado con el móvil y respaldado en Git."
            logger.info(f"POST-SYNC OK: {msg}")
            mostrar_notificacion_windows("Ganaderos Campo", msg)
        else:
            msg = "No se pudo sincronizar el censo tras cerrar Access. Verifica la conexión a Internet."
            logger.warning(f"POST-SYNC AVISO: {msg}")
            mostrar_notificacion_windows("Ganaderos Campo - Aviso", msg)

    print("\n[+] Proceso finalizado con éxito.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
