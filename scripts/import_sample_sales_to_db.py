import json
import sqlite3
from pathlib import Path

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS ventas_liquidaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_factura TEXT UNIQUE NOT NULL,
    fecha_factura TEXT,
    fecha_pago TEXT,
    cliente_cooperativa TEXT DEFAULT 'GANAVAEX, S.COOP',
    cif_cliente TEXT DEFAULT 'F37335411',
    total_cabezas REAL,
    total_kilos_canal REAL,
    base_imponible REAL,
    porcentaje_iva REAL DEFAULT 10.50,
    cuota_iva REAL,
    gastos_total REAL,
    total_factura REAL,
    archivo_origen TEXT
);

CREATE TABLE IF NOT EXISTS ventas_canales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factura_id INTEGER REFERENCES ventas_liquidaciones(id) ON DELETE CASCADE,
    linea_numero INTEGER,
    articulo TEXT,
    cabezas REAL DEFAULT 1.0,
    peso_canal_kg REAL,
    precio_unitario REAL,
    importe_linea REAL,
    referencia TEXT,
    fecha_salida_lote TEXT,
    crotal_asignado TEXT
);

CREATE TABLE IF NOT EXISTS ventas_gastos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factura_id INTEGER REFERENCES ventas_liquidaciones(id) ON DELETE CASCADE,
    concepto TEXT,
    importe REAL
);

CREATE INDEX IF NOT EXISTS idx_ventas_factura ON ventas_canales(factura_id);
CREATE INDEX IF NOT EXISTS idx_ventas_crotal ON ventas_canales(crotal_asignado);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas_liquidaciones(fecha_factura);
"""


def importar_liquidaciones(db_path: Path, json_path: Path):
    with open(json_path, "r", encoding="utf-8") as f:
        facturas = json.load(f)

    conn = sqlite3.connect(str(db_path))
    with conn:
        conn.executescript(SCHEMA_SQL)
        cursor = conn.cursor()

        insertados = 0
        actualizados = 0

        for f in facturas:
            num = f["numero_factura"]
            cursor.execute("SELECT id FROM ventas_liquidaciones WHERE numero_factura = ?", (num,))
            row = cursor.fetchone()

            if row:
                fid = row[0]
                actualizados += 1
                cursor.execute(
                    """
                    UPDATE ventas_liquidaciones SET
                        fecha_factura = ?, fecha_pago = ?, cliente_cooperativa = ?, cif_cliente = ?,
                        total_cabezas = ?, total_kilos_canal = ?, base_imponible = ?, porcentaje_iva = ?,
                        cuota_iva = ?, gastos_total = ?, total_factura = ?, archivo_origen = ?
                    WHERE id = ?
                """,
                    (
                        f.get("fecha_factura"),
                        f.get("fecha_pago"),
                        f.get("cliente_cooperativa", "GANAVAEX, S.COOP"),
                        f.get("cif_cliente", "F37335411"),
                        f.get("total_cabezas"),
                        f.get("total_kilos_canal"),
                        f.get("base_imponible"),
                        f.get("porcentaje_iva", 10.5),
                        f.get("cuota_iva"),
                        f.get("gastos_total"),
                        f.get("total_factura"),
                        f.get("archivo_origen"),
                        fid,
                    ),
                )
                cursor.execute("DELETE FROM ventas_canales WHERE factura_id = ?", (fid,))
                cursor.execute("DELETE FROM ventas_gastos WHERE factura_id = ?", (fid,))
            else:
                insertados += 1
                cursor.execute(
                    """
                    INSERT INTO ventas_liquidaciones (
                        numero_factura, fecha_factura, fecha_pago, cliente_cooperativa, cif_cliente,
                        total_cabezas, total_kilos_canal, base_imponible, porcentaje_iva,
                        cuota_iva, gastos_total, total_factura, archivo_origen
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        num,
                        f.get("fecha_factura"),
                        f.get("fecha_pago"),
                        f.get("cliente_cooperativa", "GANAVAEX, S.COOP"),
                        f.get("cif_cliente", "F37335411"),
                        f.get("total_cabezas"),
                        f.get("total_kilos_canal"),
                        f.get("base_imponible"),
                        f.get("porcentaje_iva", 10.5),
                        f.get("cuota_iva"),
                        f.get("gastos_total"),
                        f.get("total_factura"),
                        f.get("archivo_origen"),
                    ),
                )
                fid = cursor.lastrowid

            for canal in f.get("lineas_animales", []):
                cursor.execute(
                    """
                    INSERT INTO ventas_canales (
                        factura_id, linea_numero, articulo, cabezas, peso_canal_kg,
                        precio_unitario, importe_linea, referencia, fecha_salida_lote, crotal_asignado
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                    (
                        fid,
                        canal.get("linea_numero"),
                        canal.get("articulo"),
                        canal.get("cabezas", 1.0),
                        canal.get("peso_canal_kg"),
                        canal.get("precio_unitario"),
                        canal.get("importe_linea"),
                        canal.get("referencia"),
                        canal.get("fecha_salida_lote"),
                        canal.get("crotal_asignado"),
                    ),
                )

            for gasto in f.get("lineas_gastos", []):
                cursor.execute(
                    """
                    INSERT INTO ventas_gastos (factura_id, concepto, importe)
                    VALUES (?, ?, ?)
                """,
                    (fid, gasto.get("concepto"), gasto.get("importe")),
                )

        print(f"Importación completada: {insertados} insertados, {actualizados} actualizados.")

    conn.execute("VACUUM")
    conn.close()


if __name__ == "__main__":
    import sys

    db = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("pwa/ganaderos_demo.sqlite")
    json_path = Path("sample_data/liquidaciones_ganavaex_2024_2026.json")
    importar_liquidaciones(db, json_path)
