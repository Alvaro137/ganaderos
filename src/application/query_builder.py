"""Constructor determinista de consultas SQL parametrizadas a partir de intents tipados."""
from dataclasses import dataclass
from typing import Any, Optional

from src.application.intents import IntentType


@dataclass(frozen=True)
class QueryResult:
    """Resultado de la resolución del intent listo para ejecución en el cliente."""
    sql: Optional[str]
    params: list[Any]
    interpretacion: str
    tipo_resultado: str
    respuesta_directa: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "sql": self.sql,
            "params": self.params,
            "interpretacion": self.interpretacion,
            "tipo_resultado": self.tipo_resultado,
            "respuesta_directa": self.respuesta_directa,
        }


def construir_consulta_intent(nombre_intent: str, args: dict[str, Any]) -> QueryResult:
    """Traduce un intent validado a una sentencia SELECT segura y parametrizada."""

    if nombre_intent == IntentType.CONSULTAR_FICHA_ANIMAL.value:
        c4 = str(args.get("crotal_4", "")).strip()[-4:]
        sql = """
            SELECT * FROM animales
            WHERE crotal_4 = ? AND estado = 'A'
            ORDER BY fecha_nacimiento DESC
            LIMIT 1
        """.strip()
        return QueryResult(
            sql=sql,
            params=[c4],
            interpretacion=f"Ficha técnica de la cabeza con crotal terminación {c4}.",
            tipo_resultado="animales"
        )

    elif nombre_intent == IntentType.LISTAR_ANIMALES_CORRAL.value:
        corral = str(args.get("corral", "")).strip().upper()
        solo_activos = args.get("solo_activos", True)
        filtro_estado = "AND estado = 'A'" if solo_activos else ""
        sql = f"""
            SELECT * FROM animales
            WHERE UPPER(corral) LIKE ? {filtro_estado}
            ORDER BY crotal_4 ASC
        """.strip()
        return QueryResult(
            sql=sql,
            params=[f"%{corral}%"],
            interpretacion=f"Animales censados en el lote o corral {corral}.",
            tipo_resultado="animales"
        )

    elif nombre_intent == IntentType.CONSULTAR_PARTOS_MADRE.value:
        c4 = str(args.get("crotal_4", "")).strip()[-4:]
        sql = """
            SELECT
                p.id,
                p.fecha_parto,
                p.cria_crotal,
                p.cria_sexo,
                p.incidencias,
                a.crotal_4 AS cria_crotal_4,
                a.raza AS cria_raza,
                a.estado AS cria_estado,
                a.corral AS cria_corral
            FROM partos p
            LEFT JOIN animales a ON p.cria_crotal = a.crotal
            WHERE p.madre_crotal IN (
                SELECT crotal FROM animales WHERE crotal_4 = ?
            )
            ORDER BY p.fecha_parto DESC
        """.strip()
        return QueryResult(
            sql=sql,
            params=[c4],
            interpretacion=f"Historial genealógico y partos de la madre con crotal {c4}.",
            tipo_resultado="partos"
        )

    elif nombre_intent == IntentType.LISTAR_VACAS_SIN_PARIR.value:
        corral = args.get("corral")
        params: list[Any] = []
        filtro_corral = ""
        if corral:
            filtro_corral = "AND UPPER(corral) LIKE ?"
            params.append(f"%{str(corral).strip().upper()}%")

        sql = f"""
            SELECT * FROM animales
            WHERE (sexo = 'Vaca' OR sexo LIKE 'Hembra%')
              AND estado = 'A'
              AND (fecha_ult_parto IS NULL OR fecha_ult_parto = '' OR total_partos = 0)
              {filtro_corral}
            ORDER BY fecha_nacimiento ASC
        """.strip()
        return QueryResult(
            sql=sql,
            params=params,
            interpretacion="Vacas nodrizas adultas activas sin partos registrados.",
            tipo_resultado="animales"
        )

    elif nombre_intent == IntentType.CONSULTAR_SUPRESIONES_ACTIVAS.value:
        limite = int(args.get("limite", 30))
        sql = """
            SELECT
                r.id,
                r.fecha,
                r.receta,
                r.medicamento,
                r.n_animales,
                r.tiempo_carne,
                r.veterinario,
                r.cea,
                date(r.fecha, '+' || CAST(r.tiempo_carne AS TEXT) || ' days') AS fin_supresion
            FROM recetas r
            WHERE r.tiempo_carne > 0
              AND date(r.fecha, '+' || CAST(r.tiempo_carne AS TEXT) || ' days') >= date('now')
            ORDER BY fin_supresion ASC
            LIMIT ?
        """.strip()
        return QueryResult(
            sql=sql,
            params=[limite],
            interpretacion="Tratamientos veterinarios con periodos de retirada sanitaria activos.",
            tipo_resultado="recetas"
        )

    elif nombre_intent == IntentType.CONSULTAR_MEDICAMENTO_MAS_USADO.value:
        cea = args.get("cea")
        params = []
        filtro_cea = ""
        if cea:
            filtro_cea = "WHERE cea LIKE ?"
            params.append(f"%{str(cea).strip()}%")

        sql = f"""
            SELECT
                medicamento,
                COUNT(*) AS total_recetas,
                SUM(n_animales) AS animales_tratados,
                MAX(tiempo_carne) AS max_supresion_dias
            FROM recetas
            {filtro_cea}
            GROUP BY medicamento
            ORDER BY total_recetas DESC
            LIMIT 10
        """.strip()
        return QueryResult(
            sql=sql,
            params=params,
            interpretacion="Medicamentos veterinarios con mayor frecuencia de administración.",
            tipo_resultado="conteo"
        )

    elif nombre_intent == IntentType.LISTAR_ULTIMOS_TRASPASOS.value:
        origen = args.get("origen", "121")
        destino = args.get("destino", "122")
        limite = int(args.get("limite", 20))
        sql = """
            SELECT
                m.id,
                m.crotal,
                m.fecha,
                m.tipo,
                m.origen,
                m.destino,
                m.corral,
                a.crotal_4,
                a.sexo,
                a.raza
            FROM movimientos m
            LEFT JOIN animales a ON m.crotal = a.crotal
            WHERE m.origen LIKE ? AND m.destino LIKE ?
            ORDER BY m.fecha DESC
            LIMIT ?
        """.strip()
        return QueryResult(
            sql=sql,
            params=[f"%{origen}%", f"%{destino}%", limite],
            interpretacion=f"Últimos traspasos de ganado registrados desde {origen} hacia {destino}.",
            tipo_resultado="movimientos"
        )

    elif nombre_intent == IntentType.CONSULTAR_COMPRAS_ALIMENTO.value:
        alimento = args.get("alimento")
        limite = int(args.get("limite", 20))
        params = []
        filtro_alim = ""
        if alimento:
            filtro_alim = "WHERE UPPER(alimento) LIKE ?"
            params.append(f"%{str(alimento).strip().upper()}%")
        params.append(limite)

        sql = f"""
            SELECT
                id,
                fecha,
                alimento,
                kg,
                importe,
                precio_kg,
                albaran,
                proveedor
            FROM compras_alimento
            {filtro_alim}
            ORDER BY fecha DESC
            LIMIT ?
        """.strip()
        return QueryResult(
            sql=sql,
            params=params,
            interpretacion="Albaranes y pedidos de alimentación de ganado.",
            tipo_resultado="compras"
        )

    elif nombre_intent == IntentType.CONSULTA_INFORMATIVA_GENERAL.value:
        texto = str(args.get("respuesta", "Consulta resuelta.")).strip()
        return QueryResult(
            sql=None,
            params=[],
            interpretacion="Respuesta informativa técnica.",
            tipo_resultado="texto",
            respuesta_directa=texto
        )

    # Fallback genérico de seguridad
    return QueryResult(
        sql=None,
        params=[],
        interpretacion="No se pudo determinar una acción concreta.",
        tipo_resultado="texto",
        respuesta_directa="No se reconoció la consulta en el catálogo operativo de la explotación."
    )
