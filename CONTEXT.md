# Contexto maestro del proyecto

> **Propósito**: este documento es la memoria persistente del proyecto. Define los fundamentos de arquitectura, el modelo de datos, las decisiones de diseño y las convenciones de ingeniería del sistema.
> Última actualización: 2026-11-08.

---

## 1. Qué es este proyecto

Ganaderos Campo es una Progressive Web App (PWA) con arquitectura local-first para la gestión operativa y el censo de vacuno de carne en pastos y dehesas (animales, lotes, movimientos, partos, recetas sanitarias, compras de pienso, rendimientos en canal y rentabilidad) sin dependencia de cobertura móvil en campo.

- **Usuario objetivo**: operador ganadero y personal técnico en campo.
- **Criterio de búsqueda operativa**: últimos 4 dígitos del crotal oficial (por ejemplo, `ES000810740273` -> `0273`).
- **Origen de datos heredado**: Microsoft Access (`bdlibro.mdb`, protegido por credencial configurada en `GANADEROS_DB_PASSWORD`).
- **Flujo de datos local-first**: el equipo de oficina exporta un espejo relacional en SQLite; el dispositivo cliente lo descarga una única vez y ejecuta las consultas analíticas y relacionales directamente en el navegador mediante SQLite compilado a WebAssembly (SQL.js) con persistencia en IndexedDB. El cliente móvil no realiza peticiones HTTP para consultar el censo.

---

## 2. Arquitectura del sistema

```text
[ Access bdlibro.mdb ] --(ETL/Sync)--> [ SQLite Espejo ] --> [ Servidor API FastAPI ]
                                                                      |
                                                               (HTTP / Caddy TLS)
                                                                      |
[ PWA Cliente (Vanilla JS ES Modules) ] <----(Descarga 1 vez)---------+
   └─ Motor SQLite WASM (SQL.js + IndexedDB)
      Consultas relacionales 100% locales en campo (0 latencia, 0 peticiones)
```

### Capas del backend (Clean / Hexagonal Architecture)
- **`src/domain`**: entidades inmutables y reglas de negocio puras sin dependencias externas (`Animal`, `Parto`, `RecetaSanitaria`, `Movimiento`, `CompraAlimento`), objetos de valor (`Crotal`, `ExplotacionCEA`, `PeriodoSupresion`) e interfaces abstractas de repositorio (`repositories.py`).
- **`src/application`**: casos de uso y orquestación (`CensoService`, `SanidadService`, `GenealogiaService`), asistente analítico con agente Text-to-SQL en sandbox SQLite de solo lectura (`sql_sandbox.py`, `ai_domain_schema.py`) y fallback determinista a Intent Calling tipado (`query_builder.py`).
- **`src/infrastructure`**: implementaciones SQLite de repositorios (`repositories.py`), pasarela de modelos de lenguaje con clientes asíncronos (`llm_gateway.py`), adaptadores para base de datos heredada (`access_reader.py`) y motor de copias versionadas (`backup_vault.py`).
- **`src/server`**: servidor asíncrono ASGI con FastAPI (`app.py`), esquemas de validación Pydantic v2 (`schemas.py`), endpoints tipados, documentación interactiva OpenAPI en `/docs` y gestión de ciclo de vida con `lifespan`.

### Frontend modular (Vanilla JS + ES Modules)
- Directorio `pwa/` estructurado en módulos nativos (`pwa/js/modules/`): `auth.js`, `api.js`, `db.js`, `voice.js`, `config.js` y componentes de vista en `views/`.
- Service Worker (`pwa/sw.js`): precaching de activos estáticos, recursos WebAssembly y soporte offline integral.
- Cola de salida offline (`outbox.js`): almacén transaccional en IndexedDB (`GanaderosMutacionesOffline`) para registro optimista en campo de eventos (partos, movimientos, pesajes) y sincronización diferida contra `/api/sync/push`.

---

## 3. Infraestructura y despliegue

- **Servidor Edge**: despliegue sobre Linux en servidor edge de bajo consumo.
- **Topología de red**:
  - Servidor web y proxy inverso: Caddy con certificados TLS automáticos.
  - Exposición segura: túnel Cloudflare Zero Trust aislando los servicios internos.
  - Separación de servicios: la API de Ganaderos escucha en la interfaz de bucle local (`127.0.0.1:8010`), delegando el tráfico externo al proxy inverso.
  - Puertos reservados para servicios coexistentes: puerto `8000` (servicio telemétrico independiente), puerto `8010` (Ganaderos API), puerto `3001` (microservicio de enrutamiento IA).
- **Gestión del servicio**: ejecutado como unidad de systemd (`ganaderos.service`) en entorno virtual aislado de Python con recarga atómica.
- **Persistencia y optimización de I/O**:
  - SQLite configurado en modo WAL (`PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 10000`) para lecturas concurrentes sin bloqueo y reducción de ciclos de escritura en tarjetas de almacenamiento.
  - Directorio de logs y volúmenes intensivos parametrizables en rutas de almacenamiento dedicadas (`STORAGE_MOUNT`).
