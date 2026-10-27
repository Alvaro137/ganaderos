"""Motor de sincronización offline-first: la Orange Pi como hub de consolidación.

Reglas de oro (véase CONTEXT.md §Sync):
- El PC (bdlibro.mdb) es la fuente de verdad del CENSO; los móviles solo AÑADEN
  registros de campo (append-only) → no existen conflictos de edición.
- La BD maestra consolida: último censo importado del PC + registros de campo
  históricos, que se reintegran SIEMPRE tras cada import (nunca se pierden).
- Escrituras atómicas y SOLO cuando hay cambios: import/consolidación se hace en
  un fichero temporal del mismo disco y se promueve con os.replace().
- Idempotencia por UUID: los reintentos del móvil nunca duplican datos.
- El epoch es un contador incremental: el móvil compara su epoch con el del hub
  para saber si hay novedades antes de descargar (2-5 MB por WiFi).
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

TIPOS_PERMITIDOS = {"nota", "parto", "cambio_corral", "tratamiento", "movimiento", "baja", "otro"}
MAX_PAYLOAD_BYTES = 8192
MAX_CAMPOS = 500  # límite defensivo por push

TABLAS_CENSO_REQUERIDAS = {"animales", "partos", "movimientos", "recetas", "compras_alimento"}

SQL_TABLAS_SYNC = """
CREATE TABLE IF NOT EXISTS campo_registros (
    uuid TEXT PRIMARY KEY,
    tipo TEXT NOT NULL,
    crotal TEXT,
    operador TEXT NOT NULL,
    device_id TEXT,
    ts_dispositivo TEXT,
    ts_servidor TEXT NOT NULL DEFAULT (datetime('now')),
    payload TEXT,
    conciliado_en_access INTEGER NOT NULL DEFAULT 0,
    ts_conciliado TEXT,
    crotal_asignado TEXT
);
CREATE INDEX IF NOT EXISTS idx_campo_crotal ON campo_registros(crotal);
CREATE INDEX IF NOT EXISTS idx_campo_tipo ON campo_registros(tipo);
CREATE TABLE IF NOT EXISTS _sync_estado (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    epoch INTEGER NOT NULL DEFAULT 0,
    actualizado_en TEXT
);
INSERT OR IGNORE INTO _sync_estado (id, epoch, actualizado_en) VALUES (1, 0, datetime('now'));
"""


class SyncError(Exception):
    """Error de validación/operación de sincronización (→ HTTP 400/422)."""


class SyncService:
    """Consolida el censo importado del PC con los registros de campo de los móviles."""

    # Lock reentrante para serializar mutaciones concurrentes e importaciones
    _mutation_lock = threading.RLock()

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)

    # ------------------------------------------------------------------ #
    # Infraestructura interna
    # ------------------------------------------------------------------ #

    def _conectar(self, db_path: Optional[Path] = None) -> sqlite3.Connection:
        """Abre la BD configurada en WAL mode (lecturas concurrentes + escrituras crash-safe)."""
        ruta = Path(db_path or self.db_path)
        ruta.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(ruta), timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA busy_timeout = 10000")
        cur = conn.cursor()
        cur.executescript(SQL_TABLAS_SYNC)

        # Migración de columnas defensiva para bases de datos existentes
        for col_def in (
            "conciliado_en_access INTEGER NOT NULL DEFAULT 0",
            "ts_conciliado TEXT",
            "crotal_asignado TEXT",
        ):
            try:
                conn.execute(f"ALTER TABLE campo_registros ADD COLUMN {col_def}")
            except sqlite3.OperationalError:
                pass

        try:
            conn.execute("CREATE INDEX IF NOT EXISTS idx_campo_conciliado ON campo_registros(conciliado_en_access)")
        except sqlite3.OperationalError:
            pass

        conn.commit()
        return conn

    def _leer_estado(self, conn: sqlite3.Connection) -> Dict[str, Any]:
        row = conn.execute(
            "SELECT epoch, actualizado_en FROM _sync_estado WHERE id = 1"
        ).fetchone()
        return {"epoch": row[0] if row else 0, "actualizado_en": row[1] if row else None}

    def _epoch_sube(self, conn: sqlite3.Connection) -> int:
        conn.execute(
            "UPDATE _sync_estado SET epoch = epoch + 1, actualizado_en = datetime('now') "
            "WHERE id = 1"
        )
        return conn.execute("SELECT epoch FROM _sync_estado WHERE id = 1").fetchone()[0]

    def _fecha_exportacion(self, conn: sqlite3.Connection) -> Optional[str]:
        try:
            row = conn.execute(
                "SELECT valor FROM meta WHERE clave = 'fecha_exportacion'"
            ).fetchone()
            return row[0] if row else None
        except sqlite3.OperationalError:
            return None

    # ------------------------------------------------------------------ #
    # Estado (para GET /api/sync/status)
    # ------------------------------------------------------------------ #

    def estado(self) -> Dict[str, Any]:
        if not self.db_path.exists():
            return {
                "epoch": 0,
                "actualizado_en": None,
                "registros_campo": 0,
                "fecha_exportacion": None,
                "existe_bd": False,
            }
        conn = self._conectar()
        try:
            estado = self._leer_estado(conn)
            estado["registros_campo"] = conn.execute(
                "SELECT COUNT(*) FROM campo_registros"
            ).fetchone()[0]
            estado["fecha_exportacion"] = self._fecha_exportacion(conn)
            estado["existe_bd"] = True
            return estado
        finally:
            conn.close()

# === PARTE 2 ===

    # ------------------------------------------------------------------ #
    # PUSH: aplicar cambios de un dispositivo (append-only, idempotente)
    # ------------------------------------------------------------------ #

    def aplicar_cambios(
        self, device_id: str, operador: str, changes: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        if len(changes) > MAX_CAMPOS:
            raise SyncError(f"Demasiados cambios en un push ({len(changes)} > {MAX_CAMPOS}).")

        with self._mutation_lock:
            conn = self._conectar()
            try:
                aceptados: List[str] = []
                duplicados: List[str] = []
                rechazados: List[Dict[str, str]] = []

                for ch in changes:
                    uuid = str(ch.get("uuid") or "").strip()
                    tipo = str(ch.get("tipo") or "").strip().lower()
                    crotal = str(ch.get("crotal") or "").strip() or None
                    ts_dispositivo = str(ch.get("ts_dispositivo") or "").strip() or None
                    payload = ch.get("payload")

                    if not uuid or len(uuid) > 64:
                        rechazados.append({"uuid": uuid[:64], "motivo": "uuid ausente o inválido"})
                        continue
                    if tipo not in TIPOS_PERMITIDOS:
                        rechazados.append({"uuid": uuid, "motivo": f"tipo no permitido: {tipo!r}"})
                        continue
                    if crotal and len(crotal) > 32:
                        rechazados.append({"uuid": uuid, "motivo": "crotal demasiado largo"})
                        continue

                    try:
                        payload_txt = json.dumps(payload, ensure_ascii=False) if payload else None
                    except (TypeError, ValueError):
                        rechazados.append({"uuid": uuid, "motivo": "payload no serializable a JSON"})
                        continue
                    if payload_txt and len(payload_txt.encode("utf-8")) > MAX_PAYLOAD_BYTES:
                        rechazados.append({"uuid": uuid, "motivo": "payload demasiado grande"})
                        continue

                    ya_estaba = conn.execute(
                        "SELECT 1 FROM campo_registros WHERE uuid = ?", (uuid,)
                    ).fetchone()
                    if ya_estaba:
                        # Idempotencia: reintento del dispositivo, ya integrado antes.
                        duplicados.append(uuid)
                        aceptados.append(uuid)
                        continue

                    try:
                        conn.execute(
                            "INSERT INTO campo_registros "
                            "(uuid, tipo, crotal, operador, device_id, ts_dispositivo, payload) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (uuid, tipo, crotal, operador, device_id, ts_dispositivo, payload_txt),
                        )
                        aceptados.append(uuid)
                    except sqlite3.IntegrityError:
                        # Idempotencia defensiva ante reintentos concurrentes de red
                        duplicados.append(uuid)
                        aceptados.append(uuid)

                nuevos = len(aceptados) - len(duplicados)
                epoch = self._leer_estado(conn)["epoch"]
                if nuevos > 0:
                    epoch = self._epoch_sube(conn)

                conn.commit()  # transacción atómica: o se integra todo o nada
                return {
                    "aceptados": aceptados,
                    "rechazados": rechazados,
                    "duplicados": duplicados,
                    "epoch": epoch,
                }
            finally:
                conn.close()

# === PARTE 3 ===

    # ------------------------------------------------------------------ #
    # IMPORT: censo actualizado del PC → consolidación (nunca pierde campo)
    # ------------------------------------------------------------------ #

    def importar_bd_actualizada(self, nueva_bd: Path) -> Dict[str, Any]:
        """Toma la BD de censo recién exportada por el PC y la convierte en la nueva
        maestra consolidada, reintegrando el histórico de registros de campo.

        Escritura atómica: se construye un fichero temporal en el mismo disco y se
        promueve con os.replace(). Si algo falla, la maestra actual queda intacta.
        """
        nueva_bd = Path(nueva_bd)
        if not nueva_bd.exists():
            raise SyncError("La BD actualizada no existe.")

        # 1. Validar la BD entrante ANTES de tocar nada
        chequeo = sqlite3.connect(f"file:{nueva_bd}?mode=ro", uri=True)
        try:
            try:
                resultado = chequeo.execute("PRAGMA integrity_check").fetchone()[0]
            except sqlite3.DatabaseError:
                raise SyncError("La BD actualizada no es un fichero SQLite válido.")
            if resultado != "ok":
                raise SyncError(f"La BD actualizada está corrupta (integrity: {resultado}).")
            try:
                existentes = {
                    r[0] for r in chequeo.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
                fecha_row = chequeo.execute(
                    "SELECT valor FROM meta WHERE clave = 'fecha_exportacion'"
                ).fetchone()
            except sqlite3.DatabaseError:
                raise SyncError("La BD actualizada no es un fichero SQLite válido.")
            faltan = TABLAS_CENSO_REQUERIDAS - existentes
            if faltan:
                raise SyncError(f"La BD actualizada no tiene las tablas de censo: {sorted(faltan)}")
            fecha_nueva = fecha_row[0] if fecha_row else None
        finally:
            chequeo.close()

        # 2. Rescatar el histórico de registros de campo de la maestra actual bajo lock exclusivo
        with self._mutation_lock:
            historico: List[Dict[str, Any]] = []
            epoch_previo = 0
            if self.db_path.exists():
                vieja = self._conectar()
                try:
                    historico = [dict(r) for r in vieja.execute(
                        "SELECT uuid, tipo, crotal, operador, device_id, ts_dispositivo, "
                        "ts_servidor, payload, conciliado_en_access, ts_conciliado, crotal_asignado "
                        "FROM campo_registros"
                    ).fetchall()]
                    epoch_previo = self._leer_estado(vieja)["epoch"]
                finally:
                    vieja.close()

            # 3. Construir la nueva maestra en fichero temporal (mismo disco → rename atómico)
            tmp_path = self.db_path.with_suffix(".import_tmp.sqlite")
            try:
                shutil.copyfile(nueva_bd, tmp_path)
                conn = self._conectar(tmp_path)
                try:
                    for r in historico:
                        conn.execute(
                            "INSERT OR IGNORE INTO campo_registros "
                            "(uuid, tipo, crotal, operador, device_id, ts_dispositivo, "
                            "ts_servidor, payload, conciliado_en_access, ts_conciliado, crotal_asignado) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (r["uuid"], r["tipo"], r["crotal"], r["operador"], r["device_id"],
                             r["ts_dispositivo"], r["ts_servidor"], r["payload"],
                             r.get("conciliado_en_access", 0), r.get("ts_conciliado"), r.get("crotal_asignado")),
                        )
                    nuevo_epoch = epoch_previo + 1
                    conn.execute(
                        "INSERT OR REPLACE INTO _sync_estado (id, epoch, actualizado_en) "
                        "VALUES (1, ?, datetime('now'))",
                        (nuevo_epoch,),
                    )
                    conn.commit()
                finally:
                    conn.close()

                # Asegurar persistencia física en disco (fsync) antes de promover
                try:
                    with open(tmp_path, "a") as f_sync:
                        f_sync.flush()
                        os.fsync(f_sync.fileno())
                except OSError:
                    pass

                # 4. Promoción atómica (con reintento si un lector retiene el fichero)
                for intento in range(3):
                    try:
                        os.replace(tmp_path, self.db_path)
                        break
                    except PermissionError:
                        if intento == 2:
                            raise
                        time.sleep(0.3)

                # En sistemas POSIX, asegurar el directorio contenedor para durabilidad del renombrado
                if hasattr(os, "O_DIRECTORY"):
                    try:
                        dir_fd = os.open(str(self.db_path.parent), os.O_RDONLY | os.O_DIRECTORY)
                        os.fsync(dir_fd)
                        os.close(dir_fd)
                    except OSError:
                        pass
            finally:
                if tmp_path.exists():
                    try:
                        tmp_path.unlink()
                    except OSError:
                        pass

        resumen = self.estado()
        resumen["importado"] = {
            "fecha_exportacion": fecha_nueva,
            "registros_campo_reintegrados": len(historico),
            "epoch": resumen["epoch"],
        }
        return resumen

    # ------------------------------------------------------------------ #
    # Historial y Conciliación con Access
    # ------------------------------------------------------------------ #

    def historial(self, limite: int = 50) -> List[Dict[str, Any]]:
        conn = self._conectar()
        try:
            rows = conn.execute(
                "SELECT uuid, tipo, crotal, operador, device_id, ts_dispositivo, "
                "ts_servidor, payload, conciliado_en_access, ts_conciliado, crotal_asignado "
                "FROM campo_registros "
                "ORDER BY ts_servidor DESC, uuid LIMIT ?",
                (max(1, min(limite, 200)),),
            ).fetchall()
            cols = [
                "uuid", "tipo", "crotal", "operador", "device_id",
                "ts_dispositivo", "ts_servidor", "payload",
                "conciliado_en_access", "ts_conciliado", "crotal_asignado",
            ]
            return [dict(zip(cols, r)) for r in rows]
        finally:
            conn.close()

    def listar_pendientes(self, tipo: Optional[str] = None) -> List[Dict[str, Any]]:
        """Devuelve los registros de campo pendientes de conciliar en Access (conciliado_en_access = 0)."""
        conn = self._conectar()
        try:
            sql = (
                "SELECT uuid, tipo, crotal, operador, device_id, ts_dispositivo, "
                "ts_servidor, payload, conciliado_en_access, ts_conciliado, crotal_asignado "
                "FROM campo_registros WHERE conciliado_en_access = 0"
            )
            params: list[Any] = []
            if tipo:
                sql += " AND tipo = ?"
                params.append(tipo.lower().strip())
            sql += " ORDER BY ts_servidor ASC, uuid ASC"
            rows = conn.execute(sql, params).fetchall()
            cols = [
                "uuid", "tipo", "crotal", "operador", "device_id",
                "ts_dispositivo", "ts_servidor", "payload",
                "conciliado_en_access", "ts_conciliado", "crotal_asignado",
            ]
            resultado = []
            for r in rows:
                item = dict(zip(cols, r))
                if item.get("payload"):
                    try:
                        item["payload"] = json.loads(item["payload"])
                    except (TypeError, ValueError):
                        pass
                resultado.append(item)
            return resultado
        finally:
            conn.close()

    def marcar_conciliados(self, conciliados: List[Dict[str, Any]]) -> int:
        """Marca una lista de registros como conciliados en Access con timestamp y crotal oficial."""
        if not conciliados:
            return 0
        conn = self._conectar()
        try:
            actualizados = 0
            for item in conciliados:
                uuid = str(item.get("uuid") or "").strip()
                if not uuid:
                    continue
                crotal_asignado = item.get("crotal_asignado")
                cur = conn.execute(
                    "UPDATE campo_registros "
                    "SET conciliado_en_access = 1, ts_conciliado = datetime('now'), "
                    "crotal_asignado = COALESCE(?, crotal_asignado) "
                    "WHERE uuid = ?",
                    (crotal_asignado, uuid),
                )
                if cur.rowcount > 0:
                    actualizados += cur.rowcount
            if actualizados > 0:
                conn.commit()
            return actualizados
        finally:
            conn.close()
