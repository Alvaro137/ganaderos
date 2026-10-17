"""Pruebas unitarias para el modelo y repositorio de Pesajes, cálculo de GMD y Trazabilidad Sanitaria."""
import sqlite3
from datetime import date, timedelta

from src.application.services import CensoService
from src.domain.models import Pesaje, TratamientoIndividual
from src.infrastructure.repositories import (
    SQLiteAnimalRepository,
    SQLitePesajeRepository,
    SQLiteTratamientoRepository,
)


def test_pesaje_gmd_calculation():
    p1 = Pesaje(crotal="ES083712611001", fecha=date(2026, 1, 1), peso_kg=250.0, tipo="Destete")
    p2 = Pesaje(crotal="ES083712611001", fecha=date(2026, 2, 1), peso_kg=295.0, tipo="Control")

    # 31 días, 45 kg ganados -> 45 / 31 = 1.452 kg/día
    gmd = Pesaje.calcular_gmd(p1, p2)
    assert gmd is not None
    assert abs(gmd - 1.452) < 0.005

    # Mismo día o fecha anterior devuelve None
    assert Pesaje.calcular_gmd(p2, p1) is None


def test_pesaje_rendimiento_canal():
    # 285 kg canal / 485 kg vivo = 58.76%
    rend = Pesaje.calcular_rendimiento_canal(285.0, 485.0)
    assert rend is not None
    assert rend == 58.76

    # Peso vivo inválido devuelve None
    assert Pesaje.calcular_rendimiento_canal(285.0, 0) is None
    assert Pesaje.calcular_rendimiento_canal(285.0, -10) is None


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


def test_sqlite_pesaje_repository_crud():
    conn = sqlite3.connect(":memory:")
    repo = SQLitePesajeRepository(conn)

    p1 = Pesaje(crotal="ES083712611003", fecha=date(2026, 3, 1), peso_kg=280.0, tipo="Destete", operador="Álvaro")
    creado = repo.create(p1)
    assert creado.id is not None
    assert creado.id > 0

    p2 = Pesaje(crotal="ES083712611003", fecha=date(2026, 4, 1), peso_kg=325.0, tipo="Control")
    repo.create(p2)

    pesajes = repo.list_by_crotal("ES083712611003")
    assert len(pesajes) == 2
    assert pesajes[0].peso_kg == 280.0
    assert pesajes[1].peso_kg == 325.0

    recent = repo.list_recent(limite=10)
    assert len(recent) == 2


def test_censo_service_pesajes_con_gmd():
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
    pesaje_repo = SQLitePesajeRepository(conn)
    tratamiento_repo = SQLiteTratamientoRepository(conn)

    service = CensoService(animal_repo, pesaje_repo, tratamiento_repo)

    service.registrar_pesaje("ES083712611004", date(2026, 1, 1), 220.0, tipo="Destete")
    service.registrar_pesaje("ES083712611004", date(2026, 2, 1), 265.0, tipo="Control")

    con_gmd = service.get_pesajes_con_gmd("ES083712611004")
    assert len(con_gmd) == 2
    assert con_gmd[0]["gmd_kg_dia"] is None
    assert con_gmd[1]["gmd_kg_dia"] is not None
    assert con_gmd[1]["gmd_kg_dia"] > 1.4

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
