"""Anti-Corruption Layer (ACL): Adaptador para lectura y migración de Access (.mdb).

AVISO ARQUITECTÓNICO:
Este módulo actúa como adaptador ETL desacoplado para migración histórica desde bases de datos
Microsoft Access de Ganaderos 10. Está diseñado exclusivamente para herramientas de migración
offline en entornos de escritorio Windows con drivers ODBC (scripts/import_legacy_access.py).
NO es utilizado por el runtime del servidor web FastAPI en producción sobre Linux/Edge.
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Generator, Optional

logger = logging.getLogger("ganaderos.access_reader")

try:
    import pyodbc
except ImportError:
    pyodbc = None

LOCK_TIMEOUT_S = 10.0
LOCK_RETRY_S = 0.5
DEFAULT_DB_PASSWORD = os.environ.get("GANADEROS_DB_PASSWORD", "sggnetpy04")


def _pid_sigue_vivo(pid: int) -> bool:
    """Comprueba si un proceso sigue activo en el sistema operativo."""
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def esta_bloqueada_por_access(path: Path) -> bool:
    """Comprueba si existe el fichero de bloqueo .ldb generado por Microsoft Access / Ganaderos 10."""
    try:
        ldb_path = Path(path).with_suffix(".ldb")
        return ldb_path.exists()
    except Exception:
        return False


class FileLock:
    """Lock pesimista atómico por fichero para evitar lecturas concurrentes sucias."""

    def __init__(self, lock_path: Path, timeout: float = LOCK_TIMEOUT_S, retry: float = LOCK_RETRY_S):
        self.lock_path = lock_path
        self.timeout = timeout
        self.retry = retry
        self._fh = None

    def _es_lock_obsoleto(self) -> bool:
        """Determina si un archivo de bloqueo existente pertenece a un proceso muerto o expiró."""
        try:
            if not self.lock_path.exists():
                return False
            mtime = self.lock_path.stat().st_mtime
            if (time.time() - mtime) > 600:
                return True
            contenido = self.lock_path.read_text(encoding="utf-8", errors="ignore")
            import re
            m = re.search(r"PID=(\d+)", contenido)
            if m:
                pid = int(m.group(1))
                if not _pid_sigue_vivo(pid):
                    return True
        except Exception:
            pass
        return False

    def acquire(self) -> None:
        inicio = time.perf_counter()
        while True:
            try:
                self._fh = open(self.lock_path, "x", encoding="utf-8")
                self._fh.write(f"LOCKED by ganaderos-campo PID={os.getpid()} {datetime.now().isoformat()}\n")
                self._fh.flush()
                return
            except FileExistsError:
                if self._es_lock_obsoleto():
                    logger.warning(f"[FileLock] Descartando lock obsoleto en {self.lock_path}")
                    try:
                        self.lock_path.unlink(missing_ok=True)
                        continue
                    except OSError:
                        pass
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


def tiene_controlador_access() -> bool:
    """Comprueba si el entorno Python actual dispone del driver ODBC de Microsoft Access."""
    if pyodbc is None:
        return False
    try:
        drivers = pyodbc.drivers()
        return any("Access" in d for d in drivers)
    except Exception as e:
        logger.warning(f"[Access] Error al enumerar drivers ODBC del sistema: {e}")
        return False


def detectar_python_32() -> Optional[Path]:
    """Busca un intérprete de Python de 32 bits en rutas estándar para entornos Windows 64-bit."""
    repo_root = Path(__file__).resolve().parents[2]
    candidatos = [
        os.environ.get("GANADEROS_PY32"),
        repo_root / ".tools" / "py32" / "python.exe",
        repo_root / "python" / "recetas-mvp" / ".tools" / "py32" / "python.exe",
        Path("C:/GANADEROS 10/python/python.exe"),
    ]
    for c in candidatos:
        if c:
            p = Path(c)
            if p.exists():
                return p
    return None


def detectar_ruta_bd() -> Path:
    """Localiza la base de datos bdlibro.mdb en el sistema."""
    env_path = os.environ.get("GANADEROS_DB_PATH")
    if env_path and Path(env_path).exists():
        return Path(env_path)
    candidatos = [
        Path("C:/GANADEROS 10/bdlibro.mdb"),
        Path("C:/Ganaderos 10/bdlibro.mdb"),
        Path("C:/Ganaderos/bdlibro.mdb"),
        Path(__file__).resolve().parents[2] / "data" / "bdlibro.mdb",
    ]
    for ruta in candidatos:
        if ruta.exists():
            return ruta
    return Path("C:/GANADEROS 10/bdlibro.mdb")


def conn_str_for(path: Path, password: Optional[str] = None) -> str:
    """Genera la cadena de conexión ODBC con el password de Jet/Access si aplica."""
    pwd = password or DEFAULT_DB_PASSWORD
    base = (
        r"Driver={Microsoft Access Driver (*.mdb, *.accdb)};"
        f"DBQ={path.resolve()};"
        r"ExtendedAnsiSQL=1;"
    )
    if pwd:
        base += f"PWD={pwd};"
    return base


@contextmanager
def conexion_access(db_path: Optional[Path] = None, password: Optional[str] = None) -> Generator[pyodbc.Cursor, None, None]:
    """Abre conexión con la base Access asegurando lock atómico y cierre garantizado."""
    if pyodbc is None:
        raise RuntimeError("El controlador pyodbc no está instalado en este entorno.")

    path = db_path or detectar_ruta_bd()
    if not path.exists():
        raise FileNotFoundError(f"Base de datos no encontrada en: {path}")

    lock_file = path.parent / f"{path.stem}.lock"
    with FileLock(lock_file):
        conn = pyodbc.connect(conn_str_for(path, password), autocommit=True)
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
    if isinstance(val, datetime):
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
    """Lee todos los animales resolviendo descripciones de raza y sexo del software legacy."""
    razas: dict[str, str] = {}
    try:
        cur.execute("SELECT id, descripcion FROM Raza")
        razas = {str(r[0]): (r[1] or "").strip() for r in cur.fetchall()}
    except Exception as e:
        logger.warning(f"[Access] No se pudo leer la tabla auxiliar Raza: {e}")

    sexos: dict[str, str] = {}
    try:
        cur.execute("SELECT id, descripcion FROM Sexo")
        sexos = {str(s[0]): (s[1] or "").strip() for s in cur.fetchall()}
    except Exception as e:
        logger.warning(f"[Access] No se pudo leer la tabla auxiliar Sexo: {e}")

    query = """
    SELECT crotal, fnac, raza, sexo, madre, padre, estado, vida, corral,
           fpertenencia, f_ult_parto, nombre
    FROM Animal
    ORDER BY crotal
    """
    filas = []
    try:
        cur.execute(query)
        filas = cur.fetchall()
    except Exception as e:
        logger.error(f"[Access] Error ejecutando SELECT de Animal: {e}", exc_info=True)
        return []

    animales = []
    for f in filas:
        crotal = _limpiar_str(f[0])
        if not crotal:
            continue
        solo_digitos = "".join(c for c in crotal if c.isdigit())
        crotal_4 = solo_digitos[-4:] if len(solo_digitos) >= 4 else solo_digitos
        sexo_cod = _limpiar_str(f[3]) or ""
        sexo_desc = sexos.get(sexo_cod, "Hembra" if sexo_cod in ("02", "04") else "Macho")
        raza_cod = _limpiar_str(f[2]) or ""
        raza_desc = razas.get(raza_cod, "CONJUNTO MESTIZO")

        animales.append({
            "crotal": crotal,
            "crotal_4": crotal_4,
            "nombre": _limpiar_str(f[11]),
            "sexo": sexo_desc,
            "raza": raza_desc,
            "fecha_nacimiento": _fecha_iso(f[1]),
            "madre_crotal": _limpiar_str(f[4]),
            "padre_crotal": _limpiar_str(f[5]),
            "estado": (_limpiar_str(f[6]) or "A").upper(),
            "vida": 1 if f[7] else 0,
            "corral": _limpiar_str(f[8]) or "",
            "fecha_alta": _fecha_iso(f[9]),
            "fecha_ult_parto": _fecha_iso(f[10]),
            "total_partos": 0,
        })
    return animales


def leer_partos(cur: pyodbc.Cursor) -> list[dict[str, Any]]:
    """Extrae los partos conocidos a partir de la filiación de madres e hijos."""
    query = """
    SELECT crotal, fnac, sexo, madre
    FROM Animal
    WHERE madre IS NOT NULL AND madre <> ''
    ORDER BY fnac DESC
    """
    try:
        cur.execute(query)
        filas = cur.fetchall()
    except Exception as exc:
        logger.error("Error al leer partos de Access: %s", exc, exc_info=True)
        return []

    partos = []
    for idx, f in enumerate(filas, start=1):
        madre = _limpiar_str(f[3])
        cria = _limpiar_str(f[0])
        sexo_cod = _limpiar_str(f[2]) or ""
        sexo_str = "Hembra" if sexo_cod in ("02", "04") else "Macho"

        partos.append({
            "id": idx,
            "madre_crotal": madre,
            "fecha_parto": _fecha_iso(f[1]),
            "cria_crotal": cria,
            "cria_sexo": sexo_str,
            "incidencias": "",
        })
    return partos


def leer_movimientos(cur: pyodbc.Cursor) -> list[dict[str, Any]]:
    """Lee el histórico de movimientos de ganado."""
    tipos: dict[str, str] = {}
    try:
        cur.execute("SELECT cod_movi, descripcion FROM TipoMovimiento")
        tipos = {str(t[0]): (t[1] or "").strip() for t in cur.fetchall()}
    except Exception as exc:
        logger.warning("No se pudo cargar tabla TipoMovimiento: %s", exc)

    query = """
    SELECT cod_movi, crotal, fecha, tipo, origen, destino, corral
    FROM Movimiento
    ORDER BY fecha DESC
    """
    try:
        cur.execute(query)
        filas = cur.fetchall()
    except Exception as exc:
        logger.error("Error al leer movimientos de Access: %s", exc, exc_info=True)
        return []

    movimientos = []
    for f in filas:
        crotal = _limpiar_str(f[1])
        if not crotal:
            continue
        tipo_cod = _limpiar_str(f[3]) or ""
        movimientos.append({
            "id": f[0],
            "crotal": crotal,
            "fecha": _fecha_iso(f[2]),
            "tipo": tipos.get(tipo_cod, tipo_cod),
            "origen": _limpiar_str(f[4]) or "",
            "destino": _limpiar_str(f[5]) or "",
            "corral": _limpiar_str(f[6]) or "",
        })
    return movimientos


def leer_explotaciones(cur: pyodbc.Cursor) -> list[dict[str, Any]]:
    """Lee las explotaciones registradas (CEA / REGA)."""
    try:
        cur.execute("SELECT cea, tipo, nombre, finca, activa FROM Explotacion")
        return [
            {
                "cea": (_limpiar_str(f[0]) or ""),
                "tipo": (_limpiar_str(f[1]) or ""),
                "nombre": (_limpiar_str(f[2]) or ""),
                "finca": (_limpiar_str(f[3]) or ""),
                "activa": 1 if f[4] else 0,
            }
            for f in cur.fetchall()
            if _limpiar_str(f[0])
        ]
    except Exception as exc:
        logger.error("Error al leer explotaciones de Access: %s", exc, exc_info=True)
        return []


def leer_recetas_y_tratamientos(cur: pyodbc.Cursor) -> list[dict[str, Any]]:
    """Lee tratamientos sanitarios con supresión y dosis."""
    query = """
    SELECT t.tratamiento, t.fecha, t.receta, m.nombre, t.cantidad, t.veterinario,
           m.supresion, t.proveedor, m.dosis_unitaria, t.cea
    FROM Tratamiento t
    LEFT JOIN Medicamento m ON t.medicamento = m.id
    ORDER BY t.fecha DESC
    """
    try:
        cur.execute(query)
        filas = cur.fetchall()
    except Exception as exc:
        logger.error("Error al leer tratamientos/recetas de Access: %s", exc, exc_info=True)
        return []

    recetas = []
    for f in filas:
        unidades = float(f[4]) if f[4] is not None else 0.0
        dosis = float(f[8]) if f[8] is not None else 0.0

        # Blindaje contra artefactos de escalado Jet Currency (x10.000)
        if unidades >= 10000 and (unidades % 5000 == 0 or unidades % 10000 == 0):
            unidades = round(unidades / 10000.0, 2)
        if dosis >= 10000 and (dosis % 5000 == 0 or dosis % 10000 == 0):
            dosis = round(dosis / 10000.0, 2)

        # Solo calcular n_animales si existe una dosis unitaria por cabeza definida
        if dosis > 0 and unidades > 0:
            n_anim = max(1, round(unidades / dosis))
        else:
            n_anim = None


        recetas.append({
            "id": f[0],
            "fecha": _fecha_iso(f[1]),
            "receta": _limpiar_str(f[2]) or "",
            "medicamento": _limpiar_str(f[3]) or "",
            "unidades": unidades,
            "dosis_unitaria": dosis,
            "n_animales": n_anim,
            "veterinario": _limpiar_str(f[5]) or "",
            "tiempo_carne": int(f[6]) if f[6] is not None else 0,
            "tiempo_leche": 0,
            "proveedor": _limpiar_str(f[7]) or "",
            "cea": _limpiar_str(f[9]) or "",
        })
    return recetas


def leer_compras_alimento(cur: pyodbc.Cursor) -> list[dict[str, Any]]:
    """Lee las compras de pienso y forrajes."""
    query = """
    SELECT c.codigo, c.fecha, a.descripcion, c.kg, c.importe, c.albaran, c.proveedor, c.pagado
    FROM CompraAlimento c
    LEFT JOIN Alimento a ON c.alimento = a.codigo
    ORDER BY c.fecha DESC
    """
    try:
        cur.execute(query)
        filas = cur.fetchall()
    except Exception as exc:
        logger.error("Error al leer compras de alimento de Access: %s", exc, exc_info=True)
        return []

    compras = []
    for f in filas:
        kg = float(f[3]) if f[3] is not None else 0.0
        importe = float(f[4]) if f[4] is not None else 0.0

        # Saneamiento defensivo contra anomalías de escala históricas en Access
        if importe > 1000000 and kg > 0 and 0.10 <= (importe / 100000.0) / kg <= 2.0:
            importe = round(importe / 100000.0, 2)
        elif kg > 0 and 100.0 <= (importe / kg) <= 1000.0:
            precio_real_t = importe / kg
            importe = round(kg * (precio_real_t / 1000.0), 2)

        precio_kg = round(importe / kg, 4) if kg > 0 and importe > 0 else 0.0

        compras.append({
            "id": f[0],
            "fecha": _fecha_iso(f[1]),
            "alimento": _limpiar_str(f[2]) or "",
            "kg": kg,
            "importe": importe,
            "precio_kg": precio_kg,
            "albaran": _limpiar_str(f[5]) or "",
            "proveedor": _limpiar_str(f[6]) or "",
            "pagado": 1 if f[7] else 0,
        })
    return compras
