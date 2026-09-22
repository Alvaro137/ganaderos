from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str

class LoginRequest(BaseModel):
    password: str

class AuthTokenResponse(BaseModel):
    ok: bool
    token: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None

class IntentRequest(BaseModel):
    prompt: str
    historial: List[Dict[str, Any]] = Field(default_factory=list)

class IntentResponse(BaseModel):
    ok: bool
    intent: str
    args: Dict[str, Any]
    sql: str
    params: tuple
    interpretacion: str
    tipo_resultado: str
    respuesta_directa: Optional[str] = None
    offline_mode: bool
    error: Optional[str] = None

class AIModelItem(BaseModel):
    id: str
    name: str

class AIModelResponse(BaseModel):
    ok: bool = True
    models: List[AIModelItem]

class SynthesizeRequest(BaseModel):
    prompt: str
    data: List[Dict[str, Any]] = Field(default_factory=list)
    columns: Optional[List[str]] = None
    history: Optional[List[Dict[str, Any]]] = None
    model_id: Optional[str] = "auto"

class SynthesizeResponse(BaseModel):
    ok: bool = True
    sintesis: str

class AnimalResponse(BaseModel):
    crotal: str
    nombre: Optional[str]
    sexo: str
    raza: str
    fecha_nacimiento: str
    estado: str
    corral: Optional[str]
    edad_anios: float
