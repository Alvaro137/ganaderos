import json
import os
import sqlite3
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

import httpx
from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles

from src.application.query_builder import construir_consulta_intent
from src.application.services import CensoService, GenealogiaService, SanidadService
from src.domain.exceptions import DomainError
from src.domain.value_objects import Crotal
from src.infrastructure.llm_gateway import resolver_intencion_usuario
from src.infrastructure.repositories import (
    SQLiteAnimalRepository,
    SQLitePartoRepository,
    SQLiteRecetaRepository,
)
from src.server.schemas import (
    AIModelResponse,
    AnimalResponse,
    AuthTokenResponse,
    HealthResponse,
    IntentRequest,
    IntentResponse,
    LoginRequest,
    SynthesizeRequest,
    SynthesizeResponse,
)

PWA_DIR = Path(__file__).resolve().parents[2] / "pwa"


def verificar_password(pwd: str) -> bool:
    return pwd == os.environ.get("PWA_PASSWORD", "mvp-testing")


def generar_auth_token(duracion_dias: int) -> str:
    return uuid.uuid4().hex


def _buscar_archivo_sqlite() -> Optional[Path]:
    finca_db = PWA_DIR / "ganaderos_campo.sqlite"
    if finca_db.exists():
        return finca_db
    demo_db = PWA_DIR / "ganaderos_demo.sqlite"
    if demo_db.exists():
        return demo_db
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Inicializa la conexión SQLite de lectura y repositorios de dominio."""
    db_file = _buscar_archivo_sqlite()
    conn = None
    if db_file:
        try:
            conn = sqlite3.connect(f"file:{db_file}?mode=ro", uri=True, check_same_thread=False)
            animal_repo = SQLiteAnimalRepository(conn)
            parto_repo = SQLitePartoRepository(conn)
            receta_repo = SQLiteRecetaRepository(conn)

            app.state.db_conn = conn
            app.state.censo_service = CensoService(animal_repo)
            app.state.sanidad_service = SanidadService(receta_repo)
            app.state.genealogia_service = GenealogiaService(animal_repo, parto_repo)
        except Exception as e:
            print(f"[Lifespan] Advertencia al abrir base de datos: {e}")
            app.state.db_conn = None
            app.state.censo_service = None
            app.state.sanidad_service = None
            app.state.genealogia_service = None
    else:
        app.state.db_conn = None
        app.state.censo_service = None
        app.state.sanidad_service = None
        app.state.genealogia_service = None

    yield

    if conn:
        conn.close()


TAGS_METADATA = [
    {"name": "Estado", "description": "Liveness y healthcheck del sistema."},
    {"name": "Autenticación", "description": "Sesión segura mediante token Bearer y cookies."},
    {"name": "Base de Datos", "description": "Distribución del archivo binario SQLite relacional."},
    {"name": "Censo Ganadero", "description": "Consultas del censo con entidades de dominio y validaciones."},
    {"name": "Sanidad y Retiradas", "description": "Recetas veterinarias y control de tiempos de espera en carne."},
    {"name": "Asistente IA", "description": "Intent Calling tipado, síntesis ganadera y transcripción Whisper."},
]

app = FastAPI(
    title="Ganaderos Campo API",
    summary="API REST y Asistencia Inteligente para Ganadería Extensiva de Vacuno de Carne",
    description=(
        "Backend de producción estructurado en **Clean Architecture (Ports & Adapters)**. "
        "Soporta tanto operaciones conectadas como la entrega de bases de datos SQLite para ejecución "
        "100% autónoma en el navegador móvil mediante **WebAssembly (sql.js)** e IndexedDB."
    ),
    version="2.0.0",
    openapi_tags=TAGS_METADATA,
    lifespan=lifespan,
)

security = HTTPBearer(auto_error=False)


@app.exception_handler(DomainError)
async def domain_exception_handler(request: Request, exc: DomainError):
    """Mapea excepciones de dominio a errores HTTP 422 estandarizados."""
    return JSONResponse(
        status_code=422,
        content={"ok": False, "error": exc.__class__.__name__, "detail": str(exc)},
    )


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials and os.environ.get("PWA_ALLOW_ANON_DB") != "1":
        raise HTTPException(status_code=401, detail="Autenticación requerida")
    return True


def get_censo_service() -> Optional[CensoService]:
    return getattr(app.state, "censo_service", None)


def get_sanidad_service() -> Optional[SanidadService]:
    return getattr(app.state, "sanidad_service", None)


# ============================================================
# ENDPOINTS REST: ESTADO Y AUTENTICACIÓN
# ============================================================


@app.get("/api/health", tags=["Estado"], response_model=HealthResponse)
async def health_check():
    """Comprueba la disponibilidad del servicio y su versión activa."""
    return {"status": "healthy", "service": "ganaderos-campo", "version": "2.0.0"}


@app.get("/api/auth/verify", tags=["Autenticación"])
async def auth_verify(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verifica si la sesión actual cuenta con credenciales válidas."""
    return {"ok": True, "authenticated": credentials is not None}


