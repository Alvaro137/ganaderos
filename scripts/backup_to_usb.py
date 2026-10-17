#!/usr/bin/env python3
"""Script de copia de seguridad local hacia almacenamiento USB para la Orange Pi."""
from __future__ import annotations

import argparse
import logging
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("backup_usb")


def es_punto_montaje(ruta: Path) -> bool:
    """Comprueba si la ruta o alguno de sus padres es un punto de montaje activo."""
    if not ruta.exists():
        return False
    return os.path.ismount(str(ruta.resolve()))


def backup_sqlite_atomico(origen: Path, destino: Path) -> None:
    """Realiza una copia de seguridad consistente de SQLite usando la API de backup nativa."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    temp_dest = destino.with_suffix(".tmp")

    conn_src = sqlite3.connect(f"file:{origen.resolve()}?mode=ro", uri=True)
    conn_dst = sqlite3.connect(str(temp_dest))

    with conn_dst:
        conn_src.backup(conn_dst, pages=250)

    conn_dst.close()
    conn_src.close()

    temp_dest.replace(destino)
    logger.info("Copia SQLite completada: %s (%d bytes)", destino, destino.stat().st_size)


def rotar_copias_antiguas(directorio: Path, max_copias: int = 30) -> int:
    """Mantiene las últimas N copias y elimina las más antiguas."""
    ficheros = sorted(directorio.glob("ganaderos_campo_*.sqlite"), key=lambda p: p.stat().st_mtime)
    eliminados = 0
    if len(ficheros) > max_copias:
        por_eliminar = ficheros[:-max_copias]
        for f in por_eliminar:
            try:
                f.unlink()
                eliminados += 1
                logger.info("Copia antigua purgada: %s", f.name)
            except Exception as e:
                logger.warning("No se pudo eliminar copia antigua %s: %e", f.name, e)
    return eliminados


def main() -> int:
    parser = argparse.ArgumentParser(description="Copia de seguridad consistente de la base de datos hacia USB.")
    parser.add_argument("--db", type=Path, default=Path("/home/varo/ganaderos_pwa/pwa/ganaderos_campo.sqlite"), help="Ruta a la base de datos SQLite")
    parser.add_argument("--dest", type=Path, default=Path("/mnt/usb/backups"), help="Directorio destino en la memoria USB")
    parser.add_argument("--mount-point", type=Path, default=Path("/mnt/usb"), help="Punto de montaje que debe estar activo")
    parser.add_argument("--max-backups", type=int, default=30, help="Número de copias diarias a conservar")
    parser.add_argument("--check-mount", action="store_true", default=True, help="Verificar que el USB esté montado antes de escribir")
    parser.add_argument("--no-check-mount", dest="check_mount", action="store_false")
    args = parser.parse_args()

    # 1. Comprobar existencia de la base de datos origen
    db_origen = args.db
    if not db_origen.exists():
        # Fallback local relativo al script
        fallback = Path(__file__).resolve().parents[1] / "pwa" / "ganaderos_campo.sqlite"
        if fallback.exists():
            db_origen = fallback
        else:
            logger.error("No se encontró la base de datos en %s", db_origen)
            return 1

    # 2. Comprobar que el USB está montado (evita llenar la tarjeta SD si no hay pendrive)
    if args.check_mount and not es_punto_montaje(args.mount_point):
        logger.error("El punto de montaje %s no está montado. Operación cancelada.", args.mount_point)
        return 2

    # 3. Ejecutar copia de seguridad fechada
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    fichero_destino = args.dest / f"ganaderos_campo_{timestamp}.sqlite"

    try:
        backup_sqlite_atomico(db_origen, fichero_destino)
        # Crear copia canónica más reciente
        copia_latest = args.dest / "ganaderos_campo_latest.sqlite"
        shutil.copy2(fichero_destino, copia_latest)
    except Exception as e:
        logger.error("Error durante el backup hacia USB: %s", e, exc_info=True)
        return 3

    # 4. Rotar copias antiguas
    rotar_copias_antiguas(args.dest, max_copias=args.max_backups)
    logger.info("Respaldo diario en USB completado con éxito.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
