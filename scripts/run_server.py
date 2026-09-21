#!/usr/bin/env python3
"""Punto de entrada para el servidor HTTP de Ganaderos Campo PWA."""
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR))

from src.server.app import run_server

if __name__ == "__main__":
    port = int(os.environ.get("APP_PORT", os.environ.get("PORT", 8000)))
    run_server(port=port)
