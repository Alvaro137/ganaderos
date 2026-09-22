#!/usr/bin/env python3
"""Migración de Datos Legacy: Extractor de Access (.mdb) a SQLite Local-First.

Punto de entrada explícito para la migración de datos históricos de Ganaderos 10 (Access MDB)
hacia el esquema relacional de SQLite de campo. Aísla las dependencias ODBC heredadas
fuera del runtime productivo de la API web en Edge.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Asegurar importación del proyecto
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from scripts.import_legacy import main

if __name__ == "__main__":
    sys.exit(main())