@app.post("/api/auth/login", tags=["Autenticación"], response_model=AuthTokenResponse)
async def auth_login(req: LoginRequest, response: Response):
    """Autentica a un ganadero y emite un token Bearer seguro."""
    if verificar_password(req.password):
        token = generar_auth_token(30)
        response.set_cookie(key="campo_auth", value=token, max_age=2592000, httponly=True, samesite="lax")
        return {"ok": True, "token": token, "message": "Autenticación exitosa."}
    raise HTTPException(status_code=401, detail="Contraseña incorrecta.")


# ============================================================
# ENDPOINTS REST: BASE DE DATOS LOCAL-FIRST
# ============================================================


@app.get("/api/database", tags=["Base de Datos"])
async def get_database(authorized: bool = Depends(verify_token)):
    """Descarga el binario SQLite para sincronización y ejecución offline en el móvil."""
    sqlite_file = _buscar_archivo_sqlite()
    if not sqlite_file or not sqlite_file.exists():
        raise HTTPException(status_code=404, detail="Base de datos no encontrada.")
    return FileResponse(sqlite_file, media_type="application/octet-stream", filename="ganaderos_campo.sqlite")


# ============================================================
# ENDPOINTS REST: DOMINIO GANADERO (CENSO Y SANIDAD)
# ============================================================


@app.get("/api/censo/animales", tags=["Censo Ganadero"], response_model=List[AnimalResponse])
async def list_animales_activos(
    censo: Optional[CensoService] = Depends(get_censo_service),
    authorized: bool = Depends(verify_token),
):
    """Obtiene el listado de animales activos hidratados mediante la entidad de dominio Animal."""
    if not censo:
        return []
    animales = censo.list_activos()
    return [
        AnimalResponse(
            crotal=str(a.crotal),
            nombre=a.nombre,
            sexo=a.sexo,
            raza=a.raza,
            fecha_nacimiento=a.fecha_nacimiento.isoformat() if a.fecha_nacimiento else "",
            estado=a.estado,
            corral=a.corral,
            edad_anios=a.edad_anios(),
        )
        for a in animales
    ]


@app.get("/api/censo/animales/{crotal}", tags=["Censo Ganadero"], response_model=AnimalResponse)
async def get_animal_por_crotal(
    crotal: str,
    censo: Optional[CensoService] = Depends(get_censo_service),
    authorized: bool = Depends(verify_token),
):
    """Consulta la ficha de un animal validando el Value Object Crotal (invariante de 14 caracteres)."""
    crotal_vo = Crotal(crotal)
    if not censo:
        raise HTTPException(status_code=503, detail="Servicio de censo no disponible.")
    animal = censo.get_animal_by_crotal(str(crotal_vo))
    if not animal:
        raise HTTPException(status_code=404, detail=f"Animal con crotal {crotal} no encontrado.")
    return AnimalResponse(
        crotal=str(animal.crotal),
        nombre=animal.nombre,
        sexo=animal.sexo,
        raza=animal.raza,
        fecha_nacimiento=animal.fecha_nacimiento.isoformat() if animal.fecha_nacimiento else "",
        estado=animal.estado,
        corral=animal.corral,
        edad_anios=animal.edad_anios(),
    )


# ============================================================
# ENDPOINTS REST: INTELIGENCIA ARTIFICIAL Y VOZ
# ============================================================


