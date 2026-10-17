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
        fecha_inicio TEXT NOT NULL,
        fecha_fin TEXT,
        medicamento TEXT NOT NULL,
        veterinario TEXT,
        causa TEXT,
        dias_retirada INTEGER DEFAULT 0,
        fecha_fin_retirada TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tratamientos_crotal ON tratamientos(crotal);

    DROP TABLE IF EXISTS pesajes;
    CREATE TABLE pesajes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        crotal TEXT NOT NULL,
        fecha TEXT NOT NULL,
        peso_kg REAL NOT NULL,
        tipo TEXT DEFAULT 'Control',
        notas TEXT,
        operador TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pesajes_crotal ON pesajes(crotal);
    CREATE INDEX IF NOT EXISTS idx_pesajes_fecha ON pesajes(fecha);

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

    DROP TABLE IF EXISTS cotizaciones_lonja;
    CREATE TABLE cotizaciones_lonja (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL,
        lonja TEXT DEFAULT 'SALAMANCA',
        mesa TEXT NOT NULL,
        categoria TEXT NOT NULL,
        unidad TEXT NOT NULL,
        precio REAL NOT NULL,
        variacion REAL DEFAULT 0.0
    );
    CREATE INDEX IF NOT EXISTS idx_lonja_fecha_cat ON cotizaciones_lonja(fecha, categoria);

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

    # 7. Pesajes en Manga y Crecimiento (GMD)
    pesajes_datos = []
    # 7a. Pesajes de animales liquidados en canal (para cálculo de rendimiento)
    for c in canales1:
        crot = c[9]
        p_canal = c[4] or 280.0
        # Peso vivo de salida estimado para rendimiento ~58%
        peso_salida = round(p_canal / 0.582, 1)
        f_salida = f_fac1 - timedelta(days=2)
        f_control = f_salida - timedelta(days=90)
        f_destete = f_control - timedelta(days=120)

        peso_destete = round(peso_salida - (210 * 1.35), 1)
        peso_destete = max(180.0, peso_destete)
        peso_control = round(peso_destete + (120 * 1.32), 1)

        pesajes_datos.append((crot, f_destete.isoformat(), peso_destete, "Destete", "Entrada a cebadero", "Álvaro"))
        pesajes_datos.append((crot, f_control.isoformat(), peso_control, "Control", "Control intermedio báscula manga", "Paco"))
        pesajes_datos.append((crot, f_salida.isoformat(), peso_salida, "Salida", "Pesaje previo a carga para matadero", "Álvaro"))

    # 7b. Pesajes de animales activos en cebadero
    animales_cebo_activos = [a for a in animales if a[8] == "A" and a[10] == "CEBADERO"]
    for anim in animales_cebo_activos[:15]:
        crot = anim[0]
        f_dest = hoy - timedelta(days=rnd.randint(120, 200))
        p_dest = round(rnd.uniform(190.0, 230.0), 1)
        pesajes_datos.append((crot, f_dest.isoformat(), p_dest, "Destete", "Pesaje al destete", "Paco"))

        dias_inter = rnd.randint(50, 90)
        f_ctrl = f_dest + timedelta(days=dias_inter)
        p_ctrl = round(p_dest + (dias_inter * rnd.uniform(1.20, 1.48)), 1)
        pesajes_datos.append((crot, f_ctrl.isoformat(), p_ctrl, "Control", "Control báscula", "Álvaro"))

    cur.executemany("""
    INSERT INTO pesajes (crotal, fecha, peso_kg, tipo, notas, operador)
    VALUES (?, ?, ?, ?, ?, ?)
    """, pesajes_datos)

    # 8. Tratamientos Individuales y Periodos de Retirada
    tratamientos_datos = []
    # Dos animales activos con tratamiento vigente (alerta de retirada)
    animales_activos = [a for a in animales if a[8] == "A"]
    if len(animales_activos) >= 2:
        # Animal 1: Draxxin (49 días de retirada, tratado hace 4 días)
        a1 = animales_activos[0]
        f_ini1 = hoy - timedelta(days=4)
        f_fin_ret1 = f_ini1 + timedelta(days=49)
        tratamientos_datos.append((
            a1[0], f_ini1.isoformat(), (f_ini1 + timedelta(days=1)).isoformat(),
            "DRAXXIN 100 MG/ML", "DR. CARLOS SÁNCHEZ (COL. 37/1042)",
            "Proceso respiratorio bovino (neumonía)", 49, f_fin_ret1.isoformat()
        ))

        # Animal 2: Betamox (28 días de retirada, tratado hace 2 días)
        a2 = animales_activos[1]
        f_ini2 = hoy - timedelta(days=2)
        f_fin_ret2 = f_ini2 + timedelta(days=28)
        tratamientos_datos.append((
            a2[0], f_ini2.isoformat(), (f_ini2 + timedelta(days=2)).isoformat(),
            "BETAMOX L.A.", "DRA. MARTA HERNÁNDEZ (COL. 37/0891)",
            "Infección podal / panadizo", 28, f_fin_ret2.isoformat()
        ))

    # Varios tratamientos históricos ya finalizados
    for anim in animales_activos[2:12]:
        dias_atras = rnd.randint(60, 350)
        f_ini = hoy - timedelta(days=dias_atras)
        med_nombre, t_ret, _ = rnd.choice(MEDICAMENTOS)
        f_fin_ret = f_ini + timedelta(days=t_ret)
        tratamientos_datos.append((
            anim[0], f_ini.isoformat(), (f_ini + timedelta(days=2)).isoformat(),
            med_nombre, rnd.choice(VETERINARIOS),
            "Tratamiento preventivo o cura rutinaria", t_ret, f_fin_ret.isoformat()
        ))

    cur.executemany("""
    INSERT INTO tratamientos (
        crotal, fecha_inicio, fecha_fin, medicamento,
        veterinario, causa, dias_retirada, fecha_fin_retirada
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, tratamientos_datos)

    # 9. Cotizaciones Semanales Oficiales de la Lonja de Salamanca (2025 - 2026)
    lonja_datos = []
    # Generar sesiones de los lunes desde enero 2025 hasta la actualidad
    inicio_lonja = date(2025, 1, 6)  # Primer lunes de 2025
    dias_totales = (hoy - inicio_lonja).days
    num_semanas = (dias_totales // 7) + 1

    p_anojo = 7.15
    p_cebada = 214.0
    p_maiz = 230.0

    for sem in range(num_semanas):
        f_sesion = inicio_lonja + timedelta(weeks=sem)
        # Tendencia real 2025-2026: subida en primavera, ajuste en verano
        if f_sesion.year == 2025:
            p_anojo = round(7.10 + (sem * 0.006) + rnd.uniform(-0.02, 0.02), 2)
            p_cebada = round(210.0 + (sem * 0.25) + rnd.uniform(-1.0, 1.0), 1)
            p_maiz = round(228.0 + (sem * 0.30) + rnd.uniform(-1.0, 1.0), 1)
        else:
            # 2026: pico en primavera (7.45) y estabilización (7.22 - 7.30)
            sem_2026 = sem - 52
            p_anojo = round(7.35 + (0.12 * rnd.uniform(0.8, 1.1)) - (sem_2026 * 0.003), 2)
            p_cebada = round(222.0 - (sem_2026 * 0.15) + rnd.uniform(-0.8, 0.8), 1)
            p_maiz = round(238.0 - (sem_2026 * 0.20) + rnd.uniform(-1.0, 1.0), 1)

        p_anojo_pes = round(p_anojo - 0.14, 2)
        p_ternera = round(p_anojo + 0.28, 2)
        p_vaca = round(4.15 + rnd.uniform(-0.05, 0.08), 2)
        p_pienso = round(315.0 + ((p_cebada - 215.0) * 0.5) + ((p_maiz - 230.0) * 0.4), 1)

        f_str = f_sesion.isoformat()
        lonja_datos.append((f_str, "SALAMANCA", "CARNE", "AÑOJO_EXTRA", "EUR_KG_CANAL", p_anojo, 0.0))
        lonja_datos.append((f_str, "SALAMANCA", "CARNE", "AÑOJO_PESADO", "EUR_KG_CANAL", p_anojo_pes, 0.0))
        lonja_datos.append((f_str, "SALAMANCA", "CARNE", "TERNERA_EXTRA", "EUR_KG_CANAL", p_ternera, 0.0))
        lonja_datos.append((f_str, "SALAMANCA", "CARNE", "VACA_DESVIEJE", "EUR_KG_CANAL", p_vaca, 0.0))
        lonja_datos.append((f_str, "SALAMANCA", "CEREALES", "CEBADA", "EUR_TONELADA", p_cebada, 0.0))
        lonja_datos.append((f_str, "SALAMANCA", "CEREALES", "MAIZ", "EUR_TONELADA", p_maiz, 0.0))
        lonja_datos.append((f_str, "SALAMANCA", "CEREALES", "PIENSO_CEBO", "EUR_TONELADA", p_pienso, 0.0))

    cur.executemany("""
    INSERT INTO cotizaciones_lonja (
        fecha, lonja, mesa, categoria, unidad, precio, variacion
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """, lonja_datos)

    # 10. Metadatos de la base de datos
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