- **Versionado inmutable de base de datos (Git Vault)**:
  - Repositorio Git secundario aislado parametrizable mediante la variable `GANADEROS_VAULT_REMOTE`.
  - Almacena instantáneas versionadas de la base de datos de gestión, réplica SQLite y volcado plano determinista (`dumps/censo_dump.sql`) para auditoría de diferencias estructurales mediante `git diff`.

---

## 4. Control de versiones y flujo de trabajo Git

- **Ramas del repositorio**:
  - `master`: código productivo y estable.
  - `develop`: rama de integración para desarrollo continuo.
  - `feature/<nombre>`: ramas de características creadas a partir de `develop`.
- **Integración continua**:
  - Todo cambio hacia `develop` o `master` debe superar la pipeline automatizada de CI (Ruff, Pytest, pruebas de módulos frontend en Node.js, escaneo de dependencias con Pip-Audit y análisis SAST con Bandit).
- **Archivos y rutas de trabajo excluidos**:
  - Documentación operativa y parámetros de infraestructura local (`OPS.md`, `*.local.md`).
  - Secretos y variables de entorno (`.env`, `*.env`).
  - Directorios de trabajo y análisis (`.opencode/`, `scratch/`, `decompiled/`, `original/`).
  - Bases de datos con información real de explotación.

---

## 5. Autenticación y control de acceso (Patrón KISS)

- **Mecanismo de acceso**: pantalla con selector de operador funcional y contraseña compartida de la explotación.
- **Atribución de acciones**: el identificador del operador (`user_id`) se adjunta a cada mutación para garantizar la trazabilidad de los registros generados en campo.
- **Token de sesión**: HMAC-SHA256 (`expira:user_id:rol:nonce.firma`) generado en `/api/auth/login` y validado en el middleware de autenticación, firmado mediante `PWA_SECRET_KEY`.
- **Resiliencia offline**: la interfaz almacena la lista de operadores en caché local (`campo_pwa_users_cache`), permitiendo el renderizado y la operación en áreas sin conectividad.

---

## 6. Pruebas y control de calidad

Comandos estándar para la verificación del proyecto:

```bash
# 1. Análisis estático y formateo (Linter)
python -m ruff check src/ tests/ scripts/

# 2. Pruebas unitarias y de integración del backend
python -m pytest tests/ -q

# 3. Pruebas unitarias de módulos frontend (ES Modules en Node.js)
node tests/frontend/test_modules.mjs

# 4. Pruebas End-to-End en navegador (Playwright)
npx playwright test tests/e2e/
```

> [!NOTE]
> Tras la ejecución de los tests de integración en backend, restaurar el archivo de pruebas `pwa/ganaderos_demo.sqlite` mediante `git checkout -- pwa/ganaderos_demo.sqlite` para asegurar un árbol de trabajo limpio.

---

## 7. Decisiones de resiliencia y trampas resueltas

1. **Ciclo de vida en módulos ES**: los scripts con `type="module"` difieren su ejecución. En inicializaciones tras recarga o cierre de sesión, se verifica siempre `document.readyState !== 'loading'` para evitar bloqueos del inicializador.
2. **Actualización de base de datos en caliente en SQLite WASM**: al descargarse una nueva versión del censo en segundo plano, la instancia en memoria se recarga de forma transparente (`_reemplazarBaseDatosEnCaliente`), emitiendo el evento `campo:db-updated` sin forzar la pérdida de navegación activa del usuario.
3. **Manejo de bloqueos en IndexedDB**: las transacciones locales cuentan con temporizadores de expiración segura para evitar bloqueos si múltiples pestañas acceden al almacenamiento simultáneamente.
4. **Protección de mutaciones antes de sobrescritura**: antes de reemplazar la base de datos local con un censo nuevo recibido del servidor, `_verificarYVaciarOutbox()` despacha o preserva las mutaciones pendientes de envío para garantizar la no pérdida de registros de campo.
5. **Aislamiento de sandbox SQL**: las consultas en lenguaje natural traducidas por el agente analítico se ejecutan en una conexión secundaria de solo lectura (`PRAGMA query_only = ON`) y tiempo límite acotado, bloqueando cualquier mutación DDL/DML.

---

## 8. Glosario técnico

- **Crotal**: identificador oficial auricular del animal (código alfanumérico internacional). `crotal_4`: últimos 4 dígitos utilizados en el ámbito operativo diario para identificación táctil rápida.
- **REGA / CEA**: código oficial de registro de la explotación ganadera (ejemplo: `ES000000000000`).
- **Supresión de carne**: período de espera reglamentario tras la administración de un tratamiento veterinario antes de que el animal pueda ser sacrificado para consumo (`tiempo_carne` en recetas).
- **Local-first**: modelo de arquitectura donde la réplica de base de datos y la capacidad de consulta residen íntegramente en el cliente móvil, utilizándose el backend exclusivamente para sincronización y servicios periféricos.
- **Git Vault**: repositorio Git complementario configurado para el archivo determinista de instantáneas binarias y volcados SQL con garantías criptográficas de inmutabilidad.
