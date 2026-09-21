"""Servidor HTTP de alto rendimiento y API Gateway para Ganaderos Campo PWA."""
import hashlib
import hmac
import http.server
import json
import mimetypes
import os
import secrets
import socketserver
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

# Tipos MIME necesarios para PWA y WebAssembly
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/octet-stream", ".sqlite")
mimetypes.add_type("application/manifest+json", ".json")

BASE_DIR = Path(__file__).resolve().parents[2]
PWA_DIR = BASE_DIR / "pwa"

# Cargar capas de Clean Architecture
from src.application.query_builder import construir_consulta_intent
from src.infrastructure.llm_gateway import resolver_intencion_usuario


def cargar_env() -> dict[str, str]:
    """Carga variables desde archivo .env local si existe."""
    env_vars: dict[str, str] = {}
    candidatos = [
        BASE_DIR / ".env",
        Path.cwd() / ".env",
    ]
    for ruta in candidatos:
        if ruta.exists():
            for linea in ruta.read_text(encoding="utf-8").splitlines():
                linea = linea.strip()
                if not linea or linea.startswith("#") or "=" not in linea:
                    continue
                k, v = linea.split("=", 1)
                env_vars[k.strip()] = v.strip().strip('"').strip("'")
    return env_vars


# ============================================================
# SEGURIDAD Y CONTROL DE SESIÓN HMAC-SHA256
# ============================================================
AUTH_SECRET_KEY = os.environ.get("PWA_AUTH_SECRET") or secrets.token_hex(32)


def obtener_password_esperada() -> str:
    env = cargar_env()
    return env.get("PWA_PASSWORD") or os.environ.get("PWA_PASSWORD") or "mvp-testing"


def verificar_password(password_intento: str) -> bool:
    esperada = obtener_password_esperada()
    return hmac.compare_digest(password_intento.strip(), esperada.strip())


def generar_auth_token(duracion_dias: int = 30) -> str:
    expira = int(time.time()) + (duracion_dias * 86400)
    nonce = secrets.token_hex(8)
    payload = f"{expira}:{nonce}"
    firma = hmac.new(AUTH_SECRET_KEY.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}:{firma}"


