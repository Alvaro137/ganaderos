#!/usr/bin/env python3
"""Generador de base de datos SQLite sintética y anonimizada para Ganaderos Campo.

Crea un conjunto de datos realista de vacuno de carne en extensivo (razas autóctonas,
crotales oficiales de 14 dígitos, histórico de partos, trazabilidad entre explotaciones,
recetas veterinarias con periodos de supresión y compras de pienso).
"""

import argparse
import random
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "pwa" / "ganaderos_demo.sqlite"

RAZAS = ["MORUCHA", "CHAROLESA", "LIMUSINA", "CONJUNTO MESTIZO", "RETINTA"]
CORRALES = ["DUEÑA", "ESPADAÑA", "RIVERA", "LA VEGA", "CEBADERO"]
MEDICAMENTOS = [
    ("DRAXXIN 100 MG/ML", 49, 10.0),
    ("BETAMOX L.A.", 28, 20.0),
    ("DEXAMETASONA 2 MG/ML", 8, 5.0),
    ("FLUNIXIN MEGLUMINE", 4, 15.0),
    ("CEFTIOFUR 50 MG/ML", 2, 8.0),
    ("COMPLEJO VITAMÍNICO B", 0, 10.0),
]
ALIMENTOS = [
    ("PIENSO INICIACIÓN TERNEROS T-1", 0.42),
    ("PIENSO CRECIMIENTO T-2", 0.38),
    ("PIENSO CEBO FINAL T-3", 0.35),
    ("RASTROJERA Y TACO CAMPO", 0.28),
    ("CEBADA MOLIDA EXTRA", 0.24),
]
VETERINARIOS = [
    "DR. CARLOS SÁNCHEZ (COL. 37/1042)",
    "DRA. MARTA HERNÁNDEZ (COL. 37/0891)",
    "DR. JAVIER MARTÍN (COL. 37/1205)",
]
PROVEEDORES = ["COOPERATIVA AGROPECUARIA", "NUTRICIÓN GANADERA SL", "INTE CAMPO SL"]


