"""Pruebas unitarias para DevengoCebo y SQLiteLonjaRepository."""
import sqlite3
from datetime import date

from src.domain.models import CotizacionLonja, DevengoCebo
from src.infrastructure.repositories import SQLiteLonjaRepository


def test_devengo_cebo_coste_pienso_imputado():
    # Ternero con 310 kg canal (rendimiento canal 58%) -> PV = 310 / 0.58 = 534.5 kg
    # Ganancia estimada (PV - 240 destete) = 294.5 kg ganado
    # Pienso consumido con FCR 5.0 = 1472.0 kg
    # A 0.315 €/kg pienso -> 1472.0 * 0.315 = 463.68 €
    res = DevengoCebo.calcular_coste_pienso_imputado(
        dias_cebadero=210,
        peso_canal_kg=310.0,
        peso_destete_kg=240.0,
        fcr=5.0,
        precio_pienso_medio=0.315,
    )
    assert res["peso_vivo_estimado"] == 534.5
    assert res["ganancia_peso_vivo"] == 294.5
    assert res["kg_pienso_imputados"] == 1472.0
    assert res["coste_pienso_imputado"] == 463.68
    assert res["gmd_estimada"] == 1.402  # 294.5 / 210


def test_devengo_cebo_auditar_precio_vs_lonja():
    # Ternero cobrado a 5.45 €/kg canal, lonja Salamanca marca 5.30 €/kg canal
    audit = DevengoCebo.auditar_precio_vs_lonja(5.45, 5.30)
    assert audit["diferencia_kg"] == 0.150
    assert audit["tipo"] == "PRIMA"
    assert audit["porcentaje"] == 2.83

    # Cobrado por debajo de lonja
    audit_desf = DevengoCebo.auditar_precio_vs_lonja(5.15, 5.30)
    assert audit_desf["diferencia_kg"] == -0.150
    assert audit_desf["tipo"] == "PENALIZACION"


def test_devengo_cebo_penalizacion_sobrepeso():
    # Macho de 380 kg canal (> 350 kg umbral estándar)
    # Liquidado a 7.15 €/kg cuando el añojo ligero cotizaba a 7.30 €/kg
    penalizacion = DevengoCebo.detectar_penalizacion_sobrepeso(
        peso_canal_kg=380.0,
        precio_liquidado=7.15,
        precio_optimo_lonja=7.30,
    )
    assert penalizacion is not None
    assert penalizacion["exceso_kg_canal"] == 30.0
    assert penalizacion["perdida_precio_kg"] == 0.150
    assert penalizacion["penalizacion_total_eur"] == 57.0  # 380 * 0.15

    # Animal dentro del peso ideal (340 kg canal) no tiene penalización
    assert DevengoCebo.detectar_penalizacion_sobrepeso(340.0, 7.30, 7.30) is None


def test_sqlite_lonja_repository():
    conn = sqlite3.connect(":memory:")
    conn.execute(
        """
        CREATE TABLE cotizaciones_lonja (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            lonja TEXT NOT NULL DEFAULT 'SALAMANCA',
            mesa TEXT NOT NULL,
            categoria TEXT NOT NULL,
            unidad TEXT NOT NULL,
            precio REAL NOT NULL,
            variacion REAL DEFAULT 0.0
        )
        """
    )
    repo = SQLiteLonjaRepository(conn)

    cotizaciones = [
        CotizacionLonja(
            fecha=date(2026, 1, 12),
            mesa="CARNE",
            categoria="AÑOJO_EXTRA",
            precio=7.25,
            unidad="EUR_KG_CANAL",
        ),
        CotizacionLonja(
            fecha=date(2026, 1, 19),
            mesa="CARNE",
            categoria="AÑOJO_EXTRA",
            precio=7.30,
            unidad="EUR_KG_CANAL",
        ),
        CotizacionLonja(
            fecha=date(2026, 1, 12),
            mesa="CEREALES",
            categoria="CEBADA",
            precio=215.0,
            unidad="EUR_TONELADA",
        ),
    ]

    for c in cotizaciones:
        repo.save(c)

    # Consulta list_cotizaciones
    res_cebada = repo.list_cotizaciones(categoria="CEBADA")
    assert len(res_cebada) == 1
    assert res_cebada[0].precio == 215.0

    res_all = repo.list_cotizaciones()
    assert len(res_all) == 3

    # Cotización cercana (el día 13 de enero busca la más cercana del día 12 o 19)
    cercana = repo.get_cotizacion_cercana(
        fecha_referencia=date(2026, 1, 13),
        categoria="AÑOJO_EXTRA",
    )
    assert cercana is not None
    assert cercana.fecha == date(2026, 1, 12)
    assert cercana.precio == 7.25
