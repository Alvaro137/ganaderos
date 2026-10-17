#!/usr/bin/env python3
"""CLI para gestión y sincronización manual del Vault de Base de Datos en Git."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJ_ROOT = Path(__file__).resolve().parents[1]
if str(PROJ_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJ_ROOT))

from src.infrastructure.access_reader import detectar_ruta_bd  # noqa: E402
from src.infrastructure.backup_vault import (  # noqa: E402
    DEFAULT_VAULT_REMOTE,
    guardar_snapshot_en_vault,
    resolver_directorio_vault,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Guarda un snapshot versionado de las bases de datos en Git.")
    parser.add_argument("--access", type=Path, default=None, help="Ruta a bdlibro.mdb (opcional, auto-detectado si no se indica)")
    parser.add_argument("--sqlite", type=Path, default=PROJ_ROOT / "pwa" / "ganaderos_campo.sqlite", help="Ruta al fichero SQLite (opcional)")
    parser.add_argument("--message", "-m", type=str, default="backup: snapshot manual de base de datos", help="Mensaje del commit de Git")
    parser.add_argument("--vault-dir", type=Path, default=None, help="Directorio del repositorio vault local")
    parser.add_argument("--remote", type=str, default=DEFAULT_VAULT_REMOTE, help="URL del repositorio remoto de Git")
    parser.add_argument("--no-push", action="store_true", help="No enviar al repositorio remoto (solo commit local)")
    args = parser.parse_args()

    access_path = args.access or detectar_ruta_bd()
    if not access_path.exists():
        access_path = None

    sqlite_path = args.sqlite
    if not sqlite_path.exists():
        # Fallback a demo si no existe la de campo
        demo = PROJ_ROOT / "pwa" / "ganaderos_demo.sqlite"
        if demo.exists():
            sqlite_path = demo
        else:
            sqlite_path = None

    vault_dir = resolver_directorio_vault(args.vault_dir)

    print("\n==================================================")
    print("  SNAPSHOT DE BASE DE DATOS -> GIT VAULT")
    print("==================================================")
    print(f"  Vault local:  {vault_dir}")
    print(f"  Remoto:       {args.remote}")
    print(f"  Access MDB:   {access_path or 'No disponible'}")
    print(f"  SQLite:       {sqlite_path or 'No disponible'}")
    print(f"  Push:         {'NO' if args.no_push else 'SI'}")
    print("--------------------------------------------------")

    try:
        res = guardar_snapshot_en_vault(
            vault_dir=vault_dir,
            access_path=access_path,
            sqlite_path=sqlite_path,
            mensaje=args.message,
            remote_url=args.remote,
            push=not args.no_push,
        )
        if res.get("cambios"):
            print(f"[+] Snapshot guardado con éxito (Commit {res.get('commit')})")
            print(f"    Archivos actualizados: {', '.join(res.get('archivos', []))}")
            if res.get("pushed"):
                print("    [OK] Sincronizado correctamente con GitHub.")
            elif not args.no_push:
                print("    [!] Commit creado pero no se pudo hacer push (verificar conexión/claves).")
        else:
            print("[+] " + res.get("message", "Sin cambios."))
        print("==================================================\n")
        return 0
    except Exception as e:
        print(f"[!] Error guardando snapshot en el vault: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
