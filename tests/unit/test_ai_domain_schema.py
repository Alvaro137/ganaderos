"""Tests unitarios para la extracción de esquema y vocabulario de dominio sin PII."""

from pathlib import Path

from src.application.ai_domain_schema import (
    construir_system_prompt_sql,
    obtener_esquema_ddl,
    obtener_vocabulario_dominio,
)

DEMO_DB = Path(__file__).resolve().parent.parent.parent / "pwa" / "ganaderos_demo.sqlite"


class TestAIDomainSchema:
    def test_obtener_esquema_ddl_contains_main_tables(self):
        ddl = obtener_esquema_ddl()
        assert "CREATE TABLE animales" in ddl
        assert "CREATE TABLE partos" in ddl
        assert "CREATE TABLE movimientos" in ddl
        assert "CREATE TABLE tratamientos" in ddl
        assert "CREATE TABLE compras_alimento" in ddl
        assert "CREATE TABLE ventas_canales" in ddl

    def test_obtener_vocabulario_dominio(self):
        vocab = obtener_vocabulario_dominio(DEMO_DB)
        assert "corrales" in vocab
        assert "razas" in vocab
        assert "sexos" in vocab
        assert "estados" in vocab
        assert len(vocab["corrales"]) > 0

    def test_construir_system_prompt_sql(self):
        prompt = construir_system_prompt_sql(DEMO_DB)
        assert "Ganaderos Campo" in prompt
        assert "SELECT" in prompt
        assert "ESQUEMA DE BASE DE DATOS SQLITE:" in prompt
