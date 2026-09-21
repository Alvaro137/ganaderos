# Ganaderos — PWA Offline-First para Gestión Ganadera en Extensivo

Aplicación web progresiva (PWA) de alto rendimiento construida con principios de **Clean Architecture**, diseñada específicamente para la gestión operativa de vacuno de carne en pastos y dehesas. Resuelve el problema de la ausencia de cobertura móvil en el campo ejecutando un motor relacional SQLite completo en el navegador del cliente mediante **WebAssembly (SQL.js)** y persistencia en **IndexedDB**, complementado por un asistente de voz y lenguaje natural basado en **Intent Calling tipado** con degradación offline elegante.

```mermaid
flowchart TD
    subgraph Dispositivo Móvil (Offline-First en Campo)
        UI[Interfaz Móvil PWA\nHTML5 + CSS Safe Areas]
        PARSER[Parser Heurístico Local\nModo Sin Cobertura]
        WASM[Motor SQLite WebAssembly\nSQL.js en Navegador]
        IDB[(IndexedDB\nAlmacenamiento Persistente)]

        UI <-->|Consultas relacionales preparadas| WASM
        UI -.->|Sin cobertura 4G| PARSER
        PARSER -->|Consultas locales| WASM
        IDB <-->|Carga en frío y persistencia| WASM
    end

    subgraph Servidor / API Gateway (Clean Architecture)
        API[Capa de Presentación / HTTP Server\nsrc/server/app.py]
        APP[Capa de Aplicación\nIntent Calling y Query Builder]
        DOM[Capa de Dominio\nEntidades y Value Objects Ganaderos]
        INFRA[Capa de Infraestructura\nAdaptadores LLM y SQLite]

        UI -.->|Conectividad online| API
        API --> APP
        APP --> DOM
        APP <--> INFRA
    end

    subgraph Servicios de Inteligencia Artificial (Online)
        GROQ[Groq Cloud\nWhisper v3 Turbo + Tool Calling]
        INFRA <-->|Extracción estructurada de intenciones| GROQ
    end
```

---

## Decisiones Clave de Arquitectura e Ingeniería

### 1. Clean Architecture (Ports & Adapters)
El código desacopla las reglas esenciales del negocio ganadero de cualquier tecnología externa o framework web:
- **`src/domain/`:** Núcleo puro de reglas de negocio. Contiene *Value Objects* inmutables (`Crotal`, `PeriodoSupresion`, `ExplotacionCEA`) y entidades (`Animal`, `Parto`, `RecetaSanitaria`, `Movimiento`, `CompraAlimento`).
- **`src/application/`:** Casos de uso y orquestación. Define el catálogo cerrado de intenciones (`intents.py`) y el constructor determinista de sentencias SQL parametrizadas (`query_builder.py`).
- **`src/infrastructure/`:** Adaptadores tecnológicos hacia el exterior (cliente de Tool Calling con LLMs, lectura de bases de datos Access heredadas y constructor SQLite).
- **`src/server/`:** Adaptador de entrada HTTP ligero, sin dependencias pesadas, con autenticación criptográfica `HMAC-SHA256` y healthchecks.

### 2. Intent Calling Tipado frente a Text-to-SQL Libre
En lugar de permitir que un modelo de lenguaje genere sentencias SQL arbitrarias al vuelo (un patrón frágil, propenso a alucinaciones de nombres de columnas y vulnerable a inyecciones SQL), el sistema emplea **Tool / Intent Calling estructurado**:
1. El modelo LLM actúa únicamente como extractor semántico de intención y parámetros (ej. `intent: "consultar_partos_madre"`, `crotal_4: "1045"`).
2. El `QueryBuilder` de la aplicación traduce la intención validada a una sentencia SQL preparada utilizando parámetros ligados (`?`), garantizando sintaxis 100% determinista, verificada en tests unitarios e inmune a inyección.
3. La consulta resultante se envía al navegador del usuario para ejecutarse localmente sobre la base de datos WebAssembly. Los datos de la explotación ganadera **nunca viajan a la nube del LLM**, asegurando privacidad por diseño.

### 3. Degradación Offline Elegante (Graceful Degradation)
Cuando el ganadero se encuentra en una zona sin cobertura 4G/5G, la aplicación no se bloquea:
- El cliente detecta la pérdida de red y activa el **Parser Heurístico Local**.
- Resuelve instantáneamente las consultas más críticas de manejo (búsqueda de crotales de 4 dígitos, partos de una vaca, censo por corral, animales en supresión sanitaria o vacas sin parir) ejecutando consultas preparadas en WebAssembly local y mostrando la insignia informativa *"Modo sin cobertura"*.

---

## Estructura del Repositorio

