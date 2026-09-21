#!/usr/bin/env python3
"""Pipeline ETL: Extracción de bdlibro.mdb (Access) y carga en SQLite de campo."""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

# Añadir raíz al PYTHONPATH
PROJ_ROOT = Path(__file__).resolve().parents[1]
if str(PROJ_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJ_ROOT))

from src.infrastructure.access_reader import (  # noqa: E402
    conexion_access,
    detectar_python_32,
    detectar_ruta_bd,
    leer_animales,
    leer_compras_alimento,
    leer_explotaciones,
    leer_movimientos,
    leer_partos,
    leer_recetas_y_tratamientos,
    tiene_controlador_access,
)
from src.infrastructure.sqlite_builder import inicializar_bd_sqlite, optimizar_bd  # noqa: E402


def ejecutar_extraccion(source: Path, output: Path, password: str) -> None:
    print(f"[*] Conectando a Access: {source}")
    t0 = time.perf_counter()

    with conexion_access(source, password) as cur:
        print("[*] Leyendo animales...")
        animales = leer_animales(cur)

        print("[*] Leyendo partos e hijos...")
        partos = leer_partos(cur)

        print("[*] Leyendo movimientos...")
        movimientos = leer_movimientos(cur)

        print("[*] Leyendo explotaciones...")
        explotaciones = leer_explotaciones(cur)

        print("[*] Leyendo recetas sanitarias y tratamientos...")
        recetas = leer_recetas_y_tratamientos(cur)

        print("[*] Leyendo compras de alimento...")
        compras = leer_compras_alimento(cur)

    # Calcular total de partos por madre
    conteo_partos: dict[str, int] = {}
    for p in partos:
        madre = p.get("madre_crotal")
        if madre:
            conteo_partos[madre] = conteo_partos.get(madre, 0) + 1

    for a in animales:
        crotal = a.get("crotal")
        if crotal in conteo_partos:
            a["total_partos"] = conteo_partos[crotal]

    print(f"[*] Construyendo SQLite optimizado en: {output}")
    conn = inicializar_bd_sqlite(output)

    with conn:
        conn.executemany(
            """
            INSERT INTO animales (
                crotal, crotal_4, nombre, sexo, raza, fecha_nacimiento,
                madre_crotal, padre_crotal, estado, vida, corral,
                fecha_alta, fecha_ult_parto, total_partos
            ) VALUES (
                :crotal, :crotal_4, :nombre, :sexo, :raza, :fecha_nacimiento,
                :madre_crotal, :padre_crotal, :estado, :vida, :corral,
                :fecha_alta, :fecha_ult_parto, :total_partos
            )
            """,
            animales,
        )

        conn.executemany(
            """
            INSERT INTO partos (
                id, madre_crotal, fecha_parto, cria_crotal, cria_sexo, incidencias
            ) VALUES (
                :id, :madre_crotal, :fecha_parto, :cria_crotal, :cria_sexo, :incidencias
            )
            """,
            partos,
        )

        conn.executemany(
            """
            INSERT INTO movimientos (
                id, crotal, fecha, tipo, origen, destino, corral
            ) VALUES (
                :id, :crotal, :fecha, :tipo, :origen, :destino, :corral
            )
            """,
            movimientos,
        )

        conn.executemany(
            """
            INSERT INTO explotaciones (
                cea, tipo, nombre, finca, activa
            ) VALUES (
                :cea, :tipo, :nombre, :finca, :activa
            )
            """,
            explotaciones,
        )

        conn.executemany(
            """
            INSERT INTO recetas (
                id, fecha, receta, medicamento, unidades, dosis_unitaria,
                n_animales, veterinario, tiempo_carne, tiempo_leche, proveedor, cea
            ) VALUES (
                :id, :fecha, :receta, :medicamento, :unidades, :dosis_unitaria,
                :n_animales, :veterinario, :tiempo_carne, :tiempo_leche, :proveedor, :cea
            )
            """,
            recetas,
        )

        conn.executemany(
            """
            INSERT INTO compras_alimento (
                id, fecha, alimento, kg, importe, precio_kg, albaran, proveedor, pagado
            ) VALUES (
                :id, :fecha, :alimento, :kg, :importe, :precio_kg, :albaran, :proveedor, :pagado
            )
            """,
            compras,
        )

        # Metadatos del snapshot
        fecha_iso = time.strftime("%Y-%m-%d %H:%M:%S")
        conn.execute("INSERT OR REPLACE INTO meta VALUES ('fecha_exportacion', ?)", (fecha_iso,))
        conn.execute("INSERT OR REPLACE INTO meta VALUES ('origen', ?)", (str(source.name),))
        conn.execute("INSERT OR REPLACE INTO meta VALUES ('total_animales', ?)", (str(len(animales)),))

    optimizar_bd(conn)
    conn.close()

    t_total = time.perf_counter() - t0
    tam_mb = output.stat().st_size / (1024 * 1024)

    print("\n==================================================")
    print("  MIGRACION ETL FINALIZADA CON EXITO")
    print("==================================================")
    print(f"  Animales importados:     {len(animales):>6}")
    print(f"  Partos registrados:      {len(partos):>6}")
    print(f"  Movimientos históricos:  {len(movimientos):>6}")
    print(f"  Explotaciones (CEA):     {len(explotaciones):>6}")
    print(f"  Recetas sanitarias:      {len(recetas):>6}")
    print(f"  Compras de alimento:     {len(compras):>6}")
    print("--------------------------------------------------")
    print(f"  Tiempo de ejecución:     {t_total:.2f} s")
    print(f"  Tamaño SQLite generado:  {tam_mb:.2f} MB")
    print(f"  Fichero de salida:       {output.resolve()}")
    print("==================================================\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Pipeline ETL de bdlibro.mdb (Access) a SQLite local.")
    parser.add_argument("--source", type=Path, default=None, help="Ruta a bdlibro.mdb")
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJ_ROOT / "pwa" / "ganaderos_campo.sqlite",
        help="Ruta al fichero SQLite destino",
    )
    parser.add_argument("--password", type=str, default="sggnetpy04", help="Contraseña de bdlibro.mdb")
    args = parser.parse_args()

    source = args.source or detectar_ruta_bd()
    if not source.exists():
        print(f"[!] Error: Fichero origen no encontrado en '{source}'", file=sys.stderr)
        return 1

    # Comprobación de controlador ODBC de 32 bits vs 64 bits
    if not tiene_controlador_access():
        py32 = detectar_python_32()
        if py32:
            print(f"[*] Entorno 64-bit detectado. Delegando lectura a Python 32-bit ({py32})...")
            cmd = [str(py32), str(Path(__file__).resolve())]
            if args.source:
                cmd.extend(["--source", str(args.source)])
            cmd.extend(["--output", str(args.output)])
            if args.password:
                cmd.extend(["--password", args.password])
            return subprocess.call(cmd)
        else:
            print(
                "[!] Error: No se ha detectado el controlador ODBC de Microsoft Access en este Python.\n"
                "    En Windows 64-bit con bases de datos Access de 32 bits, ejecute este script con\n"
                "    un intérprete Python de 32 bits o configure la variable GANADEROS_PY32.",
                file=sys.stderr,
            )
            return 1

    ejecutar_extraccion(source, args.output, args.password)
    return 0


if __name__ == "__main__":
    sys.exit(main())
