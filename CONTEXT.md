# Contexto maestro del proyecto

> **Propósito**: este documento es la memoria persistente del proyecto. Consúltalo antes de realizar cambios en la arquitectura, el código o la infraestructura.
> Última actualización: 2026-10-17.

---

## 1. Qué es este proyecto

Ganaderos Campo es una PWA local-first para consultar el censo de vacuno de carne (animales, lotes, movimientos, partos, recetas, compras de pienso, rendimientos en canal y rentabilidad económica) sin cobertura móvil.

- Usuario: ganadero y ayudante en campo.
- Búsqueda principal: últimos 4 dígitos del crotal (por ejemplo, `ES000810740273` -> `0273`).
- Origen de datos: Microsoft Access (`C:\GANADEROS 10\bdlibro.mdb`, password `sggnetpy04`, 32 bits).
- Flujo de datos: el PC exporta un SQLite espejo; el móvil lo descarga una vez y ejecuta consultas localmente mediante SQLite WASM e IndexedDB. La aplicación en el móvil no se conecta directamente a la base de datos Access.

## 2. Arquitectura (resumen operativo)

```
bdlibro.mdb (PC) --exportador--> ganaderos_demo.sqlite --> servido por FastAPI
                                                                   |
PWA (Vanilla JS, ES Modules, sin bundler) <--descarga 1 vez-- Orange Pi + Caddy (HTTPS)
   └─ SQLite WASM: todas las consultas corren en el móvil, 0 HTTP al consultar
```

- **Backend**: FastAPI + Uvicorn (`src/server/app.py`). Arquitectura hexagonal:
  - `src/domain`: entidades, value objects (`Crotal`, `ExplotacionCEA`), excepciones.
  - `src/application`: servicios, `query_builder.py` con Intent Calling tipado (el LLM extrae parámetros y el código construye SQL parametrizado con `?`, sin Text-to-SQL libre).
  - `src/infrastructure`: repositorios SQLite, `llm_gateway.py`.
  - `src/server`: FastAPI y esquemas Pydantic.
- **Frontend**: directorio `pwa/` con ES Modules nativos (`pwa/js/modules/`: auth, api, voice, config, components/charts_svg.js...). El archivo `pwa/sw.js` precachea los recursos para uso offline. Incrementar `CACHE_NAME` en cada cambio de frontend para invalidar la versión en caché de los clientes (actualmente `ganaderos-campo-v35`).
- **IA**: proxy multi-proveedor (Groq, Gemini, OpenRouter) con rotación ante códigos 429 por límite de cuota. Whisper para dictado por voz. Claves en `.env` (excluido del repositorio).
- **ADRs**: decisiones formales en `docs/adr/` (0001 a 0008): SQLite WASM, Intent Calling, arquitectura limpia, estrategia offline, ES Modules, logging y parseo de fechas legadas.

## 3. Infraestructura y despliegue (Orange Pi Zero 3)

- Máquina: `orangepizero3`, usuario `varo`, alias SSH local: `opi-lan`.
  Ruta de la aplicación: `~/ganaderos_pwa`. Entorno: Armbian + Caddy.
- Servicio de producción: corre bajo systemd con `ganaderos.service` (`/etc/systemd/system/ganaderos.service`). Ejecuta `venv/bin/python src/server/app.py 8010` bajo el usuario `varo`, cargando variables con `EnvironmentFile`.
  - Reinicio: `sudo systemctl restart ganaderos` (habilitado NOPASSWD en `/etc/sudoers.d/ganaderos` para el usuario `varo`).
  - Comprobación de estado: `curl http://localhost:8010/api/health` -> `{"status":"healthy",...,"version":"2.0.0"}`.
- Puertos:
  - 8010: Ganaderos Campo.
  - 8000: estación meteorológica Sainlogic (servicio independiente; no modificar).
  - 80 / 443: servidor web Caddy.
- Caddy (`/etc/caddy/Caddyfile`, dominio `varo137.ddns.net`):
  - `/campo/*` -> proxy a `127.0.0.1:8010`.
  - Resto de rutas -> proxy a `127.0.0.1:8000`.
