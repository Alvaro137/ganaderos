#!/usr/bin/env python3
"""Pipeline de Conciliación Bidireccional: Registros de Campo (OPi/Móvil) -> Access (bdlibro.mdb).

Permite integrar de forma segura, transaccional y auditable los partos y nacimientos
registrados por los ganaderos en el campo (Offline-First en la PWA) hacia la base de
datos histórica de escritorio de Ganaderos 10 (Microsoft Access Jet 32-bit).

Flujo de Operación:
1. Autenticación con la Orange Pi (o hub local) vía token HMAC.
2. Consulta de eventos pendientes (GET /api/sync/pendientes?tipo=parto).
3. Backup previo timestamped de bdlibro.mdb (backups/bdlibro_backup_YYYYMMDD_HHMMSS.mdb).
4. Bloqueo atómico con FileLock (bdlibro.lock).
5. Asignación secuencial de crotales disponibles desde la tabla 'Crotales'.
6. Inserción transaccional en Access (Animal -> Movimiento tipo N -> Parto -> Update Madre -> Delete Crotal).
7. Confirmación a la Orange Pi (POST /api/sync/conciliado).
8. Re-exportación del censo a SQLite y subida al servidor (POST /api/sync/import).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Asegurar importación del proyecto
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.infrastructure.access_reader import (  # noqa: E402
    FileLock,
    conn_str_for,
    detectar_python_32,
    detectar_ruta_bd,
    tiene_controlador_access,
)
from src.infrastructure.backup_vault import (  # noqa: E402
    DEFAULT_VAULT_REMOTE,
    guardar_snapshot_en_vault,
)

logger = logging.getLogger("ganaderos.sync_access_merge")


class AccessReconciliationError(Exception):
    """Error fatal durante el proceso de conciliación con Access."""


def autenticar_hub(api_url: str, password: str, user_id: str = "usr_admin") -> str:
    """Obtiene un token de autenticación del hub."""
    url = f"{api_url.rstrip('/')}/api/auth/login"
    payload = json.dumps({"password": password, "user_id": user_id}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "GanaderosPC/2.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            token = data.get("token")
            if not token:
                raise AccessReconciliationError(f"Respuesta de login sin token: {data}")
            return token
    except urllib.error.HTTPError as e:
        raise AccessReconciliationError(f"Fallo de autenticación en {url} (HTTP {e.code}): {e.read().decode('utf-8', 'ignore')}")
    except Exception as e:
        raise AccessReconciliationError(f"No se pudo conectar con el hub en {url}: {e}")


def obtener_pendientes(api_url: str, token: str, tipo: Optional[str] = None) -> List[Dict[str, Any]]:
    """Descarga los registros de campo no conciliados de la Orange Pi."""
    url = f"{api_url.rstrip('/')}/api/sync/pendientes"
    if tipo:
        url += f"?tipo={urllib.parse.quote(tipo)}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "User-Agent": "GanaderosPC/2.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("pendientes", [])
    except Exception as e:
        raise AccessReconciliationError(f"Error consultando registros pendientes en {url}: {e}")


def crear_backup(db_path: Path) -> Path:
    """Crea una copia de seguridad timestamped de bdlibro.mdb en subcarpeta backups/."""
    backups_dir = db_path.parent / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = backups_dir / f"{db_path.stem}_backup_{ts}.mdb"
    shutil.copy2(db_path, backup_path)
    return backup_path


def conciliar_partos_en_access(
    db_path: Path,
    password: str,
    partos: List[Dict[str, Any]],
    dry_run: bool = False,
) -> List[Dict[str, Any]]:
    """Aplica atómicamente los partos en Access consumiendo crotales oficiales.

    Devuelve la lista de registros conciliados con su crotal asignado.
    """
    try:
        import pyodbc
    except ImportError:
        pyodbc = None

    if pyodbc is None:
        raise AccessReconciliationError("El controlador pyodbc no está disponible en este entorno.")

    conciliados: List[Dict[str, Any]] = []
    if not partos:
        return conciliados

    lock_file = db_path.parent / f"{db_path.stem}.lock"
    with FileLock(lock_file):
        conn_str = conn_str_for(db_path, password)
        conn = pyodbc.connect(conn_str, autocommit=False)
        cur = conn.cursor()

        try:
            # 1. Obtener lista de crotales disponibles en la explotación
            cur.execute("SELECT crotal, cea FROM Crotales ORDER BY crotal ASC")
            crotales_libres = [str(r[0]).strip() for r in cur.fetchall() if r[0]]
            indice_crotal = 0

            for p in partos:
                uuid = p["uuid"]
                madre_crotal = p.get("crotal")
                payload = p.get("payload") or {}
                fecha_parto_str = payload.get("fecha_parto") or p.get("ts_dispositivo") or datetime.now().strftime("%Y-%m-%d")
                try:
                    fecha_parto = datetime.strptime(fecha_parto_str[:10], "%Y-%m-%d")
                except ValueError:
                    fecha_parto = datetime.now()

                cria_crotal_solicitado = (payload.get("cria_crotal") or "").strip()
                cria_sexo_raw = (payload.get("cria_sexo") or "H").strip().upper()
                cria_sexo_cod = "01" if cria_sexo_raw in ("M", "01", "MACHO") else "02"

                # 2. Localizar a la madre en Animal
                cur.execute(
                    "SELECT crotal, raza, corral, pertenencia, ubicacion, f_ult_parto FROM Animal WHERE crotal = ?",
                    (madre_crotal,),
                )
                madre_row = cur.fetchone()
                if not madre_row:
                    logger.warning(f"Madre con crotal {madre_crotal} no encontrada en Animal. Omitiendo uuid {uuid}.")
                    continue

                raza_madre = madre_row[1] or "0000"
                corral_madre = madre_row[2] or ""
                pertenencia = madre_row[3] or "ES371261100121"
                ubicacion = madre_row[4] or "ES371261100121"
                f_ult_parto_ant = madre_row[5]

                # 3. Asignar crotal oficial
                crotal_asignado = None
                if cria_crotal_solicitado and cria_crotal_solicitado in crotales_libres:
                    crotal_asignado = cria_crotal_solicitado
                    crotales_libres.remove(cria_crotal_solicitado)
                else:
                    if indice_crotal >= len(crotales_libres):
                        raise AccessReconciliationError(
                            "No quedan crotales en la tabla Crotales de bdlibro.mdb. "
                            "Introduce una nueva serie oficial en Ganaderos 10 antes de continuar."
                        )
                    crotal_asignado = crotales_libres[indice_crotal]
                    indice_crotal += 1

                # 4. Inserción en Animal (Debe insertarse ANTES de Movimiento por integridad referencial)
                cur.execute(
                    """
                    INSERT INTO Animal (
                        crotal, fnac, raza, sexo, madre, pertenencia, fpertenencia,
                        ubicacion, corral, estado, vida
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'A', False)
                    """,
                    (
                        crotal_asignado,
                        fecha_parto,
                        raza_madre,
                        cria_sexo_cod,
                        madre_crotal,
                        pertenencia,
                        fecha_parto,
                        ubicacion,
                        corral_madre,
                    ),
                )

                # 5. Inserción en Movimiento (Tipo 'N' - Nacimiento)
                cur.execute(
                    """
                    INSERT INTO Movimiento (
                        crotal, origen, destino, corral, fecha, tipo, sexo, registrado
                    ) VALUES (?, ?, ?, ?, ?, 'N', ?, False)
                    """,
                    (
                        crotal_asignado,
                        pertenencia,
                        ubicacion,
                        corral_madre,
                        fecha_parto,
                        cria_sexo_cod,
                    ),
                )

                # 6. Obtener cod_movi generado y registrar en Parto
                cur.execute("SELECT @@IDENTITY")
                cod_movi = cur.fetchone()[0]

                cur.execute(
                    """
                    INSERT INTO Parto (
                        cod_movi, sexoanterior, fpartoanterior, registrado
                    ) VALUES (?, '04', ?, False)
                    """,
                    (cod_movi, f_ult_parto_ant),
                )

                # 7. Actualizar fecha de último parto de la madre
                cur.execute(
                    "UPDATE Animal SET f_ult_parto = ? WHERE crotal = ?",
                    (fecha_parto, madre_crotal),
                )

                # 8. Consumir crotal de la tabla Crotales
                cur.execute("DELETE FROM Crotales WHERE crotal = ?", (crotal_asignado,))

                conciliados.append({
                    "uuid": uuid,
                    "crotal_asignado": crotal_asignado,
                    "madre_crotal": madre_crotal,
                    "fecha_parto": fecha_parto.strftime("%Y-%m-%d"),
                })

            if dry_run:
                conn.rollback()
                logger.info(f"[Dry-Run] Simulada conciliación de {len(conciliados)} partos. Rollback aplicado.")
            else:
                conn.commit()
                logger.info(f"Conciliación de {len(conciliados)} partos confirmada en Access con éxito.")

        except Exception as e:
            conn.rollback()
            raise AccessReconciliationError(f"Error procesando partos en Access: {e}") from e
        finally:
            conn.close()

    return conciliados


def notificar_conciliacion(
    api_url: str,
    token: str,
    conciliados: List[Dict[str, Any]],
) -> int:
    """Notifica al hub los registros de campo que ya han sido conciliados en Access."""
    if not conciliados:
        return 0
    url = f"{api_url.rstrip('/')}/api/sync/conciliado"
    payload_data = {
        "conciliados": [
            {"uuid": c["uuid"], "crotal_asignado": c.get("crotal_asignado")}
            for c in conciliados
        ]
    }
    payload = json.dumps(payload_data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "GanaderosPC/2.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("actualizados", 0)
    except Exception as e:
        raise AccessReconciliationError(f"Error notificando registros conciliados al hub: {e}")


def exportar_y_subir_censo(
    db_path: Path,
    api_url: str,
    token: str,
    password: str,
) -> Dict[str, Any]:
    """Ejecuta el pipeline ETL de extracción y sube la nueva base de datos al hub."""
    from scripts.import_legacy import ejecutar_extraccion

    tmp_sqlite = db_path.parent / "censo_export_temp.sqlite"
    try:
        if tmp_sqlite.exists():
            tmp_sqlite.unlink()

        print(f"[*] Exportando censo actualizado desde Access a SQLite: {tmp_sqlite}")
        ejecutar_extraccion(db_path, tmp_sqlite, password)

        url = f"{api_url.rstrip('/')}/api/sync/import"
        print(f"[*] Subiendo censo consolidado al hub: {url}")

        contenido = tmp_sqlite.read_bytes()
        boundary = "----GanaderosBoundary" + hex(int(time.time()))[2:]
        crlf = "\r\n"

        partes = [
            f"--{boundary}",
            'Content-Disposition: form-data; name="file"; filename="ganaderos_campo.sqlite"',
            "Content-Type: application/octet-stream",
            "",
        ]
        cuerpo = (crlf.join(partes) + crlf).encode("utf-8") + contenido + (crlf + f"--{boundary}--" + crlf).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=cuerpo,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(len(cuerpo)),
                "User-Agent": "GanaderosPC/2.0",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data
    finally:
        if tmp_sqlite.exists():
            try:
                tmp_sqlite.unlink()
            except OSError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Conciliación bidireccional entre la PWA/Hub y Access bdlibro.mdb.")
    parser.add_argument("--source", type=Path, default=None, help="Ruta al fichero bdlibro.mdb")
    parser.add_argument("--api-url", type=str, default=os.environ.get("GANADEROS_API_URL", "http://192.168.0.137:8010"), help="URL base del servidor hub")
    parser.add_argument("--password", type=str, default=os.environ.get("GANADEROS_DB_PASSWORD", "sggnetpy04"), help="Contraseña de bdlibro.mdb")
    parser.add_argument("--pwa-password", type=str, default=os.environ.get("PWA_PASSWORD", "ganaderos"), help="Contraseña compartida de la PWA")
    parser.add_argument("--dry-run", action="store_true", help="Simula la operación sin persistir en Access ni en el servidor")
    parser.add_argument("--skip-export", action="store_true", help="Omite la re-exportación y subida del censo consolidado")
    parser.add_argument("--vault-dir", type=Path, default=None, help="Directorio del repositorio vault de backups")
    parser.add_argument("--vault-remote", type=str, default=DEFAULT_VAULT_REMOTE, help="URL del remoto Git para la bóveda de datos")
    parser.add_argument("--no-vault", action="store_true", help="Desactiva el versionado automático en la bóveda de Git")
    parser.add_argument("--no-vault-push", action="store_true", help="Crea el snapshot en el vault local pero no hace push a GitHub")
    args = parser.parse_args()

    source = args.source or detectar_ruta_bd()
    if not source.exists():
        print(f"[!] Error: Fichero de base de datos Access no encontrado en '{source}'", file=sys.stderr)
        return 1

    # Delegación automática a Python 32-bit si no hay controlador ODBC en el intérprete actual
    if not tiene_controlador_access():
        py32 = detectar_python_32()
        if py32:
            print(f"[*] Entorno 64-bit detectado. Delegando ejecución a Python 32-bit ({py32})...")
            cmd = [str(py32), str(Path(__file__).resolve())]
            if args.source:
                cmd.extend(["--source", str(args.source)])
            cmd.extend(["--api-url", str(args.api_url)])
            cmd.extend(["--password", str(args.password)])
            cmd.extend(["--pwa-password", str(args.pwa_password)])
            if args.dry_run:
                cmd.append("--dry-run")
            if args.skip_export:
                cmd.append("--skip-export")
            if args.vault_dir:
                cmd.extend(["--vault-dir", str(args.vault_dir)])
            if args.vault_remote:
                cmd.extend(["--vault-remote", str(args.vault_remote)])
            if args.no_vault:
                cmd.append("--no-vault")
            if args.no_vault_push:
                cmd.append("--no-vault-push")
            return subprocess.call(cmd)
        else:
            print(
                "[!] Error: No se ha detectado el controlador ODBC de Microsoft Access en este Python.\n"
                "    Ejecute este script con un intérprete Python de 32 bits o configure GANADEROS_PY32.",
                file=sys.stderr,
            )
            return 1

    print("\n==================================================")
    print("  CONCILIACION ACCESS bdlibro.mdb <-> HUB CAMPO")
    print("==================================================")
    print(f"  Base de datos Access: {source}")
    print(f"  Hub remoto:           {args.api_url}")
    print(f"  Modo simulación:      {'ACTIVADO (dry-run)' if args.dry_run else 'NO (escritura real)'}")
    print(f"  Git Backup Vault:     {'DESACTIVADO' if args.no_vault else 'ACTIVADO'}")
    print("--------------------------------------------------")

    try:
        # 1. Autenticación
        print("[*] 1/6 Autenticando con el hub...")
        token = autenticar_hub(args.api_url, args.pwa_password)

        # 2. Descargar pendientes
        print("[*] 2/6 Comprobando eventos pendientes en el hub...")
        partos_pendientes = obtener_pendientes(args.api_url, token, tipo="parto")
        print(f"    Partos pendientes de conciliar: {len(partos_pendientes)}")

        if not partos_pendientes:
            print("\n[+] Todo al día: no hay partos pendientes de conciliar.")
            return 0

        # 3. Backup
        if not args.dry_run:
            print("[*] 3/6 Creando copia de seguridad de bdlibro.mdb...")
            backup_file = crear_backup(source)
            print(f"    Backup creado en: {backup_file}")
        else:
            print("[*] 3/6 Backup omitido (modo dry-run)")

        # 4. Conciliación en Access
        print("[*] 4/6 Aplicando partos en Access con asignación de crotales...")
        conciliados = conciliar_partos_en_access(source, args.password, partos_pendientes, dry_run=args.dry_run)

        for c in conciliados:
            print(f"    -> Vaca {c['madre_crotal']}: Cría asignada {c['crotal_asignado']} (Fecha {c['fecha_parto']})")

        if not args.dry_run:
            print("[*] Notificando conciliación al servidor hub...")
            actualizados = notificar_conciliacion(args.api_url, token, conciliados)
            print(f"    Registros confirmados en el servidor: {actualizados}")

            # 5. Re-exportación y subida
            if not args.skip_export:
                print("[*] 5/6 Re-exportando y subiendo censo consolidado al hub...")
                resultado_import = exportar_y_subir_censo(source, args.api_url, token, args.password)
                print(f"    Nuevo censo activo en el hub. Epoch: {resultado_import.get('epoch')}")
            else:
                print("[*] 5/6 Exportación omitida por flag --skip-export.")

            # 6. Snapshot inmutable en Git Vault
            if not args.no_vault:
                print("[*] 6/6 Guardando snapshot inmutable en Git Vault...")
                try:
                    crotales_txt = ", ".join([c["crotal_asignado"] for c in conciliados[:5]])
                    if len(conciliados) > 5:
                        crotales_txt += f" (+{len(conciliados) - 5} más)"
                    msg_vault = f"backup: conciliacion de {len(conciliados)} parto(s) - terneros: {crotales_txt}"

                    censo_sqlite = ROOT_DIR / "pwa" / "ganaderos_campo.sqlite"
                    res_vault = guardar_snapshot_en_vault(
                        vault_dir=args.vault_dir,
                        access_path=source,
                        sqlite_path=censo_sqlite if censo_sqlite.exists() else None,
                        mensaje=msg_vault,
                        remote_url=args.vault_remote,
                        push=not args.no_vault_push,
                    )
                    c_hash = res_vault.get("commit") or "Sin cambios"
                    print(f"    Vault snapshot: {c_hash} ({res_vault.get('message')})")
                except Exception as e_vault:
                    logger.warning(f"Advertencia guardando en Git Vault: {e_vault}")
                    print(f"    ⚠ Advertencia en Git Vault: {e_vault}")
        else:
            print("[*] Modo dry-run finalizado sin modificar Access ni el hub.")

        print("\n==================================================")
        print("  PROCESO DE CONCILIACION COMPLETADO")
        print("==================================================\n")
        return 0

    except AccessReconciliationError as e:
        print(f"\n[!] ERROR EN CONCILIACION: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        logger.exception("Error inesperado en conciliación:")
        print(f"\n[!] ERROR INESPERADO: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
