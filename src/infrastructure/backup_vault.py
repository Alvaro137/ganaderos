"""Infraestructura de Versionado Inmutable de Base de Datos (Git Vault).

Gestiona la persistencia segura, versionada y offsite de las bases de datos
de la explotación (Access bdlibro.mdb, SQLite ganaderos_campo.sqlite y volcado SQL plano)
en un repositorio Git privado aislado (ganaderos-backup-vault).

Garantías:
1. Inmutabilidad criptográfica mediante commits SHA en Git.
2. Diffs legibles en texto plano mediante volcados SQL automáticos (sqlite3 iterdump).
3. Aislamiento total: no contamina el repositorio de código ni ralentiza la CI.
"""
from __future__ import annotations

import logging
import os
import shutil
import sqlite3
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("ganaderos.backup_vault")

DEFAULT_VAULT_REMOTE = os.environ.get(
    "GANADEROS_VAULT_REMOTE",
    "https://github.com/Alvaro137/ganaderos-backup-vault.git",
)


def _ejecutar_git(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    """Ejecuta un comando de Git en el directorio especificado."""
    return subprocess.run(
        ["git"] + cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=False,
    )


def resolver_directorio_vault(vault_dir: Optional[Path] = None) -> Path:
    """Resuelve la ruta local para el repositorio vault de backups."""
    if vault_dir:
        return Path(vault_dir).resolve()

    env_dir = os.environ.get("GANADEROS_VAULT_DIR")
    if env_dir:
        return Path(env_dir).resolve()

    # Por defecto: directorio hermano al repositorio principal
    repo_root = Path(__file__).resolve().parents[2]
    candidato_hermano = repo_root.parent / "ganaderos-backup-vault"
    return candidato_hermano.resolve()


def asegurar_repositorio_vault(vault_dir: Path, remote_url: str = DEFAULT_VAULT_REMOTE) -> Path:
    """Asegura que el directorio exista y esté inicializado como repositorio Git conectado al remoto."""
    vault_dir = Path(vault_dir).resolve()
    git_dir = vault_dir / ".git"

    if git_dir.exists():
        return vault_dir

    vault_dir.mkdir(parents=True, exist_ok=True)

    # Intentar clonar si el directorio está vacío
    contenido = list(vault_dir.iterdir())
    if not contenido:
        logger.info(f"[GitVault] Clonando repositorio vault desde {remote_url}...")
        res_clone = subprocess.run(
            ["git", "clone", remote_url, str(vault_dir)],
            capture_output=True,
            text=True,
            check=False,
        )
        if res_clone.returncode == 0 and git_dir.exists():
            return vault_dir

    # Si el clone falla (repositorio vacío o nuevo), inicializar localmente
    logger.info(f"[GitVault] Inicializando repositorio Git en {vault_dir}...")
    _ejecutar_git(["init", "-b", "main"], vault_dir)
    _ejecutar_git(["remote", "remove", "origin"], vault_dir)
    _ejecutar_git(["remote", "add", "origin", remote_url], vault_dir)

    return vault_dir


def generar_sql_dump(sqlite_path: Path, output_sql_path: Path) -> None:
    """Genera un volcado SQL determinista en texto plano a partir de una BD SQLite."""
    sqlite_path = Path(sqlite_path)
    output_sql_path = Path(output_sql_path)
    output_sql_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(f"file:{sqlite_path.resolve()}?mode=ro", uri=True)
    try:
        with open(output_sql_path, "w", encoding="utf-8") as f:
            for linea in conn.iterdump():
                f.write(f"{linea}\n")
    finally:
        conn.close()


def _crear_readme_si_falta(vault_dir: Path) -> None:
    readme = vault_dir / "README.md"
    if not readme.exists():
        contenido = (
            "# Ganaderos Backup Vault — Bóveda Inmutable de Datos\n\n"
            "Este repositorio almacena el histórico versionado e inmutable de las bases de datos "
            "de la explotación ganadera.\n\n"
            "## Estructura\n"
            "- `access/bdlibro.mdb`: Binario maestro de Ganaderos 10 (Microsoft Access Jet).\n"
            "- `sqlite/ganaderos_campo.sqlite`: Binario relacional consolidado para la PWA de campo.\n"
            "- `dumps/censo_dump.sql`: Volcado completo en texto plano SQL (permite auditoría de diffs entre versiones).\n\n"
            "## Recuperación ante desastre\n"
            "Para restaurar cualquier versión histórica:\n"
            "```bash\n"
            "git log --oneline\n"
            "git checkout <commit_sha> -- access/bdlibro.mdb\n"
            "```\n"
        )
        readme.write_text(contenido, encoding="utf-8")


def guardar_snapshot_en_vault(
    vault_dir: Optional[Path] = None,
    access_path: Optional[Path] = None,
    sqlite_path: Optional[Path] = None,
    mensaje: str = "backup: snapshot automático de censo",
    remote_url: str = DEFAULT_VAULT_REMOTE,
    push: bool = True,
) -> Dict[str, Any]:
    """Copia las bases de datos al vault, genera dump SQL, crea commit y hace push al remoto."""
    v_dir = resolver_directorio_vault(vault_dir)
    asegurar_repositorio_vault(v_dir, remote_url=remote_url)

    dir_access = v_dir / "access"
    dir_sqlite = v_dir / "sqlite"
    dir_dumps = v_dir / "dumps"
    dir_access.mkdir(parents=True, exist_ok=True)
    dir_sqlite.mkdir(parents=True, exist_ok=True)
    dir_dumps.mkdir(parents=True, exist_ok=True)

    archivos_actualizados = []

    # 1. Copiar Access MDB
    if access_path and Path(access_path).exists():
        dest_mdb = dir_access / "bdlibro.mdb"
        shutil.copy2(access_path, dest_mdb)
        archivos_actualizados.append("access/bdlibro.mdb")

    # 2. Copiar SQLite y generar Dump en texto plano
    if sqlite_path and Path(sqlite_path).exists():
        dest_sqlite = dir_sqlite / "ganaderos_campo.sqlite"
        shutil.copy2(sqlite_path, dest_sqlite)
        archivos_actualizados.append("sqlite/ganaderos_campo.sqlite")

        dest_dump = dir_dumps / "censo_dump.sql"
        generar_sql_dump(Path(sqlite_path), dest_dump)
        archivos_actualizados.append("dumps/censo_dump.sql")

    _crear_readme_si_falta(v_dir)

    # 3. Stage en Git
    _ejecutar_git(["add", "access", "sqlite", "dumps", "README.md"], v_dir)

    # 4. Verificar si hay cambios
    status_res = _ejecutar_git(["status", "--porcelain"], v_dir)
    if not status_res.stdout.strip():
        logger.info("[GitVault] Sin cambios respecto al último commit.")
        return {
            "ok": True,
            "cambios": False,
            "commit": None,
            "message": "Las bases de datos no presentan cambios respecto al último backup.",
            "vault_dir": str(v_dir),
        }

    # 5. Commit
    commit_res = _ejecutar_git(["commit", "-m", mensaje], v_dir)
    if commit_res.returncode != 0:
        raise RuntimeError(f"Fallo al crear commit en el vault: {commit_res.stderr}")

    rev_res = _ejecutar_git(["rev-parse", "HEAD"], v_dir)
    commit_hash = rev_res.stdout.strip()[:10]
    logger.info(f"[GitVault] Commit creado con éxito: {commit_hash} - {mensaje}")

    # 6. Push
    pushed = False
    push_msg = "Push no solicitado"
    if push:
        # Intentar push a main
        res_push = _ejecutar_git(["push", "-u", "origin", "main"], v_dir)
        if res_push.returncode != 0:
            # Reintento con pull --rebase por si hay commits remotos concurrentes
            _ejecutar_git(["pull", "--rebase", "origin", "main"], v_dir)
            res_push = _ejecutar_git(["push", "-u", "origin", "main"], v_dir)

        pushed = res_push.returncode == 0
        push_msg = "Sincronizado con GitHub" if pushed else f"Error en push: {res_push.stderr.strip()}"
        if not pushed:
            logger.warning(f"[GitVault] No se pudo hacer push al remoto: {res_push.stderr}")

    return {
        "ok": True,
        "cambios": True,
        "commit": commit_hash,
        "pushed": pushed,
        "message": f"Snapshot guardado ({commit_hash}). {push_msg}",
        "vault_dir": str(v_dir),
        "archivos": archivos_actualizados,
    }
