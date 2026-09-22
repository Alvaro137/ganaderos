# Ganaderos — PWA Offline-First para Gestión Ganadera en Extensivo

Aplicación web progresiva (PWA) de alto rendimiento construida con principios de **Clean Architecture (Puertos y Adaptadores)**, diseñada específicamente para la gestión operativa de vacuno de carne en pastos y dehesas. Resuelve el problema de la ausencia de cobertura móvil en el campo ejecutando un motor relacional SQLite completo en el navegador del cliente mediante **WebAssembly (SQL.js)** y persistencia en **IndexedDB**, complementado por un backend **FastAPI** asíncrono y un asistente conversacional basado en **Intent Calling tipado** con degradación offline elegante.

```mermaid
flowchart TD
    subgraph SUB_CLIENTE["Dispositivo Móvil (Offline-First en Campo - ES Modules)"]
        UI["Interfaz PWA Modular<br>pwa/js/modules/views/*"]
        PARSER["Parser Heurístico Local<br>pwa/js/modules/heuristics.js"]
        WASM["Motor SQLite WebAssembly<br>SQL.js en Navegador"]
        IDB[("IndexedDB (censo_storage)<br>Almacenamiento Persistente")]

        UI <-->|Consultas relacionales preparadas ?| WASM
        UI -.->|Sin cobertura 4G| PARSER
        PARSER -->|Consultas locales parametrizadas| WASM
        IDB <-->|Carga en frío y persistencia| WASM
    end

    subgraph SUB_SERVER["Servidor / API Gateway (FastAPI + Clean Architecture)"]
        API["FastAPI ASGI Router<br>src/server/app.py"]
        SCHEMAS["Esquemas Pydantic v2<br>src/server/schemas.py"]
        APP["Capa de Aplicación<br>CensoService, SanidadService, QueryBuilder"]
        DOM["Capa de Dominio Puro<br>Animal, Parto, Receta, Crotal (VO)"]
        INFRA["Capa de Infraestructura<br>SQLiteRepositories, LLMGateway"]

        UI -.->|Conectividad online (Bearer HMAC)| API
        API --> SCHEMAS
        API --> APP
        APP --> DOM
        APP <--> INFRA
    end

    subgraph SUB_AI["Servicios de Inteligencia Artificial (Online)"]
        GROQ["Groq Cloud<br>Whisper v3 Turbo + Llama 3.3 70B"]
        API <-->|Streaming de audio y síntesis explicativa| GROQ
    end
```

---

## Decisiones Clave de Arquitectura e Ingeniería

### 1. Clean Architecture Real (Ports & Adapters)
El sistema separa estrictamente las reglas de negocio de la tecnología de persistencia y presentación:
- **`src/domain/`:** Núcleo puro de reglas de negocio sin dependencias externas. Contiene *Value Objects* inmutables (`Crotal`, `PeriodoSupresion`, `ExplotacionCEA`), interfaces de repositorio (`repositories.py`) y entidades (`Animal`, `Parto`, `RecetaSanitaria`, `Movimiento`, `CompraAlimento`).
- **`src/application/`:** Casos de uso y orquestación (`services.py` con `CensoService`, `SanidadService`, `GenealogiaService`), catálogo tipado de intenciones (`intents.py`) y constructor determinista de sentencias SQL parametrizadas (`query_builder.py`).
- **`src/infrastructure/`:** Implementaciones SQLite de repositorios (`repositories.py`) con hidratación de entidades y validación de invariantes, pasarela de Tool Calling con LLMs (`llm_gateway.py`) y Anti-Corruption Layer para Access heredado (`access_reader.py`).
- **`src/server/`:** Servidor asíncrono **FastAPI** con validación **Pydantic v2**, gestión de ciclo de vida con `lifespan`, documentación interactiva OpenAPI (`/docs`), proxy de audio Whisper y manejo tipado de excepciones de dominio (`DomainError` -> HTTP 422).

### 2. Intent Calling Tipado frente a Text-to-SQL Libre
En lugar de permitir que un LLM genere sentencias SQL arbitrarias al vuelo (patrón vulnerable a alucinaciones de esquema y riesgos de inyección), el sistema emplea **Tool / Intent Calling estructurado**:
1. El modelo LLM actúa únicamente como extractor semántico de intención y parámetros (ej. `intent: "consultar_partos_madre"`, `crotal_4: "1045"`).
2. El `QueryBuilder` traduce la intención validada a una sentencia SQL preparada con parámetros ligados (`?`), garantizando sintaxis determinista, verificada en tests unitarios e inmune a inyección.
3. La consulta resultante se ejecuta en el navegador del usuario sobre la base de datos WebAssembly. Los datos ganaderos **nunca viajan a la nube del LLM**, garantizando privacidad por diseño.

### 3. Degradación Offline Elegante (Graceful Degradation)
Cuando el ganadero se encuentra en zonas sin cobertura 4G/5G:
- El cliente detecta la pérdida de red y conmuta automáticamente al **Parser Heurístico Local** (`pwa/js/modules/heuristics.js`).
- Resuelve instantáneamente las consultas más críticas (búsqueda de crotales de 4 dígitos, partos de una vaca, censo por corral, animales en supresión sanitaria o vacas sin parir) ejecutando consultas preparadas en WebAssembly local y mostrando la insignia informativa *"Modo sin cobertura"*.

