from typing import List, Optional, Protocol

from src.domain.models import Animal, Parto, RecetaSanitaria, Usuario


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

class UsuarioRepository(Protocol):
    def get_by_id(self, user_id: str) -> Optional[Usuario]:
        ...

    def list_active(self) -> List[Usuario]:
        ...

    def create(self, usuario: Usuario) -> None:
        ...

