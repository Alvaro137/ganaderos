"""Esquema de base de datos y vocabulario de dominio ganadero para el Asistente IA.

Genera el contexto estructurado de tablas, columnas y valores categóricos válidos
sin filtrar información personal identificable (Zero PII).
"""
from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("ganaderos.ai")

# DDL explícito y comentado de las tablas analíticas de la explotación
ESQUEMA_DDL_ANALYTICS = """
-- Tabla de animales (censo de vacuno)
CREATE TABLE animales (
    crotal TEXT PRIMARY KEY,          -- Crotal oficial completo (ej. 'ES012345678901')
    crotal_4 TEXT NOT NULL,           -- Últimos 4 dígitos del crotal (ej. '1045') para búsqueda rápida
    nombre TEXT,                      -- Nombre coloquial o código
    sexo TEXT,                        -- 'H' (hembra) o 'M' (macho)
    raza TEXT,                        -- Raza (ej. 'LIMUSIN', 'CHAROLES', 'AVILEÑA', 'CRUCE')
    fecha_nacimiento TEXT,            -- Fecha de nacimiento en formato ISO 'YYYY-MM-DD'
    madre_crotal TEXT,                -- Crotal oficial de la madre
    padre_crotal TEXT,                -- Crotal oficial del padre
    estado TEXT NOT NULL,             -- 'A' = Activo / Presente en la explotación, 'B' = Baja (muerto o vendido)
    vida INTEGER NOT NULL,            -- 1 = Reproductor/Vida, 0 = Cebo/Sacrificio
    corral TEXT,                      -- Nombre del lote, cercado o corral de pasto (ej. 'DUEÑA', 'ESPADAÑA', 'CEBADERO', 'VEGA')
    fecha_alta TEXT,                  -- Fecha de alta en la explotación 'YYYY-MM-DD'
    fecha_ult_parto TEXT,             -- Fecha del último parto 'YYYY-MM-DD'
    total_partos INTEGER DEFAULT 0    -- Número total de partos registrados
);

-- Tabla de partos registrados en campo
CREATE TABLE partos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    madre_crotal TEXT NOT NULL,       -- Crotal de la vaca nodriza madre
    fecha_parto TEXT NOT NULL,        -- Fecha del parto 'YYYY-MM-DD'
    cria_crotal TEXT,                 -- Crotal oficial asignado a la cría (si ya lo tiene)
    cria_sexo TEXT,                   -- 'H' (hembra) o 'M' (macho)
    incidencias TEXT                  -- Notas de parto ('NORMAL', 'DISTOCICO', 'GEMELAR', 'MUERTO', etc.)
);

-- Tabla de traslados y movimientos entre corrales y REGA
CREATE TABLE movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    crotal TEXT NOT NULL,             -- Crotal del animal trasladado
    fecha TEXT NOT NULL,              -- Fecha del movimiento 'YYYY-MM-DD'
    tipo TEXT NOT NULL,               -- Tipo ('TRASLADO_INTERNO', 'VENTA', 'BAJA_MUERTE', 'ENTRADA')
    origen TEXT,                      -- Explotación o corral de origen
    destino TEXT,                     -- Explotación o corral de destino
    corral TEXT                       -- Corral resultante tras el movimiento
);

-- Tabla de tratamientos veterinarios y periodos de supresión
CREATE TABLE tratamientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    crotal TEXT NOT NULL,             -- Crotal del animal tratado
    fecha_inicio TEXT NOT NULL,       -- Fecha de inicio del tratamiento 'YYYY-MM-DD'
    fecha_fin TEXT,                   -- Fecha de finalización 'YYYY-MM-DD'
    medicamento TEXT NOT NULL,        -- Fármaco administrado (ej. 'DRAXXIN', 'CEFTIOFUR')
    veterinario TEXT,                 -- Veterinario responsable
    causa TEXT,                       -- Motivo o diagnóstico clínico
    dias_retirada INTEGER DEFAULT 0,  -- Días de espera obligatorios antes del sacrificio
    fecha_fin_retirada TEXT           -- Fecha en que el animal vuelve a ser apto para consumo 'YYYY-MM-DD'
);

-- Tabla de recetas oficiales
CREATE TABLE recetas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,              -- Fecha de la receta 'YYYY-MM-DD'
    receta TEXT NOT NULL,             -- Número de receta oficial
    medicamento TEXT NOT NULL,        -- Medicamento prescrito
    unidades REAL,                    -- Cantidad de envases o dosis
    dosis_unitaria REAL,
    n_animales INTEGER,               -- Número de animales prescritos
    veterinario TEXT,
    tiempo_carne INTEGER,             -- Días de espera en carne
    proveedor TEXT,
    cea TEXT                          -- Código de explotación (ej. 'ES371261100121')
);

-- Tabla de compras de alimentación y piensos
CREATE TABLE compras_alimento (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,              -- Fecha del albarán/compra 'YYYY-MM-DD'
    alimento TEXT NOT NULL,           -- Descripción del alimento ('PIENSO CEBO', 'PAJA', 'TACO', etc.)
    kg REAL NOT NULL,                 -- Kilogramos comprados
    importe REAL,                     -- Importe total en euros (€)
    precio_kg REAL,                   -- Precio por kilo (€/kg)
    albaran TEXT,                     -- Número de albarán
    proveedor TEXT                    -- Proveedor o fabricante
);

-- Tabla de liquidaciones de matadero (ventas de canales vacunas)
CREATE TABLE ventas_liquidaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_factura TEXT UNIQUE NOT NULL, -- Número de factura del matadero/cooperativa
    fecha_factura TEXT NOT NULL,         -- Fecha de liquidación 'YYYY-MM-DD'
    cliente_cooperativa TEXT,            -- Cooperativa o matadero (ej. 'GANAVAEX, S.COOP')
    total_cabezas REAL,                  -- Número de cabezas sacrificadas en el lote
    total_kilos_canal REAL,              -- Kilos totales en canal
    base_imponible REAL,                 -- Base imponible (€)
    total_factura REAL                   -- Total liquidado (€)
);

-- Tabla de desglose de canales individuales vendidas
CREATE TABLE ventas_canales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    factura_id INTEGER REFERENCES ventas_liquidaciones(id),
    linea_numero INTEGER,
    articulo TEXT,                    -- Categoría comercial ('AÑOJO', 'TERNERA', 'VACA')
    cabezas REAL DEFAULT 1.0,
    peso_canal_kg REAL,               -- Peso de la canal en kilogramos (ej. 320.5)
    precio_unitario REAL,             -- Precio por kilo de canal (€/kg)
    importe_linea REAL,               -- Importe total de la canal (€)
    crotal_asignado TEXT              -- Crotal del animal correspondiente (si está asignado)
);

-- Tabla de cotizaciones de lonja agropecuaria
CREATE TABLE cotizaciones_lonja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,              -- Fecha de cotización semanal 'YYYY-MM-DD'
    lonja TEXT DEFAULT 'SALAMANCA',   -- Nombre de la lonja
    mesa TEXT NOT NULL,               -- Mesa de cotización ('VACUNO DE CARNE', 'VACUNO DE VIDA', etc.)
    categoria TEXT NOT NULL,          -- Categoría cotizada
    unidad TEXT NOT NULL,             -- Unidad de cotización ('€/kg canal', '€/cabeza')
    precio REAL NOT NULL,             -- Cotización oficial
    variacion REAL DEFAULT 0.0        -- Variación respecto a la semana previa
);
""".strip()