### 4. Registros de Decisiones de Arquitectura (ADRs)
Las decisiones técnicas fundamentales están documentadas formalmente bajo el estándar MADR en [`docs/adr/`](docs/adr/):
- [ADR 0001: Motor Relacional Local-First con SQLite WASM e IndexedDB](docs/adr/0001-local-first-sqlite-wasm-indexeddb.md)
- [ADR 0002: Intent Calling Tipado vs. Text-to-SQL Libre](docs/adr/0002-typed-intent-calling-vs-raw-text-to-sql.md)
- [ADR 0003: Clean Architecture Hexagonal y Servidor FastAPI](docs/adr/0003-hexagonal-clean-architecture-python-fastapi.md)
- [ADR 0004: Resiliencia Offline y Caché del Service Worker](docs/adr/0004-offline-resilience-and-pwa-caching-strategy.md)
- [ADR 0005: Descomposición Modular del Frontend en ES Modules](docs/adr/0005-es-modules-frontend-decomposition.md)

---

## Estructura del Repositorio

```text
ganaderos/
├── .github/
│   └── workflows/
│       └── ci.yml                  # CI: Ruff lint, tests Python (unittest), tests Node.js, Docker build
├── docs/
│   └── adr/                        # Architecture Decision Records (MADR)
│       ├── 0001-local-first-sqlite-wasm-indexeddb.md
│       ├── 0002-typed-intent-calling-vs-raw-text-to-sql.md
│       ├── 0003-hexagonal-clean-architecture-python-fastapi.md
│       ├── 0004-offline-resilience-and-pwa-caching-strategy.md
│       └── 0005-es-modules-frontend-decomposition.md
├── pwa/                            # Cliente Web Offline-First (ES Modules)
│   ├── css/
│   │   └── app.css                 # Estilos responsive, dark theme y safe-area insets
│   ├── js/
│   │   ├── modules/                # Módulos ECMAScript desacoplados
│   │   │   ├── api.js              # Cliente HTTP para endpoints FastAPI
│   │   │   ├── auth.js             # Gestión de tokens y pantalla de login
│   │   │   ├── config.js           # Estado reactivo, helpers sanitizados y pila histórica
│   │   │   ├── db.js               # Adaptador SQLite WASM / IndexedDB
│   │   │   ├── heuristics.js       # Parser heurístico offline de lenguaje natural
│   │   │   ├── voice.js            # VoiceManager (Web Speech API + MediaRecorder)
│   │   │   └── views/              # Controladores de vista desacoplados
│   │   │       ├── assistant_view.js # Modal del asistente conversacional
│   │   │       ├── cattle_view.js    # Censo, buscador de 4 dígitos y teclado táctil
│   │   │       ├── detail_view.js    # Ficha técnica, genealogía y lotes
│   │   │       ├── feeds_view.js     # Compras de piensos y costes unitarios
│   │   │       ├── movements_view.js # Trazabilidad y Libro Oficial de Movimientos
│   │   │       └── sanitary_view.js  # Recetas y periodos de supresión en carne
│   │   ├── app.js                  # Coordinador central y enrutador de pestañas
│   │   ├── db_client.js            # Abstracción SQLite WASM e IndexedDB
│   │   ├── sql-wasm.js             # Cargador WebAssembly
│   │   └── sql-wasm.wasm           # Binario motor SQLite compilado a WASM
│   ├── favicon.ico
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon.svg
│   ├── index.html                  # Punto de entrada de la aplicación
│   ├── manifest.json               # Manifiesto PWA instalable
│   └── sw.js                       # Service Worker con precaché de assets y módulos ES
├── src/
│   ├── domain/                     # CAPA DE DOMINIO (Reglas de negocio puras)
│   │   ├── exceptions.py           # Excepciones de negocio (DomainError, CrotalInvalidoError)
│   │   ├── models.py               # Entidades (Animal, Parto, Receta, Movimiento, CompraAlimento)
│   │   ├── repositories.py         # Interfaces abstractas de repositorios
│   │   └── value_objects.py        # Value Objects (Crotal, PeriodoSupresion, ExplotacionCEA)
│   ├── application/                # CAPA DE APLICACIÓN (Casos de uso e intents)
│   │   ├── intents.py              # Catálogo de herramientas tipadas para LLMs
│   │   ├── query_builder.py        # Mapeo determinista Intent -> SQL parametrizado
│   │   └── services.py             # Servicios (CensoService, SanidadService, GenealogiaService)
│   ├── infrastructure/             # CAPA DE INFRAESTRUCTURA (Adaptadores externos)
│   │   ├── access_reader.py        # Anti-Corruption Layer para Access .mdb heredado
│   │   ├── llm_gateway.py          # Pasarela Tool Calling (Groq / Gemini / Local)
│   │   ├── repositories.py         # Implementación SQLite de repositorios de dominio
│   │   └── sqlite_builder.py       # Constructor de base de datos relacional
│   └── server/                     # CAPA DE PRESENTACIÓN / API GATEWAY
│       ├── app.py                  # Aplicación FastAPI asíncrona y lifespan
│       └── schemas.py              # Esquemas de validación Pydantic v2
├── scripts/
│   ├── generate_demo_db.py         # Generador determinista de dataset sintético realista
│   └── run_server.py               # Punto de entrada del servidor Uvicorn
├── tests/                          # SUITE COMPLETA DE PRUEBAS
│   ├── frontend/
│   │   └── test_modules.mjs        # Tests automáticos en Node.js (heurísticas, XSS, formateo)
│   ├── unit/
│   │   ├── test_application_services.py # Tests unitarios de servicios de aplicación
│   │   ├── test_domain.py          # Tests de entidades y Value Objects
│   │   ├── test_domain_repositories.py  # Tests de repositorios SQLite de dominio
│   │   └── test_intents.py         # Tests de intents y constructor SQL
│   └── integration/
│       ├── test_api_fastapi.py     # Tests de integración FastAPI y endpoints de IA
│       └── test_demo_db.py         # Tests de integridad relacional del dataset sintético
├── compose.yaml                    # Orquestación Docker Compose
├── Dockerfile                      # Construcción de contenedor multi-stage no-root
├── pyproject.toml                  # Metadatos del paquete, dependencias y linter Ruff
└── README.md
```

