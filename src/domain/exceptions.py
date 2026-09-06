"""Excepciones de negocio de la capa de dominio ganadero."""

class DomainError(Exception):
    """Excepción base para violaciones de reglas de negocio del dominio."""
    pass


class CrotalInvalidoError(DomainError):
    """Lanzada cuando un identificador de crotal no cumple la norma oficial."""
    pass


class ExplotacionInvalidaError(DomainError):
    """Lanzada cuando un código REGA/CEA no es válido o está mal estructurado."""
    pass


class SupresionActivaError(DomainError):
    """Lanzada cuando un animal está en periodo de retirada sanitaria y no puede ser movido/sacrificado."""
    pass
