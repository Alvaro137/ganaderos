"""Capa de Infraestructura: Adaptadores para Access, SQLite y Pasarela LLM."""
from src.infrastructure.access_reader import conexion_access, detectar_ruta_bd, leer_animales
from src.infrastructure.llm_gateway import (
    clasificar_intencion_groq,
    resolver_intencion_usuario,
)
from src.infrastructure.sqlite_builder import inicializar_bd_sqlite, optimizar_bd

__all__ = [
    "conexion_access",
    "detectar_ruta_bd",
    "leer_animales",
    "inicializar_bd_sqlite",
    "optimizar_bd",
    "clasificar_intencion_groq",
    "resolver_intencion_usuario",
]
