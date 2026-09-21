"""Construcción y optimización de base de datos SQLite relacional indexada."""
from __future__ import annotations

import sqlite3
from pathlib import Path


def inicializar_bd_sqlite(ruta_destino: Path) -> sqlite3.Connection:
    ruta_destino.parent.mkdir(parents=True, exist_ok=True)
    if ruta_destino.exists():
        ruta_destino.unlink()

    conn = sqlite3.connect(str(ruta_destino))
    conn.execute("PRAGMA journal_mode = MEMORY")
    conn.execute("PRAGMA synchronous = OFF")

    conn.executescript("""
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

    -- Índices optimizados para latencia cero en consultas en campo
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
    """)
    conn.commit()
    return conn


def optimizar_bd(conn: sqlite3.Connection) -> None:
    conn.execute("ANALYZE")
    conn.execute("PRAGMA optimize")
    conn.commit()