def obtener_esquema_ddl() -> str:
    """Devuelve la especificación DDL limpia y documentada de la base de datos."""
    return ESQUEMA_DDL_ANALYTICS


def obtener_vocabulario_dominio(db_path: Optional[Path] = None) -> dict[str, list[Any]]:
    """Extrae valores categóricos reales de la base de datos para guiar al LLM sin filtrar datos privados."""
    vocabulario: dict[str, list[Any]] = {
        "corrales": ["DUEÑA", "ESPADAÑA", "CEBADERO", "VEGA", "RIVERA", "CEREZAL", "CIPEREZ"],
        "razas": ["LIMUSIN", "CHAROLES", "AVILEÑA", "RETINTA", "BERRENDA", "CRUCE"],
        "sexos": ["H", "M"],
        "estados": ["A", "B"],
        "tipos_movimiento": ["TRASLADO_INTERNO", "VENTA", "BAJA_MUERTE", "ENTRADA"],
    }

    if not db_path or not db_path.exists():
        return vocabulario

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cursor = conn.cursor()

        # Extraer corrales reales
        cursor.execute("SELECT DISTINCT corral FROM animales WHERE corral IS NOT NULL AND TRIM(corral) != '' ORDER BY corral")
        corrales = [row[0].strip().upper() for row in cursor.fetchall() if row[0]]
        if corrales:
            vocabulario["corrales"] = corrales

        # Extraer razas reales
        cursor.execute("SELECT DISTINCT raza FROM animales WHERE raza IS NOT NULL AND TRIM(raza) != '' ORDER BY raza")
        razas = [row[0].strip().upper() for row in cursor.fetchall() if row[0]]
        if razas:
            vocabulario["razas"] = razas

        # Extraer medicamentos comunes
        cursor.execute("SELECT DISTINCT medicamento FROM tratamientos WHERE medicamento IS NOT NULL ORDER BY medicamento LIMIT 10")
        meds = [row[0].strip() for row in cursor.fetchall() if row[0]]
        if meds:
            vocabulario["medicamentos"] = meds

        conn.close()
    except Exception as e:
        logger.warning(f"[Domain Schema] No se pudieron extraer vocabularios de {db_path}: {e}")

    return vocabulario


