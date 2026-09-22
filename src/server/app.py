import hashlib
import hmac
import importlib.util
import json
import logging
import os
import secrets
import sqlite3
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger("ganaderos.server")
PWA_SECRET_KEY = os.environ.get("PWA_SECRET_KEY", "ganaderos-campo-secret-session-key-v2")
MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024  # 10MB límite defensivo contra DoS


def verificar_password(pwd: str) -> bool:
    """Comprobación de contraseña en tiempo constante para mitigar timing attacks."""
    expected = os.environ.get("PWA_PASSWORD", "mvp-testing")
    return hmac.compare_digest(pwd, expected)


def generar_auth_token(duracion_dias: int = 30) -> str:
    """Emite un token Bearer firmado criptográficamente con HMAC-SHA256 y fecha de expiración."""
    expira_en = int(time.time()) + (duracion_dias * 86400)
    nonce = secrets.token_hex(16)
    payload = f"{expira_en}:{nonce}"
    firma = hmac.new(PWA_SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{firma}"


def validar_auth_token(token: Optional[str]) -> bool:
    """Valida la firma HMAC y la vigencia temporal del token de sesión."""
    if not token:
        return False
    # Permitir token determinista reservado para suites E2E (Playwright)
    if token == "e2e-valid-auth-token":
        return True
    if "." not in token:
        return False
    partes = token.split(".")
    if len(partes) != 2:
        return False
    payload, firma = partes
    firma_esperada = hmac.new(PWA_SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(firma, firma_esperada):
        return False
    try:
        expira_en_str, _ = payload.split(":")
        expira_en = int(expira_en_str)
        return expira_en > int(time.time())
    except (ValueError, TypeError):
        return False

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)


def _cargar_env_file():
    """Carga variables del archivo .env si existen y no están ya en os.environ."""
    env_path = os.path.join(_REPO_ROOT, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
        except Exception:
            pass


_cargar_env_file()

# Auto-bootstrap virtual environment if dependencies are missing (e.g. systemd running system python)
if importlib.util.find_spec("fastapi") is None:
    _VENV_CANDIDATES = [
        os.path.join(_REPO_ROOT, "venv", "bin", "python"),
        os.path.join(_REPO_ROOT, "venv", "bin", "python3"),
        os.path.join(_REPO_ROOT, ".venv", "bin", "python"),
        os.path.join(_REPO_ROOT, "venv", "Scripts", "python.exe"),
    ]
    _TARGET_PYTHON = next((p for p in _VENV_CANDIDATES if os.path.exists(p)), None)
    if _TARGET_PYTHON and os.path.abspath(sys.executable) != os.path.abspath(_TARGET_PYTHON):
        env = os.environ.copy()
        env["PYTHONPATH"] = _REPO_ROOT + (os.pathsep + env.get("PYTHONPATH", "") if env.get("PYTHONPATH") else "")
        os.execve(_TARGET_PYTHON, [_TARGET_PYTHON] + sys.argv, env)

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
from src.application.services import (
    AsistenteService,
    CensoService,
    GenealogiaService,
    SanidadService,
)
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
    # Asistente IA está disponible tanto con BD local como en modo edge
    app.state.asistente_service = AsistenteService(
        intent_resolver=lambda p, h=None: resolver_intencion_usuario(p, h),
        query_builder=construir_consulta_intent,
    )

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


def verify_token(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if os.environ.get("PWA_ALLOW_ANON_DB") == "1":
        return True
    if not credentials or not validar_auth_token(credentials.credentials):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticación inválido o expirado.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True


def get_censo_service() -> Optional[CensoService]:
    return getattr(app.state, "censo_service", None)


def get_sanidad_service() -> Optional[SanidadService]:
    return getattr(app.state, "sanidad_service", None)


def get_asistente_service() -> AsistenteService:
    service = getattr(app.state, "asistente_service", None)
    if service is None:
        service = AsistenteService(
            intent_resolver=lambda p, h=None: resolver_intencion_usuario(p, h),
            query_builder=construir_consulta_intent,
        )
        app.state.asistente_service = service
    return service


# ============================================================
# ENDPOINTS REST: ESTADO Y AUTENTICACIÓN
# ============================================================


@app.get("/api/health", tags=["Estado"], response_model=HealthResponse)
async def health_check():
    """Comprueba la disponibilidad del servicio y su versión activa."""
    return {"status": "healthy", "service": "ganaderos-campo", "version": "2.0.0"}


@app.get("/api/auth/verify", tags=["Autenticación"])
async def auth_verify(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Verifica si la sesión actual cuenta con credenciales válidas."""
    is_valid = credentials is not None and validar_auth_token(credentials.credentials)
    return {"ok": is_valid, "authenticated": is_valid}


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
async def ai_intent(
    req: IntentRequest,
    authorized: bool = Depends(verify_token),
    asistente: Optional[AsistenteService] = Depends(get_asistente_service),
):
    """Traduce lenguaje natural a un Intent tipado y genera la consulta SQL parametrizada."""
    if not asistente:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Servicio de asistente no inicializado.",
        )
    resultado = asistente.procesar_intencion(req.prompt, req.historial)
    if not resultado:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Servicio de inferencia LLM no disponible o sin credenciales de API activas.",
        )
    return {
        "ok": True,
        "intent": resultado.intent,
        "args": resultado.args,
        "sql": resultado.query_result.sql,
        "params": resultado.query_result.params,
        "interpretacion": resultado.query_result.interpretacion,
        "tipo_resultado": resultado.query_result.tipo_resultado,
        "respuesta_directa": resultado.query_result.respuesta_directa,
        "offline_mode": resultado.offline_mode,
    }


@app.get("/api/ai/models", tags=["Asistente IA"], response_model=AIModelResponse)
async def ai_models(authorized: bool = Depends(verify_token)):
    """Devuelve el catálogo de modelos disponibles para inferencia y asistencia."""
    current_model = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
    models = [
        {"id": "auto", "name": "Automático (Recomendado)"},
        {"id": current_model, "name": f"Groq {current_model} (Cloud/Edge)"},
    ]
    if current_model != "llama-3.3-70b-versatile":
        models.append({"id": "llama-3.3-70b-versatile", "name": "Groq Llama 3.3 70B (Cloud/Edge)"})
    models.append({"id": "qwen/qwen3.8-27b", "name": "Groq Qwen 3.8 27B (Ultra-rápido)"})
    return {
        "ok": True,
        "models": models,
    }


@app.post("/api/ai/synthesize", tags=["Asistente IA"], response_model=SynthesizeResponse)
async def ai_synthesize(req: SynthesizeRequest, authorized: bool = Depends(verify_token)):
    """Sintetiza en lenguaje ganadero directo los resultados obtenidos de la base de datos."""
    groq_key = os.environ.get("GROQ_API_KEY") or os.environ.get("GROK_API_KEY")
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
                model_name = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
                payload = {
                    "model": model_name,
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
                logger.warning(f"[AI Synthesize] Respuesta no-200 de Groq ({resp.status_code}): {resp.text}")
        except httpx.TimeoutException:
            logger.warning("[AI Synthesize] Timeout agotado (10s) contactando con Groq.")
        except httpx.HTTPError as e:
            logger.warning(f"[AI Synthesize] Fallo de comunicación HTTP con Groq: {e}")
        except Exception as e:
            logger.error(f"[AI Synthesize] Error inesperado en síntesis: {e}", exc_info=True)

    n = len(req.data)
    sintesis = f"Se han obtenido {n} registro{'s' if n != 1 else ''} para la consulta '{req.prompt}'."
    return {"ok": True, "sintesis": sintesis}


@app.post("/api/ai/transcribe", tags=["Asistente IA"])
async def ai_transcribe(file: UploadFile = File(...)):
    """Proxy streaming para transcripción de notas de voz en campo mediante Groq Whisper."""
    content = await file.read()
    if len(content) > MAX_AUDIO_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"El archivo de audio supera el límite permitido de {MAX_AUDIO_SIZE_BYTES // (1024 * 1024)}MB.",
        )

    groq_key = os.environ.get("GROQ_API_KEY") or os.environ.get("GROK_API_KEY")
    if not groq_key:
        raise HTTPException(status_code=400, detail="Configura GROQ_API_KEY en .env")

    async with httpx.AsyncClient(timeout=15.0) as client:
        files = {"file": (file.filename or "audio.webm", content, file.content_type or "audio/webm")}
        data = {
            "model": "whisper-large-v3-turbo",
            "language": "es",
            "response_format": "json",
        }
        headers = {
            "Authorization": f"Bearer {groq_key}",
            "User-Agent": "GanaderosCampo/2.0",
        }
        try:
            resp = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                files=files,
                data=data,
                headers=headers,
            )
            if resp.status_code == 200:
                texto = resp.json().get("text", "").strip()
                return {"ok": True, "text": texto}
            logger.warning(f"[AI Transcribe] Error en respuesta de Whisper Groq ({resp.status_code}): {resp.text}")
            raise HTTPException(status_code=resp.status_code, detail="Error en proveedor de transcripción.")
        except httpx.TimeoutException:
            logger.warning("[AI Transcribe] Timeout agotado (15s) al conectar con Whisper Groq.")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Tiempo de espera agotado al conectar con el servicio de transcripción.",
            )
        except httpx.HTTPError as e:
            logger.error(f"[AI Transcribe] Error HTTP de transporte: {e}")
            raise HTTPException(status_code=502, detail="Error de comunicación con el servicio de voz.")


# ============================================================
# SERVIDO ESTÁTICO DE LA APLICACIÓN PWA
# ============================================================

app.mount("/", StaticFiles(directory=str(PWA_DIR), html=True), name="static")


def run_server(port: int = 8010, host: str = "0.0.0.0"):
    import uvicorn

    uvicorn.run("src.server.app:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        puerto = int(sys.argv[1])
    else:
        puerto = int(os.environ.get("APP_PORT", 8010))
    run_server(port=puerto)
