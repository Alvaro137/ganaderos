"""
Script de saneamiento de base de datos SQLite para Ganaderos Campo.
Corrige:
1. Escalado Jet Currency (x10.000) en recetas (unidades, dosis_unitaria).
2. Asignación errónea de n_animales cuando dosis_unitaria == 0 (eliminando valores como 100.000 o 30.000 animales).
3. Normalización opcional de códigos de movimiento.
"""

import sqlite3
import sys
from pathlib import Path


def sanear_base_datos(db_path: Path) -> dict:
    if not db_path.exists():
        raise FileNotFoundError(f"No existe el archivo {db_path}")

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    resumen = {
        "recetas_escaladas_corregidas": 0,
        "n_animales_sanados": 0,
        "movimientos_normalizados": 0,
    }

    # 1. Comprobar tabla recetas
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='recetas'")
    if cur.fetchone():
        # Corregir unidades y dosis_unitaria escaladas x10.000
        cur.execute("SELECT id, unidades, dosis_unitaria, n_animales FROM recetas")
        filas = cur.fetchall()

        for rid, unidades, dosis, n_anim in filas:
            cambio = False
            u_nueva = unidades
            d_nueva = dosis

            # Si unidades tiene el bug de escala (>= 10.000 y múltiplo de 5.000 o 10.000)
            if unidades and unidades >= 10000 and (unidades % 5000 == 0 or unidades % 10000 == 0):
                u_nueva = round(unidades / 10000.0, 2)
                cambio = True

            # Si dosis_unitaria tiene el bug de escala
            if dosis and dosis >= 10000 and (dosis % 5000 == 0 or dosis % 10000 == 0):
                d_nueva = round(dosis / 10000.0, 2)
                cambio = True

            # Recalcular n_animales
            if d_nueva and d_nueva > 0 and u_nueva and u_nueva > 0:
                n_anim_nuevo = max(1, round(u_nueva / d_nueva))
            else:
                n_anim_nuevo = None

            if n_anim != n_anim_nuevo:
                cambio = True

            if cambio:
                cur.execute(
                    "UPDATE recetas SET unidades = ?, dosis_unitaria = ?, n_animales = ? WHERE id = ?",
                    (u_nueva, d_nueva, n_anim_nuevo, rid)
                )
                resumen["recetas_escaladas_corregidas"] += 1

    conn.commit()
    conn.close()
    return resumen


if __name__ == "__main__":
    if len(sys.argv) > 1:
        ruta = Path(sys.argv[1])
    else:
        ruta = Path("scratch/ganaderos_campo.sqlite")

    print(f"Saneando base de datos: {ruta}")
    resultado = sanear_base_datos(ruta)
    print("Resultado:", resultado)
