#!/usr/bin/env python3
"""Script de verificación previa al push (Pre-Push Quality & Security Gate).

Ejecuta de forma secuencial y rápida (< 3 segundos):
1. Gitleaks (si está instalado en el sistema).
2. Ruff (análisis estático y estilo de código).
3. Pip-Audit (escaneo de vulnerabilidades en dependencias del proyecto).
"""

from __future__ import annotations

import shutil
import subprocess  # nosec B404
import sys
from pathlib import Path

# Soporte de codificación en consolas Windows (cp1252)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def ejecutar_comando(cmd: list[str], descripcion: str, cwd: Path | None = None) -> bool:
    """Ejecuta un comando en subproceso imprimiendo encabezado amigable."""
    print(f"\n[*] [pre-push] {descripcion}...")
    try:
        res = subprocess.run(  # nosec B603
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode == 0:
            if res.stdout.strip():
                print(f"   {res.stdout.strip()}")
            print(f"[OK] [pre-push] {descripcion}: COMPLETADO")
            return True
        else:
            print(f"[ERROR] [pre-push] {descripcion}: FALLÓ (código {res.returncode})")
            if res.stdout.strip():
                print(res.stdout.strip())
            if res.stderr.strip():
                print(res.stderr.strip())
            return False
    except Exception as e:
        print(f"[ERROR] [pre-push] Error ejecutando {cmd[0]}: {e}")
        return False


def main() -> int:
    root_dir = Path(__file__).resolve().parent.parent
    print("=" * 60)
    print(" GANADEROS CAMPO - PRE-PUSH SECURITY & QUALITY GATE")
    print("=" * 60)

    # 1. Gitleaks (Detección de secretos)
    gitleaks_bin = shutil.which("gitleaks")
    if gitleaks_bin:
        ok_gitleaks = ejecutar_comando(
            [gitleaks_bin, "protect", "--staged", "--verbose"],
            "1/3 Escaneo de secretos (Gitleaks)",
            cwd=root_dir,
        )
        if not ok_gitleaks:
            print("\n[ERROR] Push abortado: Gitleaks detectó posibles credenciales o secretos.")
            return 1
    else:
        print("\n[AVISO] [1/3 Gitleaks] Binario no encontrado en PATH local.")
        print("        (La verificación de secretos se ejecutará en GitHub Actions CI).")

    # 2. Ruff (Linter & Estilo)
    ok_ruff = ejecutar_comando(
        [sys.executable, "-m", "ruff", "check", "src/", "scripts/", "tests/"],
        "2/3 Calidad y estilo de código (Ruff)",
        cwd=root_dir,
    )
    if not ok_ruff:
        print("\n[ERROR] Push abortado: Corrige los errores de linter con 'python -m ruff check --fix'.")
        return 1

    # 3. Pip-Audit (Vulnerabilidades en dependencias del proyecto)
    ok_audit = ejecutar_comando(
        [sys.executable, "-m", "pip_audit", "."],
        "3/3 Escaneo de vulnerabilidades en dependencias (Pip-Audit)",
        cwd=root_dir,
    )
    if not ok_audit:
        print("\n[ERROR] Push abortado: Pip-Audit detectó dependencias con vulnerabilidades conocidas.")
        return 1

    print("\n" + "=" * 60)
    print(" [OK] TODOS LOS CONTROLES PRE-PUSH HAN SIDO SUPERADOS CON ÉXITO")
    print("=" * 60 + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