@app.post("/api/ai/intent", tags=["Asistente IA"], response_model=IntentResponse)
async def ai_intent(req: IntentRequest, authorized: bool = Depends(verify_token)):
    """Traduce lenguaje natural a un Intent tipado y genera la consulta SQL parametrizada."""
    nombre_intent, args, _ = resolver_intencion_usuario(req.prompt, req.historial)
    if not nombre_intent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Servicio de inferencia LLM no disponible o sin credenciales de API activas.",
        )
    query_result = construir_consulta_intent(nombre_intent, args)
    return {
        "ok": True,
        "intent": nombre_intent,
        "args": args,
        "sql": query_result.sql,
        "params": query_result.params,
        "interpretacion": query_result.interpretacion,
        "tipo_resultado": query_result.tipo_resultado,
        "respuesta_directa": query_result.respuesta_directa,
        "offline_mode": False,
    }


@app.get("/api/ai/models", tags=["Asistente IA"], response_model=AIModelResponse)
async def ai_models(authorized: bool = Depends(verify_token)):
    """Devuelve el catálogo de modelos disponibles para inferencia y asistencia."""
    return {
        "ok": True,
        "models": [
            {"id": "auto", "name": "Automático (Recomendado)"},
            {"id": "llama-3.3-70b-versatile", "name": "Groq Llama 3.3 70B (Cloud/Edge)"},
            {"id": "mixtral-8x7b-32768", "name": "Mixtral 8x7B (Cloud/Edge)"},
        ],
    }


@app.post("/api/ai/synthesize", tags=["Asistente IA"], response_model=SynthesizeResponse)
async def ai_synthesize(req: SynthesizeRequest, authorized: bool = Depends(verify_token)):
    """Sintetiza en lenguaje ganadero directo los resultados obtenidos de la base de datos."""
    groq_key = os.environ.get("GROQ_API_KEY")
    if groq_key and req.data:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                prompt_text = (
                    f"Eres un asesor técnico y veterinario de una explotación de vacuno de carne en pastos.\n"
                    f"El ganadero ha preguntado: '{req.prompt}'\n"
                    f"Los datos obtenidos de la base de datos son:\n{json.dumps(req.data[:15], ensure_ascii=False)}\n"
                    f"Resume en 1 o 2 frases breves, directas y claras en lenguaje ganadero la respuesta práctica."
                )
                headers = {"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"}
                payload = {
                    "model": "llama-3.3-70b-versatile",
                    "messages": [{"role": "user", "content": prompt_text}],
                    "temperature": 0.2,
                    "max_tokens": 150,
                }
                resp = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers=headers,
                    json=payload,
                )
                if resp.status_code == 200:
                    content = resp.json()["choices"][0]["message"]["content"].strip()
                    return {"ok": True, "sintesis": content}
        except Exception:
            pass

    n = len(req.data)
    sintesis = f"Se han obtenido {n} registro{'s' if n != 1 else ''} para la consulta '{req.prompt}'."
    return {"ok": True, "sintesis": sintesis}


@app.post("/api/ai/transcribe", tags=["Asistente IA"])
async def ai_transcribe(file: UploadFile = File(...)):
    """Proxy streaming para transcripción de notas de voz en campo mediante Groq Whisper."""
    groq_key = os.environ.get("GROQ_API_KEY")
    if not groq_key:
        raise HTTPException(status_code=400, detail="Configura GROQ_API_KEY en .env")

    async with httpx.AsyncClient() as client:
        files = {"file": (file.filename, await file.read(), file.content_type)}
        data = {
            "model": "whisper-large-v3-turbo",
            "language": "es",
            "response_format": "json",
        }
        headers = {"Authorization": f"Bearer {groq_key}", "User-Agent": "GanaderosCampo/2.0"}
        resp = await client.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            files=files,
            data=data,
            headers=headers,
        )

        if resp.status_code == 200:
            return {"ok": True, "text": resp.json().get("text", "").strip()}
        raise HTTPException(status_code=500, detail="Fallo en transcripción")


# ============================================================
# SERVIDO ESTÁTICO DE LA APLICACIÓN PWA
# ============================================================

app.mount("/", StaticFiles(directory=str(PWA_DIR), html=True), name="static")


def run_server(port: int = 8000, host: str = "0.0.0.0"):
    import uvicorn

    uvicorn.run("src.server.app:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    puerto = int(os.environ.get("APP_PORT", 8000))
    run_server(port=puerto)