- Docker: se mantiene en el repositorio (`compose.yaml`, `Dockerfile`) para CI y portabilidad, pero no se utiliza para servir producción. El usuario `varo` no pertenece al grupo `docker`.
- Protocolo de despliegue:
  1. Validar en local: `python -m pytest tests/ -q`, `node tests/frontend/test_modules.mjs`, `ruff check src/ tests/`.
  2. Push a `develop` -> esperar CI en verde -> merge a `master` -> push.
  3. En la Orange Pi: `cd ~/ganaderos_pwa && git pull`.
  4. Ejecutar `sudo systemctl restart ganaderos` y verificar con curl.
  - No realizar despliegues en caliente directamente en producción.

## 4. Git y estructura del repositorio

- Remoto: `origin` = `https://github.com/Alvaro137/ganaderos.git`.
- Ramas: `master` (producción) y `develop` (integración), unificadas mediante merges `--no-ff`.
  Flujo de trabajo: ramas `feature/<nombre>` creadas desde `develop` -> merge a `develop` -> merge a `master`.
- Estructura: el proyecto reside en la raíz (`src/`, `pwa/`, `tests/`, `docs/`, `config/`).
  El directorio `python/campo-pwa/` contiene una versión anterior histórica con `http.server`; no comparte ancestro git y se conserva como archivo de referencia.
- Comportamiento de tests con archivos de datos: la suite de pytest modifica `pwa/ganaderos_demo.sqlite`. Restaurar con `git checkout -- pwa/ganaderos_demo.sqlite` antes de commitear.
- Archivos locales no versionados (no commitear): `.opencode/`, `decompiled/`, `original/`, `scratch/`, `hola.txt`, `scripts/test_groq_live.py`.

## 5. Autenticación: diseño actual (post-KISS, commit b7c40f3)

Evolución del diseño:
1. Versión inicial: contraseña única compartida (`PWA_PASSWORD`, valor por defecto `mvp-testing`) con token HMAC de 30 días.
2. Intento de RBAC: roles admin, vaquero y veterinario con PIN de 4 dígitos, teclado en pantalla y contraseña maestra. Se descartó por complejidad innecesaria.
3. Versión actual (KISS): selección de operador ("¿Quién eres?") y contraseña compartida de la explotación. Sin PIN, sin teclado numérico forzado ni permisos diferenciados.

Objetivo del selector de usuario: atribuir autoría a las acciones para consolidaciones futuras de datos. No aplica restricciones de permisos.

Detalles técnicos:
- `POST /api/auth/login`: recibe `{password, user_id?}`. Con `user_id` válido emite un token asociado; si se omite o es inválido, asigna `usr_admin` (Álvaro).
- Token: HMAC-SHA256 (`expira:user_id:rol:nonce.firma`), firmado con la clave `PWA_SECRET_KEY` configurada en el `.env` de la Orange Pi. Nota: la variable `PWA_AUTH_SECRET` presente en versiones antiguas de `compose.yaml` quedó en desuso; el código consume `PWA_SECRET_KEY`.
- Usuarios iniciales (creados si la tabla `usuarios` está vacía): `usr_admin` (Álvaro, rol `admin`) y `usr_jose`, `usr_amelia`, `usr_alex`, `usr_otro` (rol `operador`). Los usuarios `usr_paco` y `usr_vet` fueron eliminados de la base de datos de producción.
- Frontend: `pwa/js/modules/auth.js`. Pantalla con tarjetas de operador y campo de contraseña visible; un segundo clic en una tarjeta la deselecciona. Mantiene soporte offline mediante caché local (`campo_pwa_users_cache`) y renderiza la vista sin bloquear por peticiones de red.
- Acceso para pruebas E2E: el token literal `e2e-valid-auth-token` solo se acepta si `APP_ENV=e2e` o `APP_ENV=test`.

## 6. Ejecución de pruebas (local, Windows)

```bat
python -m pytest tests/ -q            :: 94 tests (unitarios e integracion)
node tests/frontend/test_modules.mjs  :: 16 tests de modulos ES
node --check pwa/js/modules/auth.js   :: sintaxis de un modulo JS
python -m ruff check src/ tests/      :: linter (CI requiere 0 errores)
npx playwright test tests/e2e/        :: pruebas E2E (requiere navegadores)
```

CI: `.github/workflows/ci.yml` ejecuta ruff, pytest y comprobaciones de seguridad en push a `master`, `develop` y pull requests.

