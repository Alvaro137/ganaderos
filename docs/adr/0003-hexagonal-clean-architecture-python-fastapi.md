# ADR 0003: Arquitectura hexagonal y servidor FastAPI

- **Estado:** Aceptado
- **Fecha:** 2026-09-21
- **Decisores:** Equipo de arquitectura backend Ganaderos Campo

## Contexto y planteamiento del problema

Inicialmente, el backend utilizaba `http.server.SimpleHTTPRequestHandler` de la biblioteca estándar de Python en un único archivo procedimental. Las clases de dominio (`Animal`, `Crotal`, `PeriodoSupresion`) no estaban conectadas con las rutas HTTP ni con la persistencia relacional.

Para asegurar la mantenibilidad y la cobertura de pruebas del sistema, se requerían dos objetivos:
1. Conectar la lógica de negocio con la capa de persistencia en SQLite mediante interfaces explícitas.
2. Disponer de un servidor asíncrono con validación estricta de esquemas, documentación OpenAPI automática y soporte para transferencias de audio.

## Alternativas consideradas

1. Mantener `http.server` personalizado: Descartada. Complica el enrutamiento declarativo, carece de validación automática de tipos y acopla la gestión de sockets con la lógica de negocio.
2. Django o Django REST Framework: Descartada. Introduce sobrecarga de dependencias y mayor consumo de memoria para un servicio destinado a ejecutarse en placas monoplaca (Orange Pi Zero 3) y contenedores reducidos.
3. FastAPI con arquitectura de puertos y adaptadores: Seleccionada. Ofrece ejecución asíncrona sobre ASGI/Uvicorn, validación con Pydantic v2, generación de especificación OpenAPI y consumo moderado de memoria.

## Decisión

1. Capa de dominio y persistencia:
   - Definir interfaces de repositorio mediante protocolos en `src/domain/repositories.py` (`AnimalRepository`, `PartoRepository`, `RecetaRepository`, `ExplotacionRepository`).
   - Implementar repositorios SQLite concretos en `src/infrastructure/repositories.py` que instancian entidades y objetos de valor validando sus invariantes.
   - Coordinar casos de uso mediante servicios de aplicación en `src/application/services.py` (`CensoService`, `SanidadService`, `GenealogiaService`).
2. Capa de presentación y servidor:
   - Implementar la aplicación web en `src/server/app.py` utilizando FastAPI y gestionando el ciclo de vida con `lifespan`.
   - Utilizar Pydantic v2 en `src/server/schemas.py` para los esquemas de entrada y salida de cada punto de enlace.
   - Convertir excepciones de dominio de `src/domain/exceptions.py` (`DomainError`, `CrotalInvalidoError`) en respuestas HTTP 422 estructuradas.
   - Exponer un proxy de transcripción de audio hacia Groq Whisper usando `UploadFile` y `httpx.AsyncClient`.

## Consecuencias

### Positivas
- Desacoplamiento de componentes: la lógica de negocio no depende del framework HTTP ni del controlador de base de datos.
- Documentación de API integrada: generación automática de interfaces interactivas en `/docs` (Swagger UI) y `/redoc`.
- Facilidad para pruebas unitarias: los repositorios y servicios se ejecutan contra bases de datos SQLite en memoria (`:memory:`) o dobles de prueba (`unittest.mock`) en pocos milisegundos.

### Negativas y limitaciones
- Aumento de dependencias: requiere instalar `fastapi`, `uvicorn`, `pydantic` y `httpx`, gestionadas mediante `pyproject.toml` y empaquetadas en imágenes Docker de múltiples etapas.
