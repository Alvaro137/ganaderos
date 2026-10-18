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
    csv_bytes = "\ufeffCROTAL;ESTADO;EXPLOTACION\nES083712611001;ALTA;ES371261100121\n".encode(
        "utf-8"
    )
    registros = procesar_csv_moga(csv_bytes)
    assert len(registros) == 1
    assert registros[0]["crotal"] == "ES083712611001"
    assert registros[0]["estado"] == "ALTA"


def test_conciliar_censo_con_moga():
    animales_locales = [
        {"crotal": "ES083712611001", "crotal_4": "1001", "estado": "A", "corral": "DUEÑA"},
        {
            "crotal": "ES083712611002",
            "crotal_4": "1002",
            "estado": "A",
            "corral": "ESPADAÑA",
        },  # Activo en campo pero baja en MoGa!
        {
            "crotal": "ES083712611099",
            "crotal_4": "1099",
            "estado": "A",
            "corral": "DUEÑA",
        },  # Físico pero ausente en MoGa!
        {
            "crotal": "ES083712611088",
            "crotal_4": "1088",
            "estado": "B",
            "corral": "HISTÓRICO",
        },  # Baja local pero aún de alta en MoGa
    ]

    registros_moga = [
        {"crotal": "ES083712611001", "estado": "ALTA", "explotacion": "ES371261100121"},
        {"crotal": "ES083712611002", "estado": "BAJA", "explotacion": "ES371261100121"},
        {
            "crotal": "ES083712611003",
            "estado": "ALTA",
            "explotacion": "ES371261100122",
        },  # En MoGa pero no en campo!
        {
            "crotal": "ES083712611088",
            "estado": "ALTA",
            "explotacion": "ES371261100121",
        },  # Baja local pero alta en MoGa
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


def test_parsear_xlsx_animales_moga_real():
    import os

    from src.application.moga_conciliator import parsear_xlsx_animales_moga

    path_121 = "Example-data/121/animales.xlsx"
    path_122 = "Example-data/122/animales.xlsx"
    if os.path.exists(path_121) and os.path.exists(path_122):
        anim_121 = parsear_xlsx_animales_moga(path_121)
        anim_122 = parsear_xlsx_animales_moga(path_122)
        assert len(anim_121) == 200
        assert len(anim_122) == 41
        assert anim_121[0]["crotal"].startswith("ES")
        assert anim_122[0]["crotal"].startswith("ES")
        # Verificar campo id_electronico
        assert any(a.get("id_electronico") for a in anim_122)
        # Verificar fechas sanitarias
        assert any(a.get("fecha_tuberculosis") for a in anim_121)


def test_parsear_xls_movimientos_moga_real():
    import os

    from src.application.moga_conciliator import parsear_xls_movimientos_moga

    path_121 = "Example-data/121/movimientos.xls"
    path_122 = "Example-data/122/movimientos.xls"
    if os.path.exists(path_121) and os.path.exists(path_122):
        mov_121 = parsear_xls_movimientos_moga(path_121)
        mov_122 = parsear_xls_movimientos_moga(path_122)
        assert len(mov_121) == 398
        assert len(mov_122) == 22
        assert mov_121[0]["numero_registro"] != ""
        assert mov_122[0]["numero_registro"] != ""


def test_auditar_y_aplicar_conciliacion_moga():
    import os
    import sqlite3
    import tempfile

    from src.application.moga_conciliator import (
        aplicar_conciliacion_moga,
        auditar_y_conciliar_moga,
    )

    # Crear BD temporal simulando un animal con crotal erróneo y otro fallecido
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tf:
        db_path = tf.name

    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE animales (
                crotal TEXT PRIMARY KEY,
                crotal_4 TEXT,
                nombre TEXT,
                sexo TEXT,
                raza TEXT,
                fecha_nacimiento TEXT,
                madre_crotal TEXT,
                padre_crotal TEXT,
                estado TEXT,
                vida INTEGER,
                corral TEXT,
                fecha_alta TEXT,
                fecha_ult_parto TEXT,
                total_partos INTEGER
            )
        """)
        cur.execute("""
            CREATE TABLE movimientos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                crotal TEXT,
                fecha TEXT,
                tipo TEXT,
                origen TEXT,
                destino TEXT,
                corral TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE partos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                madre_crotal TEXT,
                fecha_parto TEXT,
                cria_crotal TEXT,
                cria_sexo TEXT,
                incidencias TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE tratamientos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                crotal TEXT,
                fecha_inicio TEXT,
                fecha_fin TEXT,
                medicamento TEXT,
                veterinario TEXT,
                causa TEXT,
                dias_retirada INTEGER,
                fecha_fin_retirada TEXT
            )
        """)

        # Insertar animal con error de dígito de control (ES260800312743 vs oficial ES220800312743)
        cur.execute(
            "INSERT INTO animales (crotal, crotal_4, estado, corral) VALUES ('ES260800312743', '2743', 'A', 'CEBADERO')"
        )
        cur.execute(
            "INSERT INTO movimientos (crotal, fecha, tipo) VALUES ('ES260800312743', '2026-01-17', 'NACIMIENTO')"
        )

        # Insertar animal que falleció en MoGa pero figura como 'A'
        cur.execute(
            "INSERT INTO animales (crotal, crotal_4, estado, corral) VALUES ('ES220800808202', '8202', 'A', 'ESPADAÑA')"
        )

        conn.commit()

        if os.path.exists("Example-data/121") and os.path.exists("Example-data/122"):
            auditoria = auditar_y_conciliar_moga(conn, "Example-data/121", "Example-data/122")
            assert auditoria["resumen"]["errores_digito_control"] >= 1
            assert auditoria["resumen"]["muertes_detectadas_moga"] >= 1

            resultado = aplicar_conciliacion_moga(conn, "Example-data/121", "Example-data/122")
            assert resultado["ok"] is True
            assert resultado["corregidos_crotal"] >= 1
            assert resultado["dados_de_baja"] >= 1

            # Comprobar que el crotal fue corregido al oficial de MoGa
            cur.execute("SELECT crotal, id_electronico FROM animales WHERE crotal_4 = '2743'")
            row = cur.fetchone()
            assert row is not None
            assert row[0] == "ES220800312743"
            # Y que los movimientos en cascada fueron actualizados
            cur.execute("SELECT crotal FROM movimientos WHERE crotal = 'ES220800312743'")
            assert cur.fetchone() is not None

            # Comprobar que el animal fallecido pasó a 'B'
            cur.execute("SELECT estado FROM animales WHERE crotal = 'ES220800808202'")
            assert cur.fetchone()[0] == "B"

    finally:
        conn.close()
        if os.path.exists(db_path):
            os.remove(db_path)