## 7. Trampas conocidas

1. **Sesiones SSH anidadas**: si un comando no responde, verificar si la terminal ya está dentro de una sesión interactiva en la Orange Pi, donde el alias `opi-lan` no existe. Salir con `exit`.
2. **Expansión de variables en PowerShell**: PowerShell evalúa `$(...)` localmente al ejecutar `ssh host "cmd $(...)"`. Usar comillas simples para evaluar en destino: `ssh host 'cmd $(...)'`.
3. **Lectura de archivos por rangos**: peticiones de rangos en herramientas de lectura pueden fallar si el archivo cambia en disco. Repetir la lectura completa si ocurre.
4. **Archivos tar en Windows**: `git archive` genera problemas de codificación de rutas en Windows. Utilizar `git checkout <ref> -- .` o `git show ref:ruta`.
5. **Estado de SQLite tras tests**: restaurar `pwa/ganaderos_demo.sqlite` con `git checkout` tras ejecutar pytest.
6. **Contenido de variables de entorno**: el archivo `.env` local contiene credenciales reales y no debe ser inspeccionado ni enviado en prompts. Utilizar las funciones `cargar_env()` y `_cargar_env_file()`.
7. **Directorio de trabajo en shell**: PowerShell puede reiniciar el directorio de trabajo entre comandos independientes. Especificar la ruta completa o invocar `Set-Location` al inicio de cada bloque.
8. **Base de datos de producción en la Orange Pi**: el archivo activo en la Orange Pi es `pwa/ganaderos_campo.sqlite` (exportación real de ~1.6 MB, no versionada en Git). El archivo `ganaderos_demo.sqlite` versionado es exclusivamente para pruebas y entornos de desarrollo.
9. **Operaciones Git concurrentes**: ejecutar comandos de Git de manera estrictamente secuencial para evitar colisiones en los bloqueos (`index.lock`), referencias cruzadas o pushes interrumpidos.
10. **Comandos con sudo**: no ejecutar `sudo` de forma autónoma ni intentar inferir credenciales. Solicitar explícitamente al operador la ejecución de cualquier instrucción con privilegios en la Orange Pi.
11. **Ciclo de vida `DOMContentLoaded` en módulos ES**: los scripts con `type="module"` difieren su ejecución. Tras un cierre de sesión o recarga rápida, el documento puede encontrarse ya en estado `interactive` o `complete` antes de enlazar el evento, impidiendo que se ejecute el inicializador. Verificar siempre con `document.readyState !== 'loading'`.
12. **Actualización de base de datos en caliente en SQLite WASM**: al descargar una nueva versión de la base de datos en segundo plano, la propiedad `this.db` en memoria no se actualiza de forma automática. Es necesario invocar `_reemplazarBaseDatosEnCaliente`, emitir el evento `campo:db-updated` y actualizar la vista activa.
13. **Llamadas a IndexedDB**: las operaciones sobre almacenes de IndexedDB pueden bloquearse si otra pestaña o el Service Worker mantiene un bloqueo activo. Conectar estas operaciones a promesas con control de tiempo de espera y degradación segura.

## 8. Estado y tareas pendientes

- [x] Login KISS activo en producción (`POST /api/auth/login` con `user_id`).
- [x] Clave `PWA_SECRET_KEY` configurada en el `.env` de la Orange Pi.
- [x] Lista de operadores: Álvaro (admin) junto a Jose, Amelia, Alex y Otro (rol `operador`). Base de datos de producción sincronizada (`pwa/ganaderos_campo.sqlite`; copia de seguridad en `/home/varo/ganaderos_campo_backup_20260929_1706.sqlite`).
- [x] Cambio de contraseña de la explotación (`POST /api/auth/change-password` y modal administrativo) con persistencia en `.env` y memoria.
- [x] Validación del token `e2e-valid-auth-token` restringida a entornos `APP_ENV=e2e` y `APP_ENV=test`.
- [x] Eliminación de endpoint `/api/auth/login-pin` y esquema `PinLoginRequest`.
- [x] Actualización de censo de producción con datos extraídos de `db-actualizada/bdlibro.mdb` (374 compras, 2397 animales, 2228 partos, 5534 movimientos).
- [x] PR #15: sincronización en caliente y usabilidad:
  - Recarga en memoria WASM (`this.db`) al recibir una base de datos nueva en segundo plano.
  - Botón de sincronización manual en el modal de usuario.
  - Paginación incremental (`Mostrar más animales (+50)`) y contador de resultados.
  - Contraseña por defecto del backend fijada en `ganaderos` (compatible con `mvp-testing` en tests).
  - Service Worker v24.
