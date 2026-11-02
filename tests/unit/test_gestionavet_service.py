"""Tests unitarios para la ingesta e integración de Gestionavet con origen='gestionavet'."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from src.application.gestionavet_service import (
    guardar_tratamientos_gestionavet_en_bd,
    normalizar_fecha_es,
    parsear_csv_tratamientos,
    sincronizar_gestionavet_en_bd,
)
from src.server.app import app, verify_token


def test_normalizar_fecha_es():
    assert normalizar_fecha_es("14-02-2025") == "2025-02-14"
    assert normalizar_fecha_es("01/12/2024") == "2024-12-01"
    assert normalizar_fecha_es("2026-10-10") == "2026-10-10"
    assert normalizar_fecha_es("") == ""


def test_parsear_csv_tratamientos():
    csv_raw = (
        'FECHAS DE ADMINISTRACIÓN;CÓDIGO DE RECETA;MEDICAMENTO;VETERIANARIO;NUMCOLEGIADO;CANTIDAD;VÍA ADMINISTRACIÓN;DURACIÓN;NATURALEZA TRATAMIENTO;INDICACIONES;IDENTIFICACIÓN ANIMAL/LOTE ANIMALES;FECHA INICIO TRATAMIENTO;FECHA FIN TRATAMIENTO;CANTIDAD SUMINISTRADA;PROVEEDOR;BOTIQUÍN;TIEMPO ESPERA\n'
        '"14-02-2025";G37005842025000235;"SELEVIT 75 mg/ml";"MANUEL BOGAJO";584;4 cc;INTRAMUSCULAR;1 Días;VITAMINICO;"Dosis: 1cc/15kg";3629;"14-02-2025";"15-02-2025";"0 ";"  ";Sí;\n'
    )
    res = parsear_csv_tratamientos(csv_raw)
    assert len(res) == 1
    item = res[0]
    assert item["receta"] == "G37005842025000235"
    assert item["medicamento"] == "SELEVIT 75 mg/ml"
    assert item["crotal"] == "3629"
    assert item["fecha_inicio"] == "2025-02-14"
    assert item["fecha_fin"] == "2025-02-15"
    assert item["causa"] == "VITAMINICO"


def test_guardar_tratamientos_idempotencia():
    conn = sqlite3.connect(":memory:")
    conn.executescript("""
        CREATE TABLE recetas (
            id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, receta TEXT, medicamento TEXT,
            unidades REAL, dosis_unitaria REAL, n_animales INTEGER, veterinario TEXT,
            tiempo_carne INTEGER, tiempo_leche INTEGER, proveedor TEXT, cea TEXT,
            origen TEXT DEFAULT 'access'
        );
        CREATE TABLE tratamientos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, fecha_inicio TEXT, fecha_fin TEXT,
            crotal TEXT, medicamento TEXT, dosis TEXT, receta_id INTEGER, causa TEXT,
            origen TEXT DEFAULT 'access'
        );
    """)

    datos = [
        {
            "receta": "REC-001",
            "medicamento": "DRAXXIN",
            "veterinario": "DR. PEREZ",
            "crotal": "1234",
            "dosis": "2 cc",
            "fecha_inicio": "2026-03-01",
            "fecha_fin": "2026-03-02",
            "causa": "RESPIRATORIO",
        }
    ]

    res1 = guardar_tratamientos_gestionavet_en_bd(conn, datos, cea_por_defecto="ES371261100121")
    assert res1["recetas_nuevas"] == 1
    assert res1["tratamientos_nuevos"] == 1

    # Segunda ejecución: no debe duplicar
    res2 = guardar_tratamientos_gestionavet_en_bd(conn, datos, cea_por_defecto="ES371261100121")
    assert res2["recetas_nuevas"] == 0
    assert res2["tratamientos_nuevos"] == 0

    # Verificar que el origen es 'gestionavet'
    cur_rec = conn.execute("SELECT origen FROM recetas WHERE receta = 'REC-001'")
    assert cur_rec.fetchone()[0] == "gestionavet"

    cur_trat = conn.execute("SELECT origen FROM tratamientos WHERE crotal = '1234'")
    assert cur_trat.fetchone()[0] == "gestionavet"


def test_sincronizar_gestionavet_en_bd(tmp_path: Path):
    db_file = tmp_path / "test_gv.sqlite"
    conn = sqlite3.connect(str(db_file))
    conn.executescript("""
        CREATE TABLE recetas (
            id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, receta TEXT, medicamento TEXT,
            unidades REAL, dosis_unitaria REAL, n_animales INTEGER, veterinario TEXT,
            tiempo_carne INTEGER, tiempo_leche INTEGER, proveedor TEXT, cea TEXT,
            origen TEXT DEFAULT 'access'
        );
        CREATE TABLE tratamientos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, fecha_inicio TEXT, fecha_fin TEXT,
            crotal TEXT, medicamento TEXT, dosis TEXT, receta_id INTEGER, causa TEXT,
            origen TEXT DEFAULT 'access'
        );
        CREATE TABLE _sync_estado (id INTEGER PRIMARY KEY, epoch INTEGER, actualizado_en TEXT);
        INSERT INTO _sync_estado VALUES (1, 1, '2026-01-01');
    """)
    conn.close()

    mock_client = MagicMock()
    mock_client.login.return_value = True
    mock_client.get_regas.return_value = [("29756", "ES371261100121", "BOVIDOS")]
    dummy_csv = (
        'FECHAS DE ADMINISTRACIÓN;CÓDIGO DE RECETA;MEDICAMENTO;VETERIANARIO;NUMCOLEGIADO;CANTIDAD;VÍA ADMINISTRACIÓN;DURACIÓN;NATURALEZA TRATAMIENTO;INDICACIONES;IDENTIFICACIÓN ANIMAL/LOTE ANIMALES;FECHA INICIO TRATAMIENTO;FECHA FIN TRATAMIENTO;CANTIDAD SUMINISTRADA;PROVEEDOR;BOTIQUÍN;TIEMPO ESPERA\n'
        '"10-01-2026";REC-GV-100;"CEFTIOFUR";"DR. LOPEZ";123;5 cc;IM;1 Días;ANTIBIOTICO;"";9999;"10-01-2026";"11-01-2026";"0 ";"  ";Sí;\n'
    ).encode("latin-1")
    mock_client.export_libro_tratamientos.return_value = dummy_csv

    with patch("scripts.export_gestionavet.GestionavetClient", return_value=mock_client):
        res = sincronizar_gestionavet_en_bd(
            db_path=db_file,
            usr="test_usr",
            pwd="test_pwd",
        )
        assert res["ok"] is True
        assert res["recetas_nuevas"] == 1
        assert res["tratamientos_nuevos"] == 1

        # Verificar incremento de epoch
        c = sqlite3.connect(str(db_file))
        epoch = c.execute("SELECT epoch FROM _sync_estado WHERE id = 1").fetchone()[0]
        c.close()
        assert epoch == 2


def test_endpoint_sync_gestionavet(monkeypatch, tmp_path: Path):
    db_file = tmp_path / "app_gv.sqlite"
    conn = sqlite3.connect(str(db_file))
    conn.executescript("""
        CREATE TABLE recetas (
            id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT, receta TEXT, medicamento TEXT,
            unidades REAL, dosis_unitaria REAL, n_animales INTEGER, veterinario TEXT,
            tiempo_carne INTEGER, tiempo_leche INTEGER, proveedor TEXT, cea TEXT,
            origen TEXT DEFAULT 'access'
        );
        CREATE TABLE tratamientos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, fecha_inicio TEXT, fecha_fin TEXT,
            crotal TEXT, medicamento TEXT, dosis TEXT, receta_id INTEGER, causa TEXT,
            origen TEXT DEFAULT 'access'
        );
    """)
    conn.close()

    monkeypatch.setenv("GANADEROS_DB_PATH", str(db_file))

    def mock_sync(path):
        return {"ok": True, "recetas_nuevas": 5, "tratamientos_nuevos": 10, "total_procesados": 10}

    monkeypatch.setattr("src.application.gestionavet_service.sincronizar_gestionavet_en_bd", mock_sync)

    app.dependency_overrides[verify_token] = lambda: True
    try:
        client = TestClient(app)
        resp = client.post("/api/recetas/sync-gestionavet")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["recetas_nuevas"] == 5
        assert data["tratamientos_nuevos"] == 10
    finally:
        app.dependency_overrides.pop(verify_token, None)
