# syntax=docker/dockerfile:1
FROM python:3.12-slim as runtime

WORKDIR /app

# Metadatos del contenedor
LABEL org.opencontainers.image.title="Ganaderos Campo PWA" \
      org.opencontainers.image.description="PWA offline-first para gestión ganadera en campo con WebAssembly y SQLite" \
      org.opencontainers.image.authors="Alvaro137 <alvarogil137@gmail.com>"

# Variables de entorno de ejecución
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_PORT=8000

# Copiar archivos del proyecto
COPY pwa/ /app/pwa/
COPY src/ /app/src/
COPY scripts/ /app/scripts/

# Crear usuario sin privilegios por seguridad
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -s /bin/bash -m appuser && \
    chown -R appuser:appgroup /app

USER appuser

# Si no existe base de datos, generar el dataset demo determinista
RUN python3 scripts/generate_demo_db.py --animales 150

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=3)" || exit 1

ENTRYPOINT ["python3", "scripts/run_server.py"]
