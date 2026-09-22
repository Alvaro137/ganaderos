import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    Response,
    UploadFile,
)
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles

from src.application.query_builder import construir_consulta_intent
from src.infrastructure.llm_gateway import resolver_intencion_usuario
from src.server.schemas import (
    AIModelResponse,
    AuthTokenResponse,
    HealthResponse,
    IntentRequest,
    IntentResponse,
    LoginRequest,
    SynthesizeRequest,
    SynthesizeResponse,
)


# Mock auth helpers for simplicity in refactor
def verificar_password(pwd: str) -> bool:
    return pwd == os.environ.get("PWA_PASSWORD", "mvp-testing")

def generar_auth_token(duracion_dias: int) -> str:
    return uuid.uuid4().hex

PWA_DIR = Path(__file__).resolve().parents[2] / "pwa"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB and Repositories here
    yield
    # Cleanup here

app = FastAPI(title="Ganaderos Campo PWA", version="2.0.0", lifespan=lifespan)
security = HTTPBearer(auto_error=False)

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials and os.environ.get("PWA_ALLOW_ANON_DB") != "1":
        raise HTTPException(status_code=401, detail="Autenticación requerida")
    return True

@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    return {"status": "healthy", "service": "ganaderos-campo", "version": "2.0.0"}

@app.get("/api/auth/verify")
async def auth_verify(credentials: HTTPAuthorizationCredentials = Depends(security)):
    return {"ok": True, "authenticated": credentials is not None}

@app.post("/api/auth/login", response_model=AuthTokenResponse)
async def auth_login(req: LoginRequest, response: Response):
    if verificar_password(req.password):
        token = generar_auth_token(30)
        response.set_cookie(key="campo_auth", value=token, max_age=2592000, httponly=True, samesite="lax")
        return {"ok": True, "token": token, "message": "Autenticación exitosa."}
    raise HTTPException(status_code=401, detail="Contraseña incorrecta.")

@app.get("/api/database")
async def get_database(authorized: bool = Depends(verify_token)):
    sqlite_file = PWA_DIR / "ganaderos_campo.sqlite"
    if not sqlite_file.exists():
        sqlite_file = PWA_DIR / "ganaderos_demo.sqlite"
    if not sqlite_file.exists():
        raise HTTPException(status_code=404, detail="Base de datos no encontrada.")
    return FileResponse(sqlite_file, media_type="application/octet-stream", filename="ganaderos_campo.sqlite")

@app.post("/api/ai/intent", response_model=IntentResponse)
async def ai_intent(req: IntentRequest, authorized: bool = Depends(verify_token)):
    nombre_intent, args, es_offline = resolver_intencion_usuario(req.prompt, req.historial)
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
        "offline_mode": es_offline,
    }

@app.get("/api/ai/models", response_model=AIModelResponse)
async def ai_models(authorized: bool = Depends(verify_token)):
    return {
        "ok": True,
        "models": [
            {"id": "auto", "name": "Automático (Recomendado)"},
            {"id": "llama-3.3-70b-versatile", "name": "Groq Llama 3.3 70B (Cloud)"},
            {"id": "mixtral-8x7b-32768", "name": "Mixtral 8x7B (Cloud)"},
            {"id": "offline", "name": "Heurística Local (100% Offline)"},
        ],
    }


@app.post("/api/ai/synthesize", response_model=SynthesizeResponse)
async def ai_synthesize(req: SynthesizeRequest, authorized: bool = Depends(verify_token)):
    groq_key = os.environ.get("GROQ_API_KEY")
    if groq_key and req.model_id != "offline" and req.data:
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


@app.post("/api/ai/transcribe")
async def ai_transcribe(file: UploadFile = File(...)):
    groq_key = os.environ.get("GROQ_API_KEY")
    if not groq_key:
        raise HTTPException(status_code=400, detail="Configura GROQ_API_KEY en .env")

    async with httpx.AsyncClient() as client:
        files = {"file": (file.filename, await file.read(), file.content_type)}
        data = {
            "model": "whisper-large-v3-turbo",
            "language": "es",
            "response_format": "json"
        }
        headers = {"Authorization": f"Bearer {groq_key}", "User-Agent": "GanaderosCampo/2.0"}
        resp = await client.post("https://api.groq.com/openai/v1/audio/transcriptions", files=files, data=data, headers=headers)

        if resp.status_code == 200:
            return {"ok": True, "text": resp.json().get("text", "").strip()}
        raise HTTPException(status_code=500, detail="Fallo en transcripción")

app.mount("/", StaticFiles(directory=str(PWA_DIR), html=True), name="static")

def run_server(port: int = 8000, host: str = "0.0.0.0"):
    import uvicorn
    uvicorn.run("src.server.app:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    puerto = int(os.environ.get("APP_PORT", 8000))
    run_server(port=puerto)
