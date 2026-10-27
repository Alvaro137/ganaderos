"""Pruebas unitarias para el modelo y repositorio de Tratamientos y Trazabilidad Sanitaria."""
import sqlite3
from datetime import date, timedelta

from src.application.services import CensoService
from src.domain.models import TratamientoIndividual
from src.infrastructure.repositories import (
    SQLiteAnimalRepository,
    SQLiteTratamientoRepository,
)


def test_tratamiento_individual_esta_en_retirada():
    hoy = date.today()
    t_activo = TratamientoIndividual(
        crotal="ES083712611002",
        fecha_inicio=hoy - timedelta(days=5),
        medicamento="DRAXXIN",
        dias_retirada=49,
        fecha_fin_retirada=hoy + timedelta(days=44),
    )
    assert t_activo.esta_en_retirada(hoy) is True
    t_sin_fecha_fin = TratamientoIndividual(
        crotal="ES083712611002",
        fecha_inicio=hoy - timedelta(days=5),
        medicamento="DRAXXIN",
        dias_retirada=49,
        fecha_fin_retirada=None,
    )
    assert t_sin_fecha_fin.esta_en_retirada(hoy) is True
    # 50 días después ya ha salido de retirada
    assert t_sin_fecha_fin.esta_en_retirada(hoy + timedelta(days=45)) is False

    t_pasado = TratamientoIndividual(
        crotal="ES083712611002",
        fecha_inicio=hoy - timedelta(days=60),
        medicamento="FLUNIXIN",
        dias_retirada=4,
        fecha_fin_retirada=hoy - timedelta(days=56),
    )
    assert t_pasado.esta_en_retirada(hoy) is False


def test_censo_service_tratamiento_y_alerta():
    conn = sqlite3.connect(":memory:")
    conn.execute("""
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
    """)
    animal_repo = SQLiteAnimalRepository(conn)
    tratamiento_repo = SQLiteTratamientoRepository(conn)

    service = CensoService(animal_repo, tratamiento_repo)

    # Tratamiento y alerta
    conn.execute("""
    INSERT INTO tratamientos (crotal, fecha_inicio, medicamento, dias_retirada, fecha_fin_retirada)
    VALUES (?, ?, ?, ?, ?)
    """, (
        "ES083712611004",
        (date.today() - timedelta(days=2)).isoformat(),
        "BETAMOX L.A.",
        28,
        (date.today() + timedelta(days=26)).isoformat(),
    ))
    conn.commit()

    alerta = service.verificar_alerta_retirada("ES083712611004")
    assert alerta is not None
    assert alerta["en_retirada"] is True
    assert alerta["medicamento"] == "BETAMOX L.A."
