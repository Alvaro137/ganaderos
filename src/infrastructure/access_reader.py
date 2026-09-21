"""Anti-Corruption Layer (ACL): Lectura y normalización segura de Access (.mdb)."""
from __future__ import annotations

import os
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Generator, Optional

try:
    import pyodbc
except ImportError:
    pyodbc = None

LOCK_TIMEOUT_S = 10.0
LOCK_RETRY_S = 0.5


class FileLock:
    """Lock pesimista atómico por fichero para evitar lecturas concurrentes sucias."""
    def __init__(self, lock_path: Path, timeout: float = LOCK_TIMEOUT_S, retry: float = LOCK_RETRY_S):
        self.lock_path = lock_path
        self.timeout = timeout
        self.retry = retry
        self._fh = None

    def acquire(self) -> None:
        inicio = time.perf_counter()
        while True:
            try:
                self._fh = open(self.lock_path, "x", encoding="utf-8")
                self._fh.write(f"LOCKED by ganaderos-campo PID={os.getpid()} {datetime.now().isoformat()}\n")
                self._fh.flush()
                return
            except FileExistsError:
                if time.perf_counter() - inicio > self.timeout:
                    raise TimeoutError(f"No se pudo adquirir {self.lock_path.name} en {self.timeout:.1f}s.")
                time.sleep(self.retry)

    def release(self) -> None:
        try:
            if self._fh:
                self._fh.close()
            if self.lock_path.exists():
                self.lock_path.unlink(missing_ok=True)
        except OSError:
            pass
        finally:
            self._fh = None

    def __enter__(self) -> "FileLock":
        self.acquire()
        return self

    def __exit__(self, _t, _v, _tb) -> None:
        self.release()


def detectar_ruta_bd() -> Path:
    env_path = os.environ.get("GANADEROS_DB_PATH")
    if env_path and Path(env_path).exists():
        return Path(env_path)
    candidatos = [
        Path(r"C:\GANADEROS 10\bdlibro.mdb"),
        Path(r"C:\Ganaderos\bdlibro.mdb"),
    ]
    for ruta in candidatos:
        if ruta.exists():
            return ruta
    return Path(r"C:\GANADEROS 10\bdlibro.mdb")


def conn_str_for(path: Path) -> str:
    return (
        r"Driver={Microsoft Access Driver (*.mdb, *.accdb)};"
        f"DBQ={path.resolve()};"
        r"ExtendedAnsiSQL=1;"
    )


@contextmanager
def conexion_access(db_path: Optional[Path] = None) -> Generator[pyodbc.Cursor, None, None]:
    if pyodbc is None:
        raise RuntimeError("El controlador pyodbc no está instalado en este entorno.")

    path = db_path or detectar_ruta_bd()
    if not path.exists():
        raise FileNotFoundError(f"Base de datos no encontrada en: {path}")

    lock_file = path.parent / f"{path.stem}.lock"
    with FileLock(lock_file):
        conn = pyodbc.connect(conn_str_for(path), autocommit=True)
        try:
            yield conn.cursor()
        finally:
            conn.close()


def _limpiar_str(val: Any) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def _fecha_iso(val: Any) -> Optional[str]:
    if val is None:
        return None
    if isinstance(val, (datetime, )):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return s[:10]


def leer_animales(cur: pyodbc.Cursor) -> list[dict[str, Any]]:
    sql = """
        SELECT
            CROTAL, NOMBRE, SEXO, RAZA, FECHA_NACIMIENTO,
            MADRE_CROTAL, PADRE_CROTAL, ESTADO, VIDA,
            CORRAL, FECHA_ALTA, FECHA_ULT_PARTO, TOTAL_PARTOS
        FROM LIBRO_ANIMALES
    """
    filas = []
    try:
        cur.execute(sql)
    except Exception:
        return filas

    for row in cur.fetchall():
        crotal = _limpiar_str(row[0])
        if not crotal:
            continue
        c4 = crotal[-4:] if len(crotal) >= 4 else crotal
        filas.append({
            "crotal": crotal,
            "crotal_4": c4,
            "nombre": _limpiar_str(row[1]),
            "sexo": _limpiar_str(row[2]) or "Desconocido",
            "raza": _limpiar_str(row[3]) or "Mestizo",
            "fecha_nacimiento": _fecha_iso(row[4]),
            "madre_crotal": _limpiar_str(row[5]),
            "padre_crotal": _limpiar_str(row[6]),
            "estado": _limpiar_str(row[7]) or "A",
            "vida": int(row[8]) if row[8] is not None else 1,
            "corral": _limpiar_str(row[9]) or "",
            "fecha_alta": _fecha_iso(row[10]),
            "fecha_ult_parto": _fecha_iso(row[11]),
            "total_partos": int(row[12]) if row[12] is not None else 0,
        })
    return filas
