from typing import List, Optional, Protocol

from src.domain.models import Animal, Parto, RecetaSanitaria


class AnimalRepository(Protocol):
    def get_by_crotal(self, crotal: str) -> Optional[Animal]:
        ...

    def list_all(self) -> List[Animal]:
        ...

class PartoRepository(Protocol):
    def list_by_madre(self, madre_crotal: str) -> List[Parto]:
        ...

    def list_all(self) -> List[Parto]:
        ...

class RecetaRepository(Protocol):
    def list_all(self) -> List[RecetaSanitaria]:
        ...

class ExplotacionRepository(Protocol):
    def list_all(self) -> List[dict]:
        ...
