"""Tests unitarios para el sandbox de ejecución SQL de solo lectura."""

from pathlib import Path

from src.application.sql_sandbox import (
    aplicar_limite_seguro,
    ejecutar_consulta_sandbox,
    validar_sql_seguro,
)

DEMO_DB = Path(__file__).resolve().parent.parent.parent / "pwa" / "ganaderos_demo.sqlite"


class TestSQLSandboxValidation:
    def test_validar_sql_seguro_valid_select(self):
        valido, err = validar_sql_seguro("SELECT * FROM animales WHERE estado = 'A'")
        assert valido
        assert err is None

    def test_validar_sql_seguro_valid_with(self):
        valido, err = validar_sql_seguro("WITH cte AS (SELECT crotal FROM animales) SELECT * FROM cte")
        assert valido
        assert err is None

    def test_validar_sql_seguro_rejects_empty(self):
        valido, err = validar_sql_seguro("")
        assert not valido
        assert "vacía" in err.lower()

    def test_validar_sql_seguro_rejects_delete(self):
        valido, err = validar_sql_seguro("DELETE FROM animales WHERE crotal_4 = '1045'")
        assert not valido
        assert "DELETE" in err

    def test_validar_sql_seguro_rejects_drop(self):
        valido, err = validar_sql_seguro("DROP TABLE animales")
        assert not valido
        assert "DROP" in err

    def test_validar_sql_seguro_rejects_update(self):
        valido, err = validar_sql_seguro("UPDATE animales SET estado = 'B'")
        assert not valido
        assert "UPDATE" in err

    def test_validar_sql_seguro_rejects_insert(self):
        valido, err = validar_sql_seguro("INSERT INTO animales (crotal) VALUES ('123')")
        assert not valido
        assert "INSERT" in err

    def test_validar_sql_seguro_rejects_multiple_statements(self):
        valido, err = validar_sql_seguro("SELECT * FROM animales; DROP TABLE animales")
        assert not valido
        assert "múltiples" in err

    def test_aplicar_limite_seguro_appends_limit(self):
        sql = "SELECT * FROM animales"
        limitada = aplicar_limite_seguro(sql, max_filas=25)
        assert "LIMIT 25" in limitada

    def test_aplicar_limite_seguro_preserves_existing_limit(self):
        sql = "SELECT * FROM animales LIMIT 10"
        limitada = aplicar_limite_seguro(sql, max_filas=25)
        assert limitada == sql


class TestSQLSandboxExecution:
    def test_ejecucion_sandbox_success(self):
        if not DEMO_DB.exists():
            return
        sql = "SELECT COUNT(*) as total FROM animales"
        ok, filas, err = ejecutar_consulta_sandbox(DEMO_DB, sql)
        assert ok
        assert err is None
        assert len(filas) == 1
        assert "total" in filas[0]
        assert filas[0]["total"] > 0

    def test_ejecucion_sandbox_syntax_error(self):
        if not DEMO_DB.exists():
            return
        sql = "SELECT columna_inexistente_xyz FROM animales"
        ok, filas, err = ejecutar_consulta_sandbox(DEMO_DB, sql)
        assert not ok
        assert len(filas) == 0
        assert "no such column" in err.lower()
