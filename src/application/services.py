import hashlib
import hmac
from dataclasses import dataclass
from datetime import date
from typing import Any, List, Optional

from src.application.query_builder import QueryResult
from src.domain.models import Animal, Parto, RecetaSanitaria, Usuario
from src.domain.repositories import (
    AnimalRepository,
    PartoRepository,
    RecetaRepository,
    UsuarioRepository,
)


class CensoService:
    def __init__(self, animal_repo: AnimalRepository):
        self.animal_repo = animal_repo

    def get_animal_by_crotal(self, crotal: str) -> Optional[Animal]:
        return self.animal_repo.get_by_crotal(crotal)

    def list_activos(self) -> List[Animal]:
        return [a for a in self.animal_repo.list_all() if a.es_activo]

    def list_reproductoras(self) -> List[Animal]:
        return [a for a in self.animal_repo.list_all() if a.es_reproductora]


class SanidadService:
    def __init__(self, receta_repo: RecetaRepository):
        self.receta_repo = receta_repo

    def get_recetas_activas(self, fecha_referencia: Optional[date] = None) -> List[RecetaSanitaria]:
        ref = fecha_referencia or date.today()
        recetas = self.receta_repo.list_all()
        return [r for r in recetas if r.fecha_limite_carne() and r.fecha_limite_carne() >= ref]


class GenealogiaService:
    def __init__(self, animal_repo: AnimalRepository, parto_repo: PartoRepository):
        self.animal_repo = animal_repo
        self.parto_repo = parto_repo

    def get_partos_by_madre(self, madre_crotal: str) -> List[Parto]:
        return self.parto_repo.list_by_madre(madre_crotal)

    def check_vacas_sin_parir(self, dias_max: int = 400) -> List[Animal]:
        vacas = [a for a in self.animal_repo.list_all() if a.es_reproductora]
        problematicas = []
        hoy = date.today()
        for vaca in vacas:
            if vaca.fecha_ult_parto:
                dias_desde_parto = (hoy - vaca.fecha_ult_parto).days
                if dias_desde_parto > dias_max:
                    problematicas.append(vaca)
            elif vaca.edad_anios(hoy) > 3.0: # Más de 3 años sin primer parto
                problematicas.append(vaca)
        return problematicas


@dataclass
class AsistenteResultado:
    intent: str
    args: dict[str, Any]
    query_result: QueryResult
    offline_mode: bool = False


class AsistenteService:
    """Servicio de aplicación para coordinar el Asistente IA en lenguaje natural."""

    def __init__(self, intent_resolver: Any, query_builder: Any):
        self.intent_resolver = intent_resolver
        self.query_builder = query_builder

    def procesar_intencion(
        self,
        prompt: str,
        historial: Optional[List[dict]] = None,
        modelo_solicitado: Optional[str] = None,
    ) -> Optional[AsistenteResultado]:
        """Coordina la resolución de intenciones y la generación de consultas SQL/respuestas.

        Retorna un AsistenteResultado con el intent, argumentos y QueryResult,
        o None si no se pudo resolver la intención.
        """
        if not self.intent_resolver or not self.query_builder:
            raise RuntimeError("AsistenteService no tiene configurados los resolvers necesarios.")

        try:
            if modelo_solicitado is not None:
                nombre_intent, args, offline_mode = self.intent_resolver(
                    prompt, historial, modelo_solicitado=modelo_solicitado
                )
            else:
                nombre_intent, args, offline_mode = self.intent_resolver(prompt, historial)
        except TypeError:
            nombre_intent, args, offline_mode = self.intent_resolver(prompt, historial)

        if not nombre_intent:
            return None

        query_result = self.query_builder(nombre_intent, args)
        return AsistenteResultado(
            intent=nombre_intent,
            args=args,
            query_result=query_result,
            offline_mode=offline_mode,
        )


class UsuarioService:
    """Servicio de aplicación para gestión y autenticación rápida de operarios."""

    def __init__(self, usuario_repo: UsuarioRepository):
        self.usuario_repo = usuario_repo

    def list_active(self) -> List[Usuario]:
        return self.usuario_repo.list_active()

    def get_by_id(self, user_id: str) -> Optional[Usuario]:
        return self.usuario_repo.get_by_id(user_id)

    def autenticar_pin(self, user_id: str, pin: str) -> Optional[Usuario]:
        usuario = self.usuario_repo.get_by_id(user_id)
        if not usuario or not usuario.activo:
            return None
        pin_hash = hashlib.sha256(f"{user_id}:{pin}".encode()).hexdigest()
        if hmac.compare_digest(usuario.pin_hash, pin_hash):
            return usuario
        return None

