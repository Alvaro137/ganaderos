#!/usr/bin/env python3
"""Script de copia de seguridad consistente y rotación para la base de datos de campo."""
from __future__ import annotations

import argparse
import gzip
import logging
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("backup_db")


def realizar_backup(
    db_path: Path | str,
    backup_dir: Path | str,
    retencion: int = 7,
    comprimir: bool = True,
) -> Optional[Path]:
    """Ejecuta una copia de seguridad online atómica de SQLite con compresión y rotación."""
    source_path = Path(db_path).resolve()
    target_dir = Path(backup_dir).resolve()

    if not source_path.exists():
        logger.error(f"Base de datos de origen no encontrada: {source_path}")
        return None

    target_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    temp_sqlite_name = f"ganaderos_backup_{timestamp}.sqlite"
    temp_sqlite_path = target_dir / temp_sqlite_name

    logger.info(f"Iniciando backup online de SQLite desde {source_path.name}...")

    src_conn = None
    dst_conn = None
    try:
        src_conn = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
        dst_conn = sqlite3.connect(temp_sqlite_path)
        src_conn.backup(dst_conn, pages=100)
    except Exception as e:
        logger.error(f"Error durante el backup de SQLite: {e}")
        if temp_sqlite_path.exists():
            temp_sqlite_path.unlink()
        return None
    finally:
        if dst_conn:
            dst_conn.close()
        if src_conn:
            src_conn.close()

    final_path = temp_sqlite_path

    # Compresión gzip para reducir almacenamiento en placa SBC
    if comprimir:
        gz_path = target_dir / f"{temp_sqlite_name}.gz"
        logger.info(f"Comprimiendo backup a {gz_path.name}...")
        try:
            with open(temp_sqlite_path, "rb") as f_in:
                with gzip.open(gz_path, "wb", compresslevel=6) as f_out:
                    shutil.copyfileobj(f_in, f_out)
            temp_sqlite_path.unlink()
            final_path = gz_path
        except Exception as e:
            logger.error(f"Error comprimiendo el archivo de backup: {e}")
            return temp_sqlite_path

    logger.info(f"Backup completado con éxito: {final_path} ({final_path.stat().st_size} bytes)")

    # Aplicar política de retención
    purgar_backups_antiguos(target_dir, retencion)
    return final_path


def purgar_backups_antiguos(backup_dir: Path | str, retencion: int) -> List[Path]:
    """Elimina copias de seguridad antiguas manteniendo las N más recientes."""
    target_dir = Path(backup_dir).resolve()
    if not target_dir.exists() or retencion <= 0:
        return []

    patron_archivos = sorted(
        list(target_dir.glob("ganaderos_backup_*.sqlite*")),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )

    purgados: List[Path] = []
    if len(patron_archivos) > retencion:
        a_eliminar = patron_archivos[retencion:]
        for arch in a_eliminar:
            try:
                arch.unlink()
                purgados.append(arch)
                logger.info(f"Backup antiguo purgado según política de retención: {arch.name}")
            except Exception as e:
                logger.warning(f"No se pudo eliminar {arch.name}: {e}")

    return purgados


def main() -> None:
    parser = argparse.ArgumentParser(description="Backup y rotación de SQLite para Ganaderos Campo.")
    parser.add_argument(
        "--db",
        type=str,
        default=os.environ.get("GANADEROS_DB_PATH", "pwa/ganaderos_campo.sqlite"),
        help="Ruta a la base de datos SQLite.",
    )
    parser.add_argument(
        "--dest",
        type=str,
        default=os.environ.get("BACKUP_DIR", "backups"),
        help="Directorio de almacenamiento de backups.",
    )
    parser.add_argument(
        "--retention",
        type=int,
        default=int(os.environ.get("BACKUP_RETENTION", 7)),
        help="Número de copias a retener.",
    )
    parser.add_argument(
        "--no-compress",
        action="store_true",
        help="Desactivar compresión gzip.",
    )

    args = parser.parse_args()
    db_path = Path(args.db)
    if not db_path.exists():
        # Fallback a demo si no existe la de campo
        demo_db = Path("pwa/ganaderos_demo.sqlite")
        if demo_db.exists():
            db_path = demo_db

    resultado = realizar_backup(
        db_path=db_path,
        backup_dir=args.dest,
        retencion=args.retention,
        comprimir=not args.no_compress,
    )

    if not resultado:
        sys.exit(1)


if __name__ == "__main__":
    main()
