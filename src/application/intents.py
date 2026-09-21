"""Definición y catálogo tipado de intenciones (Intents) del asistente ganadero."""
from enum import Enum


class IntentType(str, Enum):
    """Catálogo cerrado de intenciones operativas sobre la explotación."""
    CONSULTAR_FICHA_ANIMAL = "consultar_ficha_animal"
    LISTAR_ANIMALES_CORRAL = "listar_animales_corral"
    CONSULTAR_PARTOS_MADRE = "consultar_partos_madre"
    LISTAR_VACAS_SIN_PARIR = "listar_vacas_sin_parir"
    CONSULTAR_SUPRESIONES_ACTIVAS = "consultar_supresiones_activas"
    CONSULTAR_MEDICAMENTO_MAS_USADO = "consultar_medicamento_mas_usado"
    LISTAR_ULTIMOS_TRASPASOS = "listar_ultimos_traspasos"
    CONSULTAR_COMPRAS_ALIMENTO = "consultar_compras_alimento"
    CONSULTA_INFORMATIVA_GENERAL = "consulta_informativa_general"


CATALOGO_HERRAMIENTAS_LLM = [
    {
        "type": "function",
        "function": {
            "name": IntentType.CONSULTAR_FICHA_ANIMAL.value,
            "description": "Obtiene la ficha individual completa de un animal a partir de los 4 últimos dígitos de su crotal (ej. '1045', '8549').",
            "parameters": {
                "type": "object",
                "properties": {
                    "crotal_4": {
                        "type": "string",
                        "description": "Los 4 últimos dígitos numéricos del crotal del animal."
                    }
                },
                "required": ["crotal_4"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": IntentType.LISTAR_ANIMALES_CORRAL.value,
            "description": "Lista el censo de animales que se encuentran en un corral, pasto o lote determinado (ej. 'DUEÑA', 'ESPADAÑA', 'CEBADERO').",
            "parameters": {
                "type": "object",
                "properties": {
                    "corral": {
                        "type": "string",
                        "description": "Nombre o fragmento del lote/corral de pasto."
                    },
                    "solo_activos": {
                        "type": "boolean",
                        "description": "Filtrar únicamente animales activos (por defecto true)."
                    }
                },
                "required": ["corral"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": IntentType.CONSULTAR_PARTOS_MADRE.value,
            "description": "Lista el historial de partos, fechas y crías nacidas de una vaca nodriza específica indicada por sus 4 dígitos de crotal.",
            "parameters": {
                "type": "object",
                "properties": {
                    "crotal_4": {
                        "type": "string",
                        "description": "Los 4 dígitos del crotal de la madre."
                    }
                },
                "required": ["crotal_4"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": IntentType.LISTAR_VACAS_SIN_PARIR.value,
            "description": "Lista las vacas adultas activas que aún no han parido o no tienen partos registrados en el censo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "corral": {
                        "type": "string",
                        "description": "Opcional: filtrar por un corral específico."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": IntentType.CONSULTAR_SUPRESIONES_ACTIVAS.value,
            "description": "Consulta los tratamientos veterinarios con periodos de supresión sanitaria de carne actualmente activos (animales que no pueden sacrificarse hoy).",
            "parameters": {
                "type": "object",
                "properties": {
                    "limite": {
                        "type": "integer",
                        "description": "Número máximo de registros a devolver (por defecto 30)."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": IntentType.CONSULTAR_MEDICAMENTO_MAS_USADO.value,
            "description": "Determina qué medicamento veterinario ha sido el más recetado o administrado en la ganadería.",
            "parameters": {
                "type": "object",
                "properties": {
                    "cea": {
                        "type": "string",
                        "description": "Opcional: filtrar por código de explotación (ej. '121' o '122')."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": IntentType.LISTAR_ULTIMOS_TRASPASOS.value,
            "description": "Consulta los últimos traslados de ganado entre explotaciones (especialmente destetes de la 121 de pasto a la 122 de cebo).",
            "parameters": {
                "type": "object",
                "properties": {
                    "origen": {"type": "string", "description": "Filtro de origen (ej. '121')."},
                    "destino": {"type": "string", "description": "Filtro de destino (ej. '122')."},
                    "limite": {"type": "integer", "description": "Límite de registros (defecto 20)."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": IntentType.CONSULTAR_COMPRAS_ALIMENTO.value,
            "description": "Consulta pedidos, kilos e importes de compras de pienso, rastrojeras o materias primas.",
            "parameters": {
                "type": "object",
                "properties": {
                    "alimento": {"type": "string", "description": "Tipo de pienso o término de búsqueda (ej. 'T-3')."},
                    "limite": {"type": "integer", "description": "Límite de registros (defecto 20)."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": IntentType.CONSULTA_INFORMATIVA_GENERAL.value,
            "description": "Proporciona una respuesta concisa a dudas técnicas o asesoramiento ganadero que no requieren consultar la base de datos.",
            "parameters": {
                "type": "object",
                "properties": {
                    "respuesta": {
                        "type": "string",
                        "description": "Texto directo y profesional de respuesta al ganadero."
                    }
                },
                "required": ["respuesta"]
            }
        }
    }
]
