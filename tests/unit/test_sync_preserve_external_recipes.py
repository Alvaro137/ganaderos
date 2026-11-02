"""Tests unitarios para la preservación de recetas y tratamientos externos en SyncService."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from src.application.sync_service import SyncService


def test_importar_bd_preserva_recetas_externas(tmp_path: Path):
    db_maestra = tmp_path / "ganaderos_maestra.sqlite"
    db_nueva = tmp_path / "ganaderos_nueva_exportacion.sqlite"

    # 1. Crear BD maestra existente con recetas de access y una externa de gestionavet
    conn_m = sqlite3.connect(str(db_maestra))
    conn_m.executescript("""
    CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT);
    CREATE TABLE IF NOT EXISTS animales (crotal TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS partos (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS movimientos (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS compras_alimento (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS recetas (
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
        cea TEXT,
        origen TEXT DEFAULT 'access'
    );
    INSERT INTO recetas (fecha, receta, medicamento, tiempo_carne, origen)
    VALUES ('2026-09-01', 'REC-ACC-01', 'DRAXXIN', 49, 'access');
    INSERT INTO recetas (fecha, receta, medicamento, tiempo_carne, origen)
    VALUES ('2026-10-10', 'REC-GVET-02', 'CEFTIOFUR', 5, 'gestionavet');
    """)
    conn_m.commit()
    conn_m.close()

    # Inicializar sync service en la maestra
    sync = SyncService(db_maestra)
    c_init = sync._conectar()
    c_init.close()

    # 2. Crear BD nueva exportada desde Access (solo tiene recetas de access)
    conn_n = sqlite3.connect(str(db_nueva))
    conn_n.executescript("""
    CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT);
    INSERT INTO meta (clave, valor) VALUES ('fecha_exportacion', '2026-11-01');
    CREATE TABLE IF NOT EXISTS animales (crotal TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS partos (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS movimientos (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS compras_alimento (id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS recetas (
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
        cea TEXT,
        origen TEXT DEFAULT 'access'
    );
    INSERT INTO recetas (fecha, receta, medicamento, tiempo_carne, origen)
    VALUES ('2026-11-01', 'REC-ACC-03', 'PENICILINA', 14, 'access');
    """)
    conn_n.commit()
    conn_n.close()

    # 3. Importar la nueva exportación
    resumen = sync.importar_bd_actualizada(db_nueva)
    assert resumen["existe_bd"] is True

    # 4. Verificar que la maestra tiene la receta nueva de access Y la preservada de gestionavet
    conn_res = sqlite3.connect(str(db_maestra))
    recetas = conn_res.execute("SELECT receta, origen FROM recetas ORDER BY receta").fetchall()
    conn_res.close()

    recetas_dict = {r[0]: r[1] for r in recetas}
    assert "REC-ACC-03" in recetas_dict
    assert recetas_dict["REC-ACC-03"] == "access"
    assert "REC-GVET-02" in recetas_dict
    assert recetas_dict["REC-GVET-02"] == "gestionavet"
    # La receta vieja de access debe haber sido sustituida por el nuevo censo
    assert "REC-ACC-01" not in recetas_dict