- [x] PR #16: estabilidad de arranque y login:
  - Inicialización basada en `document.readyState !== 'loading'` para evitar bloqueos en recargas.
  - Control de tiempo de espera de 1.5s en transacciones de IndexedDB.
  - Renderizado de la pantalla de login desde valores locales sin esperar respuesta de red.
  - Service Worker v25.
- [x] Funcionalidad de campo (Fases 1 y 2.1) y reglas de desarrollo:
  - Fase 1 (motor de cola de salida local):
    - Módulo `pwa/js/modules/outbox.js`: almacén `GanaderosMutacionesOffline` en IndexedDB para eventos auditados (`parto`, `movimiento`, `tratamiento`, `pesaje`, `nota`), identificadores UUID, estados `pending` y `synced`, y panel de inspección.
    - Indicador de estado en cabecera (`Al día` / `N pendientes de sincronizar`) y botón de envío manual.
    - Envío de mutaciones a `/api/sync/push`.
  - Fase 2.1 (registro de partos offline):
    - Modal `pwa/js/modules/views/birth_modal.js` con controles táctiles de al menos 48px.
    - Filtro de búsqueda de reproductoras por `Vaca`, `Hembra`, `Hembras` y `H`.
    - Acceso directo en el buscador y en la ficha de vacas activas.
    - Inserción optimista directa en SQLite WASM (`db_client.js`) para disponibilidad inmediata en el censo local.
    - Service Worker v26.
  - Fase 3 (ingesta y auditoría en la Orange Pi):
    - Rutas `POST /api/sync/push` y `GET /api/sync/estado` contra la tabla `eventos_campo` en SQLite, con epoch incremental, control de idempotencia por UUID y validación de tipos.
  - Normas de desarrollo:
    - Test 08 E2E en Playwright para el flujo completo de parto y cola de salida.
    - Documentación en `AGENTS.md` con prohibición de push directo a `master` y restricción de ejecución autónoma de `sudo`.
- [x] Actualización de `compose.yaml`: uso de `PWA_SECRET_KEY` y `PWA_PASSWORD=${PWA_PASSWORD:-ganaderos}`, eliminando `PWA_AUTH_SECRET`.
- [x] PR #19: refactorización de arquitectura y resiliencia:
  - Llamadas asíncronas en `llm_gateway.py` mediante `httpx.AsyncClient` para evitar bloqueos en el bucle de eventos.
  - Eliminación de reemplazo de proceso `os.execve` con `_VENV_CANDIDATES` en `app.py`.
  - Registro de errores estructurado (`logger.error(..., exc_info=True)`) en lectura de Access e inicio de base de datos.
  - Retirada de tiempos de espera fijos en `db_client.js` y `outbox.js`.
  - Consultas optimizadas en repositorios: `list_activos()`, `list_reproductoras()` y `count_activos()`, evitando filtrado en memoria de Python.
- [x] PR #21: resolución de deuda técnica y seguridad:
  - Eliminación de comprobaciones `hasattr` y llamadas de reserva a `list_all` en `CensoService` y `GenealogiaService`. Protocolo formalizado para `IntentResolver`.
  - Escritura atómica de `.env` mediante `tempfile.mkstemp`, `os.fsync`, `os.replace` y cerrojo `threading.Lock`, con validación contra inyección de variables en `_set_password`.
  - Eliminación de rutas absolutas locales (`/home/varo`) en `llm_gateway.py` y unificación de funciones auxiliares para peticiones HTTP y procesamiento de respuestas.
