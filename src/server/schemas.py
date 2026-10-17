from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str

class UserSummary(BaseModel):
    id: str
    nombre: str
    rol: str

class UsersListResponse(BaseModel):
    ok: bool = True
    users: List[UserSummary]

class LoginRequest(BaseModel):
    password: str
    user_id: Optional[str] = None  # Operador seleccionado (solo atribución, sin roles)

class AuthTokenResponse(BaseModel):
    ok: bool
    token: Optional[str] = None
    user: Optional[UserSummary] = None
    message: Optional[str] = None
    error: Optional[str] = None

class IntentRequest(BaseModel):
    prompt: str
    historial: List[Dict[str, Any]] = Field(default_factory=list)
    model_id: Optional[str] = "auto"

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

class SyncChange(BaseModel):
    uuid: str = Field(min_length=8, max_length=64)
    tipo: str
    crotal: Optional[str] = None
    ts_dispositivo: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None

class SyncPushRequest(BaseModel):
    device_id: str = Field(min_length=4, max_length=64)
    changes: List[SyncChange] = Field(default_factory=list)

class SyncStatusResponse(BaseModel):
    ok: bool = True
    epoch: int
    actualizado_en: Optional[str] = None
    registros_campo: int = 0
    fecha_exportacion: Optional[str] = None
    existe_bd: bool = True
    hay_novedades: Optional[bool] = None
    url_pull: str = "/api/database"

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)

class ChangePasswordResponse(BaseModel):
    ok: bool = True
    message: Optional[str] = None
    cookie_invalidated: Optional[bool] = None

class LogEntry(BaseModel):
    timestamp: str
    level: str
    logger: str
    message: str

class AdminLogsResponse(BaseModel):
    ok: bool = True
    log_dir: str
    log_file: Optional[str] = None
    current_level: str
    total_buffered: int
    logs: List[LogEntry]

class SetLogLevelRequest(BaseModel):
    level: str = Field(pattern=r"^(DEBUG|INFO|WARNING|ERROR|CRITICAL)$")

class SetLogLevelResponse(BaseModel):
    ok: bool = True
    previous_level: str
    new_level: str