def construir_system_prompt_sql(db_path: Optional[Path] = None) -> str:
    """Construye el system prompt de grounding para el agente Text-to-SQL autónomo."""
    vocab = obtener_vocabulario_dominio(db_path)
    corrales_str = ", ".join(f"'{c}'" for c in vocab["corrales"][:15])
    razas_str = ", ".join(f"'{r}'" for r in vocab["razas"][:10])

    return f"""Eres el Asistente Analítico Experto de Ganaderos Campo, una explotación de vacuno de carne en pastos.
Tu función es convertir las consultas en lenguaje natural del ganadero en sentencias SQL SQLite precisas y de solo lectura.

REGLAS ESTRICTAS DE SQL:
1. Genera EXCLUSIVAMENTE una sentencia SELECT o WITH ... SELECT.
2. NUNCA generes INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, ATTACH, DETACH ni PRAGMA.
3. Para buscar por crotal de 4 dígitos (ej. "1045", "vaca 8549"), filtra por la columna `crotal_4 = '1045'` o `crotal LIKE '%1045'`.
4. El estado del animal es: `estado = 'A'` para animales activos / presentes en la finca; `estado = 'B'` para animales de baja (muertos o vendidos).
5. Corrales y lotes conocidos: {corrales_str}. Usa `UPPER(corral) LIKE '%NOMBRE%'` para tolerancia a mayúsculas/minúsculas.
6. Razas conocidas: {razas_str}.
7. Para preguntas de tipo "cuántos" o "censo", utiliza funciones de agregación como `COUNT(*)`, `SUM()`, `AVG()` con alias descriptivos (ej. `SELECT COUNT(*) AS total_cabezas...`).
8. Respeta las relaciones:
   - Partos de una madre: `partos.madre_crotal = animales.crotal`.
   - Rendimiento en matadero: une `ventas_canales` con `ventas_liquidaciones` por `ventas_canales.factura_id = ventas_liquidaciones.id`.
9. Si la pregunta es puramente informativa/conceptual y no requiere datos de la base de datos (ej. "¿qué es el tiempo de supresión?"), responde directamente sin generar código SQL.

FORMATO DE RESPUESTA:
Si la consulta requiere datos de la base de datos, responde ÚNICAMENTE con un objeto JSON en este formato:
```json
{{
  "sql": "SELECT ...",
  "interpretacion": "Breve descripción en una frase de lo que busca la consulta",
  "tipo_resultado": "animales" | "conteo" | "compras" | "recetas" | "general"
}}
```

Si la consulta es puramente conceptual o informativa, responde con:
```json
{{
  "sql": null,
  "interpretacion": "Información general:",
  "respuesta_directa": "Tu explicación ganadera clara y directa.",
  "tipo_resultado": "general"
}}
```

ESQUEMA DE BASE DE DATOS SQLITE:
{ESQUEMA_DDL_ANALYTICS}
"""
