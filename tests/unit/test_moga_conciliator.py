"""Pruebas unitarias para el procesador y conciliador de censo oficial MoGa / ITACyL."""
from src.application.moga_conciliator import (
    conciliar_censo_con_moga,
    normalizar_crotal,
    procesar_csv_moga,
)


def test_normalizar_crotal():
    assert normalizar_crotal("ES 08 371261100121") == "ES08371261100121"
    assert normalizar_crotal("es-08-371261100121") == "ES08371261100121"
    assert normalizar_crotal(None) == ""


def test_procesar_csv_moga():
    csv_data = """CROTAL;ESTADO;EXPLOTACION;RAZA;SEXO;FECHA_NACIMIENTO
ES083712611001;ALTA;ES371261100121;MORUCHA;H;12/03/2021
ES083712611002;BAJA;ES371261100121;LIMUSINA;H;15/05/2019
ES083712611003;ALTA;ES371261100122;CONJUNTO MESTIZO;M;10/01/2025
"""
    registros = procesar_csv_moga(csv_data)
    assert len(registros) == 3
    assert registros[0]["crotal"] == "ES083712611001"
    assert registros[0]["estado"] == "ALTA"
    assert registros[1]["estado"] == "BAJA"


def test_procesar_csv_moga_con_bom():
    # Simular export de Windows con UTF-8 BOM (\ufeff)
    csv_bytes = "\ufeffCROTAL;ESTADO;EXPLOTACION\nES083712611001;ALTA;ES371261100121\n".encode("utf-8")
    registros = procesar_csv_moga(csv_bytes)
    assert len(registros) == 1
    assert registros[0]["crotal"] == "ES083712611001"
    assert registros[0]["estado"] == "ALTA"


def test_conciliar_censo_con_moga():
    animales_locales = [
        {"crotal": "ES083712611001", "crotal_4": "1001", "estado": "A", "corral": "DUEÑA"},
        {"crotal": "ES083712611002", "crotal_4": "1002", "estado": "A", "corral": "ESPADAÑA"}, # Activo en campo pero baja en MoGa!
        {"crotal": "ES083712611099", "crotal_4": "1099", "estado": "A", "corral": "DUEÑA"},     # Físico pero ausente en MoGa!
        {"crotal": "ES083712611088", "crotal_4": "1088", "estado": "B", "corral": "HISTÓRICO"}, # Baja local pero aún de alta en MoGa
    ]

    registros_moga = [
        {"crotal": "ES083712611001", "estado": "ALTA", "explotacion": "ES371261100121"},
        {"crotal": "ES083712611002", "estado": "BAJA", "explotacion": "ES371261100121"},
        {"crotal": "ES083712611003", "estado": "ALTA", "explotacion": "ES371261100122"},         # En MoGa pero no en campo!
        {"crotal": "ES083712611088", "estado": "ALTA", "explotacion": "ES371261100121"},         # Baja local pero alta en MoGa
    ]

    res = conciliar_censo_con_moga(animales_locales, registros_moga)
    assert res["resumen"]["total_local"] == 4
    assert res["resumen"]["total_moga"] == 4
    assert res["resumen"]["coincidentes"] == 3

    # 1. No en MoGa: 1099
    assert len(res["no_en_moga"]) == 1
    assert res["no_en_moga"][0]["crotal"] == "ES083712611099"

    # 2. Bajas oficiales activas en campo: 1002
    assert len(res["bajas_oficiales_activas_local"]) == 1
    assert res["bajas_oficiales_activas_local"][0]["crotal"] == "ES083712611002"

    # 2b. Bajas locales activas en MoGa: 1088
    assert len(res["bajas_locales_activas_oficial"]) == 1
    assert res["bajas_locales_activas_oficial"][0]["crotal"] == "ES083712611088"

    # 3. En MoGa de alta pero inexistente en campo: 1003
    assert len(res["no_en_campo"]) == 1
    assert res["no_en_campo"][0]["crotal"] == "ES083712611003"