---

## Pila Tecnológica

| Capa | Tecnologías | Propósito |
| :--- | :--- | :--- |
| **Frontend PWA** | Vanilla ES Modules (Nativo), CSS3 Moderno, HTML5 | Rendimiento nativo sin overhead de frameworks, arranque instantáneo y uso táctil en manga/campo. |
| **Almacenamiento Local** | SQL.js (SQLite WebAssembly) + IndexedDB | Ejecución relacional completa (JOINs, filtros, agrupaciones) directamente en el dispositivo móvil. |
| **Backend / API** | Python 3.12, FastAPI, Pydantic v2, Uvicorn (ASGI) | API asíncrona declarativa, schemas tipados, OpenAPI interactivo (`/docs`) y streaming de audio. |
| **IA & Transcripción** | Groq Whisper Large v3 + Llama 3.3 70B | Transcripción de voz con latencia ultra-baja y síntesis ganadera en lenguaje natural. |
| **DevOps & CI/CD** | Docker multi-stage, Compose, GitHub Actions | Contenedores seguros (usuario no-root, healthchecks) y verificación continua de linting y tests. |

---

## Inicio Rápido

### Despliegue con Docker Compose (Recomendado)

```bash
git clone https://github.com/Alvaro137/ganaderos.git
cd ganaderos
docker compose up -d
```

Abrir en el navegador: `http://localhost:8000` *(Contraseña predeterminada de acceso: `mvp-testing`)*.

La documentación interactiva de la API está disponible en: `http://localhost:8000/docs`.

---

### Ejecución Local en Desarrollo

1. Requisitos: Python 3.10+ y Node.js 18+.

2. Instalar dependencias:
   ```bash
   pip install -e .
   ```

3. Generar el dataset demo sintético con razas autóctonas (Morucha, Limusina, Charolesa):
   ```bash
   python scripts/generate_demo_db.py --animales 150
   ```

4. Iniciar el servidor local:
   ```bash
   python scripts/run_server.py
   ```

5. Acceder a `http://localhost:8000`.

---

## Control de Calidad y Pruebas Automatizadas

La suite de pruebas continua garantiza la fiabilidad de todas las capas del sistema:

```bash
# 1. Linting y chequeo de estilo estricto
ruff check .

# 2. Tests de frontend con Node.js (heurísticas, XSS, formateadores, integridad ES Modules)
node tests/frontend/test_modules.mjs

# 3. Tests de backend y dominio (entidades, repositorios, servicios, FastAPI)
python -m unittest discover tests
```

---

## Seguridad y Privacidad de Datos

- **Privacidad Absoluta de Datos:** Los registros de la explotación nunca se envían al modelo de lenguaje en la nube. El LLM únicamente procesa el texto para extraer la intención; la consulta SQL resultante se ejecuta 100% en el dispositivo del ganadero.
- **Inmunidad a Inyección SQL:** El `QueryBuilder` genera sentencias SQL deterministas utilizando exclusivamente parámetros ligados (`?`), aislando por completo la base de datos de entradas maliciosas.
- **Mapeo de Errores de Dominio:** Excepciones de negocio (`CrotalInvalidoError`, `ExplotacionInvalidaError`) se transforman automáticamente en respuestas HTTP 422 estandarizadas.
- **Dataset Demo Anonimizado:** El repositorio público no contiene datos de explotaciones reales; incluye un generador determinista (`generate_demo_db.py`) para pruebas y evaluación técnica.

---

## Licencia

Este proyecto se distribuye bajo la licencia MIT. Consulta el archivo `LICENSE` para más información.
