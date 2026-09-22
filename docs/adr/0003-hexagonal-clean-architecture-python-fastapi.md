# ADR 0003: Arquitectura Limpia Hexagonal y Servidor FastAPI

* **Estado:** Aceptado
* **Fecha:** 2026-09-21
* **Decisores:** Equipo de Arquitectura Backend Ganaderos Campo

## Contexto y Planteamiento del Problema
Inicialmente, el backend del repositorio utilizaba `http.server.SimpleHTTPRequestHandler` de la librería estándar en un único archivo procedimental. Asimismo, las entidades de la capa de dominio (`Animal`, `Crotal`, `PeriodoSupresion`) estaban desconectadas de las peticiones HTTP y de la persistencia real, constituyendo una fachada técnica ("Architecture Theater").

Para convertir la solución en un software mantenible, testeable y de estándar Senior/Staff Engineer, se requería:
1. Conectar verdaderamente el núcleo de dominio con la infraestructura de persistencia.
2. Contar con un servidor asíncrono moderno con validación de esquemas tipados, documentación OpenAPI automática y soporte nativo para streaming de audio.

## Alternativas Consideradas
1. **Mantener `http.server` personalizado:** Descartado. Dificulta el enrutamiento declarativo, carece de validación Pydantic, no soporta OpenAPI/Swagger y mezcla responsabilidades de bajo nivel de socket con lógica de negocio.
2. **Django / Django REST Framework:** Descartado por ser excesivamente pesado e intrusivo para un microservicio edge que debe desplegarse en placas SBC (Orange Pi / Raspberry Pi) o contenedores ligeros.
3. **FastAPI con Clean Architecture (Puertos y Adaptadores):** Seleccionado. Proporciona alto rendimiento asíncrono (ASGI/Uvicorn), esquemas Pydantic v2, generación automática de OpenAPI y bajo consumo de memoria.

## Decisión
1. **Dominio:**
   - Definir interfaces de repositorio mediante protocolos abstractos en `src/domain/repositories.py` (`AnimalRepository`, `PartoRepository`, `RecetaRepository`, `ExplotacionRepository`).
   - Implementar repositorios SQLite concretos en `src/infrastructure/repositories.py` que hidratan las entidades y Value Objects validando sus invariantes.
   - Orquestar casos de uso mediante servicios de aplicación en `src/application/services.py` (`CensoService`, `SanidadService`, `GenealogiaService`).
2. **Presentación / Servidor:**
   - Implementar `src/server/app.py` con FastAPI, gestionando el ciclo de vida mediante `lifespan`.
   - Utilizar Pydantic v2 en `src/server/schemas.py` para todos los DTOs de entrada y salida.
   - Mapear excepciones de negocio de `src/domain/exceptions.py` (`DomainError`, `CrotalInvalidoError`) a respuestas HTTP 422 estructuradas.
   - Integrar proxy de transcripción Groq Whisper usando `UploadFile` y `httpx.AsyncClient`.

## Consecuencias

### Positivas
- **Separación de Responsabilidades Real:** El núcleo de negocio no depende de FastAPI ni de SQLite; cualquier capa puede reemplazarse o probarse de forma aislada.
- **Documentación Interactiva:** Acceso directo a `/docs` (Swagger UI) y `/redoc` con esquemas tipados y tags temáticos.
- **Testabilidad Máxima:** Los repositorios y servicios se prueban con bases de datos en memoria (`:memory:`) o dobles de prueba (`unittest.mock`), alcanzando tiempos de ejecución en submilisegundos.

### Negativas / Desafíos
- **Dependencias Externas:** Requiere instalar `fastapi`, `uvicorn`, `pydantic` y `httpx`, lo cual se gestiona limpiamente a través de `pyproject.toml` y el Dockerfile multi-stage.