- [x] PR #25: suite de integración y pruebas E2E con Playwright:
  - Eliminación de comprobaciones superficiales de longitud y validaciones de DOM sin cambio de estado.
  - 9 flujos E2E en Playwright: carga de manifiesto, teclado numérico de 4 dígitos, ficha técnica y genealogía descendente, recetas sanitarias y tiempo de espera en carne (`DRAXXIN`), registro de alimentación (costes de pienso), movimientos REGA con navegación cruzada, funcionamiento offline con degradación del asistente, ciclo de registro de parto con sincronización posterior y autenticación multi-usuario con recarga.
  - Pruebas de concurrencia: `test_sync_concurrency.py` con `ThreadPoolExecutor` para operaciones simultáneas, monotonicidad de epoch, deduplicación e idempotencia, y validación de seguridad en `/api/database`.
  - Ajustes de interfaz: botones de limpieza de filtros interactivos en todo momento, enlaces seguros en movimientos y conservación de selección de animal tras eventos de sincronización.
- [x] PR #27: modernización de CI/CD, control de secretos y corrección de linter:
  - Corrección de advertencias y orden de importaciones en Ruff.
  - Pipeline de GitHub Actions unificado con pytest, escaneo de secretos con Gitleaks, verificación de `CACHE_NAME` en `sw.js` y almacenamiento de trazas de Playwright en fallos.
  - Traslado de la construcción de imágenes Docker al workflow manual `.github/workflows/docker.yml`.
  - Exclusión en `.gitignore` de directorios temporales (`scratch/`, `decompiled/`).
- [x] PR #28: permisos pull-requests read en CI:
  - Permisos explícitos `pull-requests: read` y `contents: read` en CI para evitar errores HTTP 403 en Gitleaks.
- [x] PR #29: observabilidad (logs en USB), buffer en RAM y Node 22 en CI:
  - Destino configurable de logs en `/mnt/usb/ganaderos_logs` mediante `_resolver_directorio_logs()`, reduciendo ciclos de escritura en la tarjeta MicroSD.
  - Buffer circular en memoria con los últimos 1000 registros, marcas de tiempo y niveles de severidad.
  - Endpoints administrativos protegidos: `GET /api/admin/logs` y `POST /api/admin/logs/level` (restringidos a rol `admin`).
  - Actualización de los flujos de trabajo de GitHub Actions a Node 22.
- [x] Fase 4: pipeline de conciliación bidireccional con Access (`bdlibro.mdb`) y asignación de crotales:
  - Endpoints en el hub: `GET /api/sync/pendientes` (filtro por tipo y `conciliado_en_access = 0`) y `POST /api/sync/conciliado` (exclusivo para admin, registra `crotal_asignado` y marca temporal).
  - Esquema de base de datos: columnas `conciliado_en_access`, `ts_conciliado` y `crotal_asignado` en `campo_registros`, con migraciones automáticas.
  - Script de sincronización en PC (`scripts/sync_access_merge.py`):
    - Autenticación con el servidor remoto.
    - Copia de seguridad automática con marca temporal en `backups/bdlibro_backup_YYYYMMDD_HHMMSS.mdb`.
    - Control de concurrencia mediante `FileLock`.
    - Inserción en orden de integridad referencial: `Animal` -> `Movimiento` ('N') -> `SELECT @@IDENTITY` -> `Parto` -> `UPDATE Animal` (madre) -> `DELETE FROM Crotales`.
    - Asignación secuencial de crotales disponibles y confirmación mediante `POST /api/sync/conciliado`.
    - Regeneración y carga de la base de datos consolidada al servidor.
    - Opciones `--dry-run` y `--skip-export`, con ejecución automática en Python de 32 bits en sistemas Windows de 64 bits.
- [x] Copias de seguridad en Git (Git Backup Vault):
  - Repositorio: `git@github.com:Alvaro137/ganaderos-backup-vault.git` (HTTPS: `https://github.com/Alvaro137/ganaderos-backup-vault.git`).
  - Módulo `src/infrastructure/backup_vault.py` y utilidad CLI `scripts/backup_vault.py`.
  - Almacenamiento de instantáneas de `access/bdlibro.mdb`, `sqlite/ganaderos_campo.sqlite` y volcado de texto determinista `dumps/censo_dump.sql` para auditoría mediante `git diff`.
  - Integrado como paso final en `scripts/sync_access_merge.py`.