def crear_esquema(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.executescript("""
    DROP TABLE IF EXISTS animales;
    CREATE TABLE animales (
        crotal TEXT PRIMARY KEY,
        crotal_4 TEXT NOT NULL,
        nombre TEXT,
        sexo TEXT,
        raza TEXT,
        fecha_nacimiento TEXT,
        madre_crotal TEXT,
        padre_crotal TEXT,
        estado TEXT NOT NULL,
        vida INTEGER NOT NULL,
        corral TEXT,
        fecha_alta TEXT,
        fecha_ult_parto TEXT,
        total_partos INTEGER DEFAULT 0
    );

    DROP TABLE IF EXISTS partos;
    CREATE TABLE partos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        madre_crotal TEXT NOT NULL,
        fecha_parto TEXT,
        cria_crotal TEXT,
        cria_sexo TEXT,
        incidencias TEXT
    );

    DROP TABLE IF EXISTS movimientos;
    CREATE TABLE movimientos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        crotal TEXT NOT NULL,
        fecha TEXT,
        tipo TEXT,
        origen TEXT,
        destino TEXT,
        corral TEXT
    );

    DROP TABLE IF EXISTS tratamientos;
    CREATE TABLE tratamientos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        crotal TEXT NOT NULL,
        fecha_inicio TEXT,
        fecha_fin TEXT,
        medicamento TEXT,
        veterinario TEXT,
        causa TEXT
    );

    DROP TABLE IF EXISTS explotaciones;
    CREATE TABLE explotaciones (
        cea TEXT PRIMARY KEY,
        tipo TEXT,
        nombre TEXT,
        finca TEXT,
        activa INTEGER
    );

    DROP TABLE IF EXISTS recetas;
    CREATE TABLE recetas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT,
        receta TEXT,
        medicamento TEXT,
        unidades REAL,
        dosis_unitaria REAL,
        n_animales INTEGER,
        veterinario TEXT,
        tiempo_carne INTEGER,
        tiempo_leche INTEGER,
        proveedor TEXT,
        cea TEXT
    );

    DROP TABLE IF EXISTS compras_alimento;
    CREATE TABLE compras_alimento (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT,
        alimento TEXT,
        kg REAL,
        importe REAL,
        precio_kg REAL,
        albaran TEXT,
        proveedor TEXT,
        pagado INTEGER
    );

    DROP TABLE IF EXISTS meta;
    CREATE TABLE meta (
        clave TEXT PRIMARY KEY,
        valor TEXT
    );

    DROP TABLE IF EXISTS ventas_liquidaciones;
    CREATE TABLE ventas_liquidaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_factura TEXT UNIQUE NOT NULL,
        fecha_factura TEXT,
        fecha_pago TEXT,
        cliente_cooperativa TEXT DEFAULT 'GANAVAEX, S.COOP',
        cif_cliente TEXT DEFAULT 'F37335411',
        total_cabezas REAL,
        total_kilos_canal REAL,
        base_imponible REAL,
        porcentaje_iva REAL DEFAULT 10.50,
        cuota_iva REAL,
        gastos_total REAL,
        total_factura REAL,
        archivo_origen TEXT
    );

    DROP TABLE IF EXISTS ventas_canales;
    CREATE TABLE ventas_canales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        factura_id INTEGER REFERENCES ventas_liquidaciones(id) ON DELETE CASCADE,
        linea_numero INTEGER,
        articulo TEXT,
        cabezas REAL DEFAULT 1.0,
        peso_canal_kg REAL,
        precio_unitario REAL,
        importe_linea REAL,
        referencia TEXT,
        fecha_salida_lote TEXT,
        crotal_asignado TEXT
    );

    DROP TABLE IF EXISTS ventas_gastos;
    CREATE TABLE ventas_gastos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        factura_id INTEGER REFERENCES ventas_liquidaciones(id) ON DELETE CASCADE,
        concepto TEXT,
        importe REAL
    );

    -- Índices optimizados
    CREATE INDEX idx_animal_crotal_4 ON animales(crotal_4);
    CREATE INDEX idx_animal_estado ON animales(estado);
    CREATE INDEX idx_animal_corral ON animales(corral);
    CREATE INDEX idx_animal_madre ON animales(madre_crotal);
    CREATE INDEX idx_partos_madre ON partos(madre_crotal);
    CREATE INDEX idx_partos_fecha ON partos(fecha_parto);
    CREATE INDEX idx_movimientos_crotal ON movimientos(crotal);
    CREATE INDEX idx_movimientos_fecha ON movimientos(fecha);
    CREATE INDEX idx_recetas_fecha ON recetas(fecha);
    CREATE INDEX idx_recetas_medicamento ON recetas(medicamento);
    CREATE INDEX idx_recetas_cea ON recetas(cea);
    CREATE INDEX idx_compras_fecha ON compras_alimento(fecha);
    CREATE INDEX idx_compras_alimento ON compras_alimento(alimento);
    CREATE INDEX idx_ventas_factura ON ventas_liquidaciones(numero_factura);
    CREATE INDEX idx_ventas_canales_crotal ON ventas_canales(crotal_asignado);
    CREATE INDEX idx_ventas_canales_factura ON ventas_canales(factura_id);
    """)
    conn.commit()


def poblar_datos(conn: sqlite3.Connection, num_animales: int = 150) -> None:
    cur = conn.cursor()
    rnd = random.Random(42)  # Semilla fija para datos deterministas y reproducibles
    hoy = date(2026, 9, 20)

    # 1. Explotaciones oficiales
    cur.executemany("""
    INSERT INTO explotaciones (cea, tipo, nombre, finca, activa) VALUES (?, ?, ?, ?, ?)
    """, [
        ("ES371261100121", "CC", "DEHESA LOS ENCINOS (VIDA)", "Los Encinos", 1),
        ("ES371261100122", "CE", "CEBADERO CENTRAL (CEBO)", "El Cerezal", 1),
        ("ES371061100671", "CC", "FINCA CIPÉREZ (HISTÓRICA)", "Cipérez", 0),
        ("ES372621100591", "CC", "FINCA EL CEREZAL (HISTÓRICA)", "El Cerezal", 0),
    ])

    # 2. Generar Censo de Animales
    animales = []
    crotales = []
    partos = []
    movimientos = []

    # Crotales clave reconocibles para consultas demostrativas
    crotales_destacados = ["1045", "8549", "5186", "0391", "7721", "3402", "9910"]

    for i in range(num_animales):
        if i < len(crotales_destacados):
            c4 = crotales_destacados[i]
        else:
            c4 = f"{rnd.randint(1000, 9999)}"

        crotal = f"ES083710{c4}{rnd.randint(10, 99)}"
        crotales.append((crotal, c4))

        # 85% vacas/hembras de vida, 15% machos de cebo
        es_vaca = (i >= 15)
        sexo = "Vaca" if es_vaca else "Machos"
        raza = rnd.choice(RAZAS)

        # Edad: Vacas entre 3 y 11 años, machos entre 6 y 18 meses
        if es_vaca:
            dias_vida = rnd.randint(1100, 4000)
            corral = rnd.choice(["DUEÑA", "ESPADAÑA", "RIVERA", "LA VEGA"])
        else:
            dias_vida = rnd.randint(180, 540)
            corral = "CEBADERO"

        fnac = hoy - timedelta(days=dias_vida)
        fnac_str = fnac.isoformat()
        falta_str = (fnac + timedelta(days=rnd.randint(1, 30))).isoformat()

        estado = "A" if rnd.random() > 0.10 else "B"
        vida = 1 if estado == "A" else 0

        # Partos para vacas adultas
        total_partos = 0
        ult_parto_str = None
        if es_vaca and dias_vida > 900 and estado == "A":
            num_partos = min((dias_vida - 700) // 380, 8)
            num_partos = max(1, num_partos)
            total_partos = num_partos

            fecha_cursor = hoy - timedelta(days=rnd.randint(60, 300))
            ult_parto_str = fecha_cursor.isoformat()

            for p_idx in range(num_partos):
                fparto = fecha_cursor - timedelta(days=p_idx * 370 + rnd.randint(-20, 20))
                cria_sex = "Hembra" if rnd.random() > 0.48 else "Macho"
                cria_crot = f"ES083711{rnd.randint(1000, 9999)}{rnd.randint(10, 99)}"
                partos.append((crotal, fparto.isoformat(), cria_crot, cria_sex, "Sin incidencias"))

                # Movimiento de cría: si fue macho, al cebadero 122
                if cria_sex == "Macho" and rnd.random() > 0.3:
                    f_tras = fparto + timedelta(days=rnd.randint(180, 240))
                    movimientos.append((cria_crot, f_tras.isoformat(), "TRASPASO", "ES371261100121", "ES371261100122", "CEBADERO"))

        animales.append((
            crotal, c4, f"Vaca {c4}" if es_vaca else f"Toro {c4}",
            sexo, raza, fnac_str, None, None, estado, vida,
            corral, falta_str, ult_parto_str, total_partos
        ))

        # Movimiento inicial de nacimiento o alta
        movimientos.append((
            crotal, falta_str, "NACIMIENTO" if es_vaca else "COMPRA",
            "ES371261100121" if es_vaca else "ES371061100671",
            "ES371261100121" if es_vaca else "ES371261100122",
            corral
        ))

    cur.executemany("""
    INSERT INTO animales (
        crotal, crotal_4, nombre, sexo, raza, fecha_nacimiento,
        madre_crotal, padre_crotal, estado, vida, corral,
        fecha_alta, fecha_ult_parto, total_partos
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, animales)

    cur.executemany("""
    INSERT INTO partos (madre_crotal, fecha_parto, cria_crotal, cria_sexo, incidencias)
    VALUES (?, ?, ?, ?, ?)
    """, partos)

    # 3. Recetas Veterinarias
    recetas = []
    for r_idx in range(60):
        med, t_carne, dosis = rnd.choice(MEDICAMENTOS)
        frec = hoy - timedelta(days=rnd.randint(5, 700))
        n_anim = rnd.randint(1, 15)
        unidades = round(n_anim * dosis / 50.0, 1) or 1.0
        vet = rnd.choice(VETERINARIOS)
        cea = "ES371261100121" if rnd.random() > 0.35 else "ES371261100122"
        rec_num = f"REC-202{frec.year % 10}-{rnd.randint(10000, 99999)}"
        recetas.append((
            frec.isoformat(), rec_num, med, unidades, dosis,
            n_anim, vet, t_carne, 0, "FARMACIA VETERINARIA SALMANTINA", cea
        ))

    cur.executemany("""
    INSERT INTO recetas (
        fecha, receta, medicamento, unidades, dosis_unitaria,
        n_animales, veterinario, tiempo_carne, tiempo_leche, proveedor, cea
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, recetas)

    # 4. Compras de Alimento
    compras = []
    for c_idx in range(40):
        alim, pr_kg = rnd.choice(ALIMENTOS)
        fcompra = hoy - timedelta(days=rnd.randint(2, 600))
        kg = rnd.choice([3000, 5000, 8000, 12000, 15000])
        importe = round(kg * pr_kg, 2)
        alb = f"ALB-{fcompra.year}-{rnd.randint(1000, 9999)}"
        prov = rnd.choice(PROVEEDORES)
        compras.append((
            fcompra.isoformat(), alim, kg, importe, pr_kg, alb, prov, 1
        ))

    cur.executemany("""
    INSERT INTO compras_alimento (
        fecha, alimento, kg, importe, precio_kg, albaran, proveedor, pagado
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, compras)

    # 5. Movimientos
    cur.executemany("""
    INSERT INTO movimientos (crotal, fecha, tipo, origen, destino, corral)
    VALUES (?, ?, ?, ?, ?, ?)
    """, movimientos)

    # 6. Liquidaciones y Canales de Venta (GANAVAEX)
    animales_baja = [a for a in animales if a[8] == "B"]
    if len(animales_baja) >= 4:
        lote1 = animales_baja[:4]
        canales1 = []
        kg_total1 = 0.0
        base1 = 0.0
        f_fac1 = hoy - timedelta(days=60)
        for idx, anim in enumerate(lote1):
            crot = anim[0]
            kg = round(rnd.uniform(260.0, 310.0), 1)
            pr = round(rnd.uniform(7.10, 7.85), 3)
            imp = round(kg * pr, 2)
            kg_total1 += kg
            base1 += imp
            canales1.append((1, idx + 1, "TERNERA CEBO", 1.0, kg, pr, imp, "REF-02", f_fac1.isoformat(), crot))
            movimientos.append((
                crot, (f_fac1 - timedelta(days=2)).isoformat(), "VENTA",
                "ES371261100122", "ES373762000081", "CEBADERO"
            ))

        pct_iva = 10.5
        iva1 = round(base1 * (pct_iva / 100.0), 2)
        gastos1 = round(base1 * 0.015, 2)
        total1 = round(base1 + iva1 - gastos1, 2)

        cur.execute("""
        INSERT INTO ventas_liquidaciones (
            id, numero_factura, fecha_factura, fecha_pago, cliente_cooperativa,
            cif_cliente, total_cabezas, total_kilos_canal, base_imponible,
            porcentaje_iva, cuota_iva, gastos_total, total_factura, archivo_origen
        ) VALUES (1, 'F-2024-00452', ?, ?, 'GANAVAEX, S.COOP', 'F37335411', ?, ?, ?, ?, ?, ?, ?, 'factura_00452.pdf')
        """, (
            f_fac1.isoformat(),
            (f_fac1 + timedelta(days=15)).isoformat(),
            float(len(lote1)),
            round(kg_total1, 1),
            round(base1, 2),
            pct_iva,
            iva1,
            gastos1,
            total1
        ))

        cur.executemany("""
        INSERT INTO ventas_canales (
            factura_id, linea_numero, articulo, cabezas, peso_canal_kg, precio_unitario, importe_linea, referencia, fecha_salida_lote, crotal_asignado
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, canales1)

        cur.execute("""
        INSERT INTO ventas_gastos (factura_id, concepto, importe)
        VALUES (1, 'Portes y cuota cooperativa GANAVAEX', ?)
        """, (gastos1,))

    # 7. Metadatos de la base de datos
    cur.executemany("""
    INSERT INTO meta (clave, valor) VALUES (?, ?)
    """, [
        ("fecha_export", hoy.isoformat() + " 12:00:00"),
        ("version", "1.0.0"),
        ("total_animales", str(num_animales)),
        ("explotacion", "ES371261100121"),
        ("sistema", "Ganaderos Campo PWA (Dataset Sintético Demo)"),
    ])

    conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="Generar base de datos SQLite sintética de prueba.")
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Ruta de destino del archivo SQLite (defecto: {DEFAULT_OUTPUT})"
    )
    parser.add_argument(
        "--animales", "-n",
        type=int,
        default=150,
        help="Número total de animales a generar (defecto: 150)"
    )
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists():
        args.output.unlink()

    print(f"Generando base de datos sintética en: {args.output}")
    conn = sqlite3.connect(args.output)
    try:
        crear_esquema(conn)
        poblar_datos(conn, num_animales=args.animales)
        print(f"Base de datos generada exitosamente con {args.animales} animales.")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