```text
ganaderos/
├── .github/
│   └── workflows/
│       └── ci.yml                  # Pipeline de CI (linting ruff, tests unitarios, Docker build)
├── pwa/                            # Cliente Web Offline-First
│   ├── css/
│   │   └── app.css                 # Estilos responsive, dark theme y safe-area insets
│   ├── js/
│   │   ├── app.js                  # UI Controller y Parser Heurístico Offline
│   │   ├── db_client.js            # Abstracción SQLite WASM e IndexedDB
│   │   ├── sql-wasm.js             # Cargador WebAssembly
│   │   └── sql-wasm.wasm           # Binario motor SQLite compilado a WASM
│   ├── favicon.ico
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon.svg
│   ├── index.html                  # Punto de entrada de la aplicación
│   ├── manifest.json               # Manifiesto PWA instalable
│   └── sw.js                       # Service Worker con caché offline
├── src/
│   ├── domain/                     # CAPA DE DOMINIO (Reglas de negocio puras)
│   │   ├── exceptions.py           # Excepciones de negocio (CrotalInvalidoError, etc.)
│   │   ├── models.py               # Entidades (Animal, Parto, Receta, Movimiento)
│   │   └── value_objects.py        # Value Objects (Crotal, PeriodoSupresion, ExplotacionCEA)
│   ├── application/                # CAPA DE APLICACIÓN (Casos de uso e intents)
│   │   ├── intents.py              # Catálogo de herramientas tipadas para LLMs
│   │   └── query_builder.py        # Mapeo determinista Intent -> SQL parametrizado
│   ├── infrastructure/             # CAPA DE INFRAESTRUCTURA (Adaptadores externos)
│   │   ├── access_reader.py        # Anti-Corruption Layer para Access .mdb
│   │   ├── llm_gateway.py          # Pasarela Tool Calling (Groq / Gemini / Local)
│   │   └── sqlite_builder.py       # Constructor de base de datos SQLite relacional
│   └── server/                     # CAPA DE SERVIDOR / API GATEWAY
│       └── app.py                  # Servidor HTTP, auth HMAC y serving estático
├── scripts/
│   ├── generate_demo_db.py         # Generador determinista de dataset sintético realista
│   └── run_server.py               # Punto de entrada del servidor
├── tests/                          # SUITE DE PRUEBAS ESTRATIFICADA
│   ├── unit/
│   │   ├── test_domain.py          # Tests unitarios de reglas de dominio
│   │   └── test_intents.py         # Tests de intents y sentencias parametrizadas
│   └── integration/
│       ├── test_demo_db.py         # Tests de integridad relacional del dataset sintético
│       └── test_server.py          # Tests de endpoints HTTP y autenticación
├── compose.yaml                    # Orquestación Docker Compose
├── Dockerfile                      # Construcción de contenedor multi-stage
├── pyproject.toml                  # Configuración de paquete y linter Ruff
└── README.md
```

---

## Pila Tecnológica

| Capa | Tecnologías | Propósito |
| :--- | :--- | :--- |
| **Frontend PWA** | Vanilla JavaScript, CSS3 moderno, HTML5 | Rendimiento nativo sin dependencias de frameworks, arranque instantáneo y uso táctil en exteriores. |
| **Almacenamiento Local** | SQL.js (SQLite WebAssembly) + IndexedDB | Ejecución de consultas relacionales completas (JOINs, agregaciones) en el propio dispositivo móvil. |
| **Backend / API** | Python 3.12 (Standard Library HTTP / ASGI) | Pasarela ligera (< 30 MB RAM) para autenticación HMAC, descarga segura de base de datos y proxy de voz/IA. |
| **IA & Transcripción** | Groq Whisper Large v3 + Tool Calling | Transcripción de audio de baja latencia y clasificación estructurada de intenciones. |
| **DevOps & CI/CD** | Docker, Docker Compose, GitHub Actions | Contenedorización segura (usuario no root, healthchecks) y verificación continua de calidad. |

---

## Inicio Rápido

### Despliegue con Docker Compose (Recomendado)

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/Alvaro137/ganaderos.git
   cd ganaderos
   ```

2. Configurar variables de entorno (opcional si se utiliza el dataset demo):
   ```bash
   cp .env.example .env
   ```

3. Levantar el servicio:
   ```bash
   docker compose up -d
   ```

4. Abrir en el navegador:
   ```text
   http://localhost:8000
   ```
   *(Contraseña predeterminada de acceso al censo: `mvp-testing`)*

---

### Ejecución Local en Python

1. Requisitos: Python 3.10 o superior.

2. Generar el dataset demo sintético con razas autóctonas (Morucha, Limusina, Charolesa):
   ```bash
   python scripts/generate_demo_db.py --animales 150
   ```

3. Iniciar el servidor local:
   ```bash
   python scripts/run_server.py
   ```

4. Acceder a `http://localhost:8000`.

---

## Control de Calidad y Pruebas

Ejecutar la suite estratificada completa de pruebas unitarias y de integración:

```bash
python -m unittest discover tests
```

Validación de estilo y análisis estático de código:

```bash
ruff check src/ scripts/ tests/
```

---

## Seguridad y Privacidad de Datos

- **Privacidad de Censo:** Los registros de la explotación nunca se envían al modelo de lenguaje. El LLM únicamente procesa el lenguaje natural para extraer la intención y devuelve la función correspondiente; la consulta resultante se ejecuta en el navegador del usuario.
- **Autenticación HMAC:** Las sesiones emiten tokens criptográficos firmados con `HMAC-SHA256` y expiración automática para proteger la descarga de la base de datos relacional.
- **Inmunidad a Inyección:** El `QueryBuilder` utiliza consultas estrictamente parametrizadas con variables ligadas (`?`), garantizando aislamiento total frente a entradas de usuario maliciosas.
- **Dataset Demo Anonimizado:** El repositorio público no incluye información personal ni registros de producción; incluye un generador determinista (`generate_demo_db.py`) para pruebas locales y demostraciones.

---

## Licencia

Este proyecto se distribuye bajo la licencia MIT. Consulta el archivo `LICENSE` para más información.
