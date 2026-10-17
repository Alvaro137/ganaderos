from typing import Any, List, Optional, Protocol

from src.domain.models import (
    Animal,
    CotizacionLonja,
    Parto,
    Pesaje,
    RecetaSanitaria,
    TratamientoIndividual,
    Usuario,
)


class LonjaRepository(Protocol):
    def list_cotizaciones(
        self, categoria: Optional[str] = None, fecha_desde: Optional[Any] = None
    ) -> List[CotizacionLonja]:
        ...

    def get_cotizacion_cercana(
        self, fecha_referencia: Any, categoria: str
    ) -> Optional[CotizacionLonja]:
        ...

    def save(self, cotizacion: CotizacionLonja) -> CotizacionLonja:
        ...


class AnimalRepository(Protocol):
    def get_by_crotal(self, crotal: str) -> Optional[Animal]:
        ...

    def list_all(self) -> List[Animal]:
        ...

    def list_activos(self) -> List[Animal]:
        ...

    def list_reproductoras(self) -> List[Animal]:
        ...

    def count_activos(self) -> int:
        ...

class PartoRepository(Protocol):
    def list_by_madre(self, madre_crotal: str) -> List[Parto]:
        ...

    def list_all(self) -> List[Parto]:
        ...

class RecetaRepository(Protocol):
    def list_all(self) -> List[RecetaSanitaria]:
        ...

class PesajeRepository(Protocol):
    def list_by_crotal(self, crotal: str) -> List[Pesaje]:
        ...

    def create(self, pesaje: Pesaje) -> Pesaje:
        ...

    def list_recent(self, limite: int = 50) -> List[Pesaje]:
        ...

class TratamientoRepository(Protocol):
    def list_by_crotal(self, crotal: str) -> List[TratamientoIndividual]:
        ...

    def list_activos(self, fecha_ref: Optional[Any] = None) -> List[TratamientoIndividual]:
        ...

class ExplotacionRepository(Protocol):
    def list_all(self) -> List[dict]:
        ...

class UsuarioRepository(Protocol):
    def get_by_id(self, user_id: str) -> Optional[Usuario]:
        ...

    def list_active(self) -> List[Usuario]:
        ...

    def create(self, usuario: Usuario) -> None:
        ...


class IntentResolver(Protocol):
    def __call__(
        self,
        prompt: str,
        historial: Optional[List[dict]] = None,
        modelo_solicitado: Optional[str] = None,
    ) -> Any:
        ...