- [x] Integridad de datos y concurrencia:
  - Concurrencia en `SyncService`: sincronización con `threading.RLock()` (`_mutation_lock`). SQLite configurado en modo WAL (`PRAGMA journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 10000`) para lecturas concurrentes sin bloqueo y menor desgaste de MicroSD. Manejo de `sqlite3.IntegrityError` para evitar respuestas HTTP 500 en reintentos duplicados. Uso de `os.fsync` previo al reemplazo atómico con `os.replace` en `/api/sync/import`.
  - Control de procesos en Access: detección de procesos finalizados mediante `os.kill` y liberación de bloqueos inactivos tras 10 minutos en `FileLock`. Detección de bloqueos activos mediante `bdlibro.ldb`. Asignación unívoca de crotales (`crotales_libres.pop(0)`) e inserción idempotente de terneros ya registrados en Access.
  - Protección de cola de salida en PWA (`db_client.js`): `_verificarYVaciarOutbox()` despacha mutaciones pendientes antes de sobrescribir la base de datos local con un censo nuevo.
  - Recarga de servicios en FastAPI: `recargar_servicios_dominio()` actualiza las conexiones de FastAPI y los repositorios tras importar datos, sin requerir reinicio del servicio en systemd. Aislamiento de `ganaderos_demo.sqlite` con modo de solo lectura y usuarios en memoria si no existe la tabla correspondiente.
- [ ] Configuración opcional: añadir usuario al grupo Docker con `sudo usermod -aG docker varo` en la Orange Pi.
- [x] Fase 2: mejoras de interfaz y usabilidad en la PWA:
  - Teclado en pantalla: `.touch-keypad` oculto (`display: none;`) por defecto, mostrándose únicamente al activar la clase `.visible` mediante el botón correspondiente.
  - Dimensiones de interacción táctil según WCAG (>=48px): `.btn-nuevo-parto-header` con dimensiones mínimas de 48x48px e icono de 18px; botón de borrado `.btn-input-clear` centrado con área táctil de 48x48px; botón de cierre de modal `#btn-cerrar-modal-parto` de 48x48px; `.btn-toggle-keypad` con altura mínima de 48px.
  - Búsqueda flexible por crotal (1 a 4 dígitos): coincidencia por prefijo, con relleno de ceros (`padStart(4, '0')`) y por sufijo en `db_client.js`, priorizando coincidencias exactas y animales activos.
  - Notificaciones en interfaz: sustitución de llamadas a `alert()` en `birth_modal.js` y `detail_view.js` por mensajes en `#modal-parto-error`, marcado visual de campos requeridos y avisos emergentes tipo toast (`.pwa-toast--visible`).
  - Service Worker: actualización de versión de caché a `ganaderos-campo-v30` en `pwa/sw.js`.
- [x] Seguridad y análisis estático (pre-push y CI SAST):
  - Hook local de Git (`.githooks/pre-push` y `scripts/pre_push_check.py`): ejecución secuencial de Gitleaks, Ruff y Pip-Audit sobre las dependencias de `pyproject.toml` antes de permitir `git push`. Activado con `git config core.hooksPath .githooks`.
  - Bandit en GitHub Actions: análisis de seguridad estático en `src/` y `scripts/` filtrado por nivel medio y alto (`-ll`), configurado en `pyproject.toml`.
  - Pip-Audit en CI: detección de vulnerabilidades conocidas (CVE) en dependencias en cada pull request y push.
- [ ] Plan de trabajo futuro:
  - Registro de pesaje (pendiente de especificación de formato de báscula).
  - Nota: el ganadero descartó explícitamente el cambio de lote o corral y la gestión de recetas o tratamientos desde la PWA.

## 9. Glosario

- **Crotal**: identificador oficial del animal (`ES` seguido de dígitos). `crotal_4`: últimos 4 dígitos utilizados como criterio principal de búsqueda.
- **REGA / CEA**: código oficial de la explotación ganadera (por ejemplo, `ES371261100121`). Explotaciones históricas inactivas: Cipérez (671) y Cerezal (591); sus movimientos corresponden a traslados internos.
- **Supresión de carne**: período de espera obligatorio tras la administración de un fármaco antes del sacrificio (`tiempo_carne` en recetas).
- **Local-first**: modelo de arquitectura donde la base de datos maestra reside en Access, se exporta a SQLite y los clientes móviles operan de forma autónoma sobre réplicas locales.
- **Git Backup Vault**: repositorio Git secundario destinado al almacenamiento versionado de instantáneas de Access, SQLite y volcados SQL deterministas.
