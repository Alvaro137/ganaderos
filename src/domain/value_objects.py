"""Objetos de valor (Value Objects) inmutables del dominio ganadero."""
from dataclasses import dataclass
from datetime import date, timedelta
import re
from typing import Optional

from src.domain.exceptions import CrotalInvalidoError, ExplotacionInvalidaError


@dataclass(frozen=True)
class Crotal:
    """Identificador oficial e inmutable de identificación animal (bovino).
    
    Estructura en España: Prefijo país (ES) + 12 dígitos numéricos (Total: 14 caracteres).
    Los últimos 4 dígitos son el identificador operativo rápido en campo (crotal_4).
    """
    codigo: str

    def __post_init__(self):
        limpio = self.codigo.strip().upper()
        if not re.match(r"^ES\d{12}$", limpio):
            raise CrotalInvalidoError(
                f"Crotal '{self.codigo}' no cumple el formato oficial español (ES + 12 dígitos)."
            )
        object.__setattr__(self, "codigo", limpio)

    @property
    def crotal_4(self) -> str:
        """Devuelve los 4 últimos dígitos utilizados en la operativa diaria de campo."""
        return self.codigo[-4:]

    def __str__(self) -> str:
        return self.codigo


@dataclass(frozen=True)
class PeriodoSupresion:
    """Periodo de retirada sanitaria obligatorio tras administrar un medicamento veterinario.
    
    Evita la entrada en la cadena alimentaria de carne o leche con residuos farmacológicos.
    """
    dias_carne: int
    dias_leche: int = 0

    def __post_init__(self):
        if self.dias_carne < 0 or self.dias_leche < 0:
            raise ValueError("Los días de supresión no pueden ser negativos.")

    def calcular_fin_carne(self, fecha_tratamiento: date) -> Optional[date]:
        """Calcula la fecha exacta a partir de la cual el animal puede sacrificarse."""
        if self.dias_carne == 0:
            return None
        return fecha_tratamiento + timedelta(days=self.dias_carne)

    def esta_en_supresion(self, fecha_tratamiento: date, fecha_referencia: Optional[date] = None) -> bool:
        """Indica si el animal se encuentra hoy bajo periodo de retirada activo."""
        if self.dias_carne == 0:
            return False
        ref = fecha_referencia or date.today()
        fin = self.calcular_fin_carne(fecha_tratamiento)
        return bool(fin and fin >= ref)


@dataclass(frozen=True)
class ExplotacionCEA:
    """Código de Explotación Agraria / REGA oficial.
    
    Diferencia ciclo cerrado/vida (121) de cebadero/engorde (122) y traslados internos.
    """
    codigo: str

    def __post_init__(self):
        limpio = self.codigo.strip().upper()
        if not re.match(r"^ES\d{10,12}$", limpio):
            raise ExplotacionInvalidaError(
                f"Código CEA/REGA '{self.codigo}' inválido. Debe comenzar por ES y contener 10-12 dígitos."
            )
        object.__setattr__(self, "codigo", limpio)

    @property
    def es_vida(self) -> bool:
        """Determina si es la explotación de cría y reproducción en extensivo."""
        return self.codigo.endswith("121")

    @property
    def es_cebo(self) -> bool:
        """Determina si es el cebadero de engorde."""
        return self.codigo.endswith("122")

    @property
    def es_explotacion_propia(self) -> bool:
        """Indica si la explotación pertenece a la propia ganadería (incluye fincas históricas)."""
        return any(self.codigo.endswith(sufijo) for sufijo in ("121", "122", "671", "591"))

    def __str__(self) -> str:
        return self.codigo
