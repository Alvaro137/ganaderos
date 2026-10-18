#!/usr/bin/env python3
"""Script de conciliación y sincronización de censo y movimientos con MoGa oficial.

Uso:
  python scripts/reconciliar_moga.py --dry-run
  python scripts/reconciliar_moga.py --apply --db /ruta/a/ganaderos_campo.sqlite
"""

import argparse
import os
import sqlite3
import sys

# Compatibilidad de codificación en consola Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Asegurar path del proyecto
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from src.application.moga_conciliator import (
    aplicar_conciliacion_moga,
    auditar_y_conciliar_moga,
)


def main():
    parser = argparse.ArgumentParser(description="Conciliador oficial de censo y movimientos MoGa.")
    parser.add_argument("--db", default=None, help="Ruta al archivo SQLite de producción.")
    parser.add_argument(
        "--dir121", default="Example-data/121", help="Directorio con ficheros MoGa de CEA 121."
    )
    parser.add_argument(
        "--dir122", default="Example-data/122", help="Directorio con ficheros MoGa de CEA 122."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Aplica los cambios en la base de datos de forma persistente.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Solo genera el informe de discordancias sin modificar la base de datos.",
    )

    args = parser.parse_args()

    db_path = args.db
    if not db_path:
        for candidate in [
            "pwa/ganaderos_campo.sqlite",
            "scratch/ganaderos_campo.sqlite",
            "pwa/ganaderos_demo.sqlite",
        ]:
            if os.path.exists(candidate):
                db_path = candidate
                break

    if not db_path or not os.path.exists(db_path):
        print(f"ERROR: No se encontró la base de datos en '{db_path}'.")
        sys.exit(1)

    if not os.path.exists(args.dir121) or not os.path.exists(args.dir122):
        print(f"ERROR: Directorios MoGa no encontrados ('{args.dir121}' o '{args.dir122}').")
        sys.exit(1)

    print("=" * 65)
    print(" AUDITORÍA Y CONCILIACIÓN OFICIAL MOGA")
    print("=" * 65)
    print(f"Base de datos: {db_path}")
    print(f"Ficheros 121:  {args.dir121}")
    print(f"Ficheros 122:  {args.dir122}")
    print(f"Modo:          {'APLICAR CAMBIOS' if args.apply else 'AUDITORÍA / DRY-RUN'}")
    print("-" * 65)

    conn = sqlite3.connect(db_path)
    try:
        auditoria = auditar_y_conciliar_moga(conn, args.dir121, args.dir122)
        res = auditoria["resumen"]

        print("\n[1] RESUMEN DE CENSO:")
        print(
            f"  • Censo Oficial MoGa:         {res['total_moga']} animales (121: {res['total_moga_121']} | 122: {res['total_moga_122']})"
        )
        print(f"  • Animales Activos en BD:     {res['total_db_activos']} animales")
        print(f"  • Coincidencias exactas:      {res['coincidentes_exactos']} animales")
        print(
            f"  • Coincidencias por sufijo:   {res['coincidentes_por_sufijo_10']} de {res['total_moga']} animales"
        )

        print("\n[2] DISCORDANCIAS DETECTADAS:")
        print(f"  ⚠️  Errores de dígito de control: {res['errores_digito_control']} crotales")
        print(f"  ⚠️  Muertes en MoGa no registradas: {res['muertes_detectadas_moga']} animales")
        print(f"  ⚠️  Altas oficiales pendientes en BD: {res['altas_nuevas_moga']} animales")
        print(f"  ⚠️  Activos en BD ausentes en MoGa: {res['activos_locales_huerfanos']} animales")

        if auditoria["errores_digito_control"]:
            print(
                f"\n[3] DETALLE ERRORES DE DÍGITO DE CONTROL ({len(auditoria['errores_digito_control'])}):"
            )
            for e in auditoria["errores_digito_control"][:8]:
                print(
                    f"    - {e['crotal_db']} (BD) -> {e['crotal_moga']} (MoGa Oficial, 4: {e['crotal_4']}, Corral: {e['corral']})"
                )
            if len(auditoria["errores_digito_control"]) > 8:
                print(f"    ... y {len(auditoria['errores_digito_control']) - 8} más.")

        if auditoria["muertes_detectadas"]:
            print("\n[4] ANIMALES FALLECIDOS EN MOGA (PENDIENTES DE BAJA EN BD):")
            for m in auditoria["muertes_detectadas"]:
                print(
                    f"    - {m['crotal_oficial']} (4: {m['crotal_4']}) -> Muerte: {m['fecha_muerte']} (Solicitud: {m.get('numero_solicitud')})"
                )

        if auditoria["altas_nuevas"]:
            print("\n[5] ALTAS NUEVAS EN MOGA (PENDIENTES DE ALTA EN BD):")
            for a in auditoria["altas_nuevas"]:
                print(
                    f"    - {a['crotal_moga']} (4: {a.get('crotal_4')}, Raza: {a.get('raza')}, Sexo: {a.get('sexo')}, Nac: {a.get('fecha_nacimiento')})"
                )

        print("\n[6] DATOS SANITARIOS Y ELECTRÓNICOS EN MOGA:")
        print(
            f"  • Tuberculosis (Campaña Saneamiento): {res['cobertura_tuberculosis']} / {res['total_moga']} animales"
        )
        print(
            f"  • Lengua Azul (Vacunación Oficial):   {res['cobertura_lengua_azul']} / {res['total_moga']} animales"
        )
        print(
            f"  • Crotal Electrónico (RFID):          {res['cobertura_rfid_electronico']} / {res['total_moga']} animales"
        )

        print("\n[7] MOVIMIENTOS OFICIALES REGISTRADOS:")
        print(f"  • Movimientos CEA 121 (Dehesa):       {res['movimientos_121']}")
        print(f"  • Movimientos CEA 122 (Cebadero):     {res['movimientos_122']}")

        if args.apply:
            if "ganaderos_demo.sqlite" in db_path:
                print(
                    "\n[AVISO] No se aplica sobre la base demo para proteger la inmutabilidad de los tests."
                )
                return

            print("\n" + "=" * 65)
            print(" APLICANDO CONCILIACIÓN OFICIAL MOGA EN LA BASE DE DATOS...")
            print("=" * 65)
            res_aplicar = aplicar_conciliacion_moga(conn, args.dir121, args.dir122)
            print(f"  ✓ Crotales corregidos en cascada: {res_aplicar['corregidos_crotal']}")
            print(f"  ✓ Bajas por muerte aplicadas:     {res_aplicar['dados_de_baja']}")
            print(f"  ✓ Nuevas altas incorporadas:      {res_aplicar['dados_de_alta']}")
            print(f"  ✓ Animales con datos actualizados:{res_aplicar['actualizados_oficiales']}")
            print(
                f"  ✓ Censo oficial resultante:       {res_aplicar['censo_oficial_moga']} animales"
            )
            print("\n[OK] Base de datos sincronizada con éxito con el censo oficial de MoGa.")
        else:
            print("\nPara aplicar las correcciones oficiales en la base de datos ejecuta:")
            print(f"  python scripts/reconciliar_moga.py --apply --db {db_path}")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