def verificar_auth_token(token: str) -> bool:
    if not token or ":" not in token:
        return False
    try:
        partes = token.split(":")
        if len(partes) != 3:
            return False
        expira_str, nonce, firma_recibida = partes
        if int(expira_str) < int(time.time()):
            return False
        payload = f"{expira_str}:{nonce}"
        firma_esperada = hmac.new(AUTH_SECRET_KEY.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
        return hmac.compare_digest(firma_recibida, firma_esperada)
    except Exception:
        return False


# ============================================================
# CONTROLADOR HTTP PRINCIPAL (PORTS & ADAPTERS)
# ============================================================
class PWAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PWA_DIR), **kwargs)

    def end_headers(self):
        # Cabeceras de seguridad y CORS para entorno PWA offline
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Token")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def extraer_token_peticion(self) -> str:
        auth_hdr = self.headers.get("Authorization", "")
        if auth_hdr.lower().startswith("bearer "):
            return auth_hdr[7:].strip()
        custom_hdr = self.headers.get("X-Auth-Token", "")
        if custom_hdr:
            return custom_hdr.strip()
        cookie_hdr = self.headers.get("Cookie", "")
        if "campo_auth=" in cookie_hdr:
            for part in cookie_hdr.split(";"):
                part = part.strip()
                if part.startswith("campo_auth="):
                    return part.split("=", 1)[1].strip()
        return ""

    def esta_autenticado(self) -> bool:
        token = self.extraer_token_peticion()
        return verificar_auth_token(token)

    def responder_json(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def do_GET(self):
        path_clean = self.path.split("?")[0]

        # 1. Healthcheck para Docker y Kubernetes
        if path_clean == "/api/health":
            self.responder_json(200, {
                "status": "healthy",
                "service": "ganaderos-campo",
                "version": "2.0.0"
            })
            return

        # 2. Verificación de autenticación
        elif path_clean == "/api/auth/verify":
            self.responder_json(200, {"ok": True, "authenticated": self.esta_autenticado()})
            return

        # 3. Descarga protegida de base de datos SQLite
        elif path_clean in ("/api/database", "/ganaderos_campo.sqlite"):
            if not self.esta_autenticado() and os.environ.get("PWA_ALLOW_ANON_DB") != "1":
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.send_header("WWW-Authenticate", 'Bearer realm="GanaderosCampo"')
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Autenticación requerida.", "authenticated": False}).encode("utf-8"))
                return

            sqlite_file = PWA_DIR / "ganaderos_campo.sqlite"
            if not sqlite_file.exists():
                sqlite_file = PWA_DIR / "ganaderos_demo.sqlite"
            if not sqlite_file.exists():
                self.send_error(404, "Base de datos no encontrada.")
                return

            try:
                with open(sqlite_file, "rb") as f:
                    contenido = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(contenido)))
                self.send_header("Content-Disposition", 'attachment; filename="ganaderos_campo.sqlite"')
                self.end_headers()
                self.wfile.write(contenido)
            except Exception as e:
                self.send_error(500, f"Error leyendo base de datos: {str(e)}")
            return

        # 4. Archivos estáticos de la PWA
        super().do_GET()

    def do_POST(self):
        path_clean = self.path.split("?")[0]

        if path_clean == "/api/auth/login":
            self.handle_auth_login()
            return
        elif path_clean in ("/api/ai/intent", "/api/ai/query"):
            self.handle_ai_intent()
            return
        elif path_clean == "/api/ai/transcribe":
            self.handle_ai_transcribe()
            return
        else:
            self.send_error(404, "Endpoint no encontrado")

    def handle_auth_login(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self.responder_json(400, {"error": "JSON inválido"})
            return

        pwd = str(body.get("password", ""))
        if verificar_password(pwd):
            token = generar_auth_token(duracion_dias=30)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Set-Cookie", f"campo_auth={token}; Path=/; Max-Age=2592000; SameSite=Lax")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "token": token,
                "message": "Autenticación exitosa."
            }).encode("utf-8"))
        else:
            self.responder_json(401, {"ok": False, "error": "Contraseña incorrecta."})

    def handle_ai_intent(self):
        """Resuelve la intención del usuario mediante Intent Calling tipado."""
        if not self.esta_autenticado() and os.environ.get("PWA_ALLOW_ANON_AI") != "1":
            self.responder_json(401, {"error": "Sesión no autenticada."})
            return

        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self.responder_json(400, {"error": "JSON inválido"})
            return

        prompt = str(body.get("prompt", "")).strip()
        historial = body.get("historial", [])

        if not prompt:
            self.responder_json(400, {"error": "El campo prompt es obligatorio."})
            return

        # Clasificación de la intención (LLM o heurística local)
        nombre_intent, args, es_offline = resolver_intencion_usuario(prompt, historial)

        # Construcción determinista de la sentencia SQL parametrizada
        query_result = construir_consulta_intent(nombre_intent, args)

        self.responder_json(200, {
            "ok": True,
            "intent": nombre_intent,
            "args": args,
            "sql": query_result.sql,
            "params": query_result.params,
            "interpretacion": query_result.interpretacion,
            "tipo_resultado": query_result.tipo_resultado,
            "respuesta_directa": query_result.respuesta_directa,
            "offline_mode": es_offline,
        })

    def handle_ai_transcribe(self):
        """Transcribe audio mediante Groq Whisper v3 Turbo."""
        length = int(self.headers.get("Content-Length", 0))
        audio_data = self.rfile.read(length)
        if not audio_data:
            self.responder_json(400, {"error": "Datos de audio vacíos."})
            return

        env = cargar_env()
        groq_key = env.get("GROQ_API_KEY") or os.environ.get("GROQ_API_KEY")
        if not groq_key:
            self.responder_json(400, {
                "error": "Configura GROQ_API_KEY en .env para transcripción por voz.",
                "missing_key": True
            })
            return

        content_type = self.headers.get("Content-Type", "audio/webm").split(";")[0].strip()
        filename = "audio.webm" if "webm" in content_type else "audio.wav"

        boundary = f"----FormBoundary{uuid.uuid4().hex}"
        body_bytes = bytearray()

        def add_field(name: str, value: str):
            body_bytes.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode("utf-8"))

        add_field("model", "whisper-large-v3-turbo")
        add_field("language", "es")
        add_field("response_format", "json")

        body_bytes.extend(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n".encode("utf-8")
        )
        body_bytes.extend(audio_data)
        body_bytes.extend(f"\r\n--{boundary}--\r\n".encode("utf-8"))

        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            data=bytes(body_bytes),
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Authorization": f"Bearer {groq_key}",
                "User-Agent": "GanaderosCampo/2.0",
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                self.responder_json(200, {"ok": True, "text": data.get("text", "").strip()})
        except Exception as e:
            self.responder_json(500, {"error": f"Fallo en transcripción: {str(e)}"})


def run_server(port: int = 8000, host: str = "0.0.0.0"):
    class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True

    server_address = (host, port)
    with ThreadedHTTPServer(server_address, PWAHandler) as httpd:
        print(f"Ganaderos Campo PWA ejecutándose en http://{host}:{port}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nDeteniendo servidor...")


if __name__ == "__main__":
    puerto = int(os.environ.get("APP_PORT", 8000))
    run_server(port=puerto)
