"""Sandbox de ejecución segura de consultas SQL SQLite de solo lectura.

Aplica validación léxica de sentencias SELECT, apertura física mode=ro,
inyección de límites de seguridad (LIMIT) y control de timeout.
"""
from __future__ import annotations

import logging
import re
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("ganaderos.ai.sandbox")

_PALABRAS_PROHIBIDAS = {
    "INSERT",
    "UPDATE",
    "DELETE",
    "DROP",
    "ALTER",
    "CREATE",
    "ATTACH",
    "DETACH",
    "PRAGMA",
    "EXECUTE",
    "REPLACE",
    "TRUNCATE",
    "VACUUM",
}


def validar_sql_seguro(sql: str) -> tuple[bool, Optional[str]]:
    """Comprueba que la sentencia sea exclusivamente un SELECT o WITH ... SELECT seguro."""
    if not sql or not isinstance(sql, str):
        return False, "Consulta SQL vacía o no válida."

    sql_limpio = sql.strip()
    if not sql_limpio:
        return False, "Consulta SQL vacía."

    # Eliminar punto y coma final para evaluación
    sql_eval = sql_limpio.rstrip(";")

    # Bloquear consultas múltiples separadas por ';'
    if ";" in sql_eval:
        return False, "No se permiten consultas SQL compuestas ni múltiples sentencias."

    # Tokenizar palabras respetando cadenas de texto
    tokens = re.findall(r"\b[A-Za-z_]+\b", sql_eval.upper())
    if not tokens:
        return False, "La consulta no contiene palabras clave SQL reconocibles."

    primer_token = tokens[0]
    if primer_token not in ("SELECT", "WITH"):
        return False, f"Solo se admiten consultas de lectura SELECT o WITH. Sentencia recibida inicia con '{primer_token}'."

    # Si empieza con WITH, debe contener un SELECT subsiguiente
    if primer_token == "WITH" and "SELECT" not in tokens:
        return False, "Las expresiones CTE (WITH) deben concluir en una sentencia SELECT."

    # Detectar palabras prohibidas en los tokens
    for token in tokens:
        if token in _PALABRAS_PROHIBIDAS:
            return False, f"Operación no permitida en sandbox de lectura: '{token}'."

    return True, None


def aplicar_limite_seguro(sql: str, max_filas: int = 50) -> str:
    """Añade una cláusula LIMIT si la consulta no define un límite explícito."""
    sql_limpio = sql.strip().rstrip(";")
    # Detectar si ya contiene la cláusula LIMIT como palabra clave al final o subconsulta
    # Comprobamos con regex sencilla al nivel principal
    if not re.search(r"\bLIMIT\s+\d+\b", sql_limpio, re.IGNORECASE):
        return f"{sql_limpio}\nLIMIT {max_filas}"
    return sql_limpio


def ejecutar_consulta_sandbox(
    db_path: Path,
    sql: str,
    params: Optional[list[Any]] = None,
    timeout_segundos: float = 1.0,
    max_filas: int = 50,
) -> tuple[bool, list[dict[str, Any]], Optional[str]]:
    """Ejecuta una consulta en SQLite con sandbox de solo lectura y timeout.

    Retorna: (éxito: bool, filas: list[dict], error: Optional[str])
    """
    if not db_path.exists():
        return False, [], f"Base de datos no encontrada en '{db_path}'."

    es_seguro, razon_inseguro = validar_sql_seguro(sql)
    if not es_seguro:
        logger.warning(f"[Sandbox] Consulta rechazada por seguridad: {razon_inseguro} | SQL: {sql}")
        return False, [], razon_inseguro

    sql_final = aplicar_limite_seguro(sql, max_filas=max_filas)
    parametros = params or []

    # Conexión forzada en solo lectura (mode=ro)
    uri_ro = f"file:{db_path.resolve().as_posix()}?mode=ro"

    inicio = time.perf_counter()
    try:
        conn = sqlite3.connect(uri_ro, uri=True, timeout=timeout_segundos)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute(sql_final, parametros)
        rows_raw = cursor.fetchall()
        columnas = [desc[0] for desc in cursor.description] if cursor.description else []
        filas = [{col: row[col] for col in columnas} for row in rows_raw]
        conn.close()

        duracion_ms = (time.perf_counter() - inicio) * 1000
        logger.info(f"[Sandbox] Consulta ejecutada con éxito en {duracion_ms:.1f}ms ({len(filas)} filas)")
        return True, filas, None

    except sqlite3.OperationalError as op_err:
        duracion_ms = (time.perf_counter() - inicio) * 1000
        msg = str(op_err)
        logger.warning(f"[Sandbox] Error de ejecución SQLite ({duracion_ms:.1f}ms): {msg}")
        return False, [], msg
    except Exception as exc:
        duracion_ms = (time.perf_counter() - inicio) * 1000
        msg = f"Error inesperado en consulta: {exc}"
        logger.error(f"[Sandbox] {msg}")
        return False, [], msg
