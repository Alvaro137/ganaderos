# CONTEXT.md — Contexto Maestro del Proyecto (para humanos e IAs)

> **Propósito**: Este documento es la memoria persistente del proyecto. Si cambias de IA,
> de IDE o vuelves al proyecto tras meses, léelo completo antes de tocar nada.
> Última actualización: 2026-09-23 (post-login KISS).

---

## 1. Qué es este proyecto

**Ganaderos Campo**: PWA local-first para que un ganadero de vacuno de carne consulte
su censo (animales, lotes, movimientos, partos, recetas, compras de pienso) **en el campo,
sin cobertura móvil**, desde el móvil.

- Usuario real: el ganadero (y su ayudante Paco), con guantes, sol y una mano libre.
- Búsqueda principal: **últimos 4 dígitos del crotal** (ej. `ES000810740273` → `0273`).
- Origen de datos: Access legacy `C:\GANADEROS 10\bdlibro.mdb` (password `sggnetpy04`, 32-bit, frágil).
- **El móvil NUNCA toca el Access**. El PC exporta un SQLite espejo; el móvil lo descarga
  una vez y ejecuta SQL localmente (SQLite WASM + IndexedDB). Offline real.

## 2. Arquitectura (resumen operativo)

```
bdlibro.mdb (PC) --exportador--> ganaderos_demo.sqlite --> servido por FastAPI
                                                                   |
PWA (Vanilla JS, ES Modules, sin bundler) <--descarga 1 vez-- Orange Pi + Caddy (HTTPS)
   └─ SQLite WASM: todas las consultas corren en el móvil, 0 HTTP al consultar
```

- **Backend**: FastAPI + Uvicorn (`src/server/app.py`). Arquitectura hexagonal:
  `src/domain` (entidades, value objects `Crotal`/`ExplotacionCEA`, excepciones),
  `src/application` (servicios, `query_builder.py` = **Intent Calling tipado**: el LLM
  extrae parámetros, el SQL lo construye el código con `?` parametrizados — sin Text-to-SQL libre),
  `src/infrastructure` (repositorios SQLite, `llm_gateway.py`), `src/server` (FastAPI, schemas Pydantic).
- **Frontend**: `pwa/` con ES Modules nativos (`pwa/js/modules/`: auth, api, voice, config...).
  `pwa/sw.js` precachea todo (offline desde la 1ª carga). **Sube `CACHE_NAME` (v21 actual)
  en cada cambio de frontend** o el móvil seguirá viendo la versión vieja.
- **IA**: proxy multi-proveedor (Groq / Gemini / OpenRouter) con rotación por cuota 429,
  Whisper para dictado por voz. Claves en `.env` (NUNCA en el repo).
- **ADRs**: decisiones formales en `docs/adr/` (0001-0008): SQLite WASM, Intent Calling,
  Clean Architecture, estrategia offline, ES Modules, logging, parseo de fechas legacy, etc.


## 3. Infraestructura y despliegue (Orange Pi Zero 3)

- Máquina: `orangepizero3`, usuario **`varo`**, alias SSH local: **`opi-lan`**.
  App en `~/ganaderos_pwa`. Stack local: Armbian + Caddy.
- **El servicio NO es Docker**: corre con **systemd** → `ganaderos.service`
  (`/etc/systemd/system/ganaderos.service`): ejecuta `venv/bin/python src/server/app.py 8010`,
  `User=varo`, y **carga el `.env` con `EnvironmentFile`**.
  - Reiniciar: `sudo systemctl restart ganaderos` (pide password de sudo).
  - Healthcheck: `curl http://localhost:8010/api/health` → `{"status":"healthy",...,"version":"2.0.0"}`.
- **Puertos**: 8010 = Ganaderos Campo. **8000 = estación meteorológica Sainlogic (OTRO servicio,
  no confundir con esta app)**. 80/443 = Caddy.
- **Caddy** (`/etc/caddy/Caddyfile`, dominio `varo137.ddns.net`):
  `/campo/*` → `127.0.0.1:8010` (esta app); el resto → 8000 (meteo).
- **Docker existe en el repo** (compose.yaml/Dockerfile para CI/portabilidad) pero **no es
  cómo corre en producción**. Hay un contenedor viejo `ganaderos:latest` sin usar.
  El usuario `varo` NO está en el grupo `docker` (solo `orangepi`); usar sudo para docker.
- **Despliegue estándar** (protocolo acordado):
  1. Validar en local: `python -m pytest tests/ -q`, `node tests/frontend/test_modules.mjs`,
     `ruff check src/ tests/`.
  2. Push a `develop` → CI verde → merge a `master` → push.
  3. En la OPi: `cd ~/ganaderos_pwa && git pull`.
  4. `sudo systemctl restart ganaderos` + healthcheck.
  - **Cero despliegues en caliente** salvo emergencia.

## 4. Git y estructura del repo

- Remote: `origin` = `https://github.com/Alvaro137/ganaderos.git`.
- Ramas: `master` (producción) y `develop` (integración), sincronizadas con merges `--no-ff`.
  Flujo de features: rama `feature/xxx` desde `develop` → merge a `develop` → merge a `master`.
- **Layout**: el proyecto vive en la **RAÍZ del repo** (`src/`, `pwa/`, `tests/`, `docs/`, `config/`).
  ⚠️ Existe además `python/campo-pwa/` con una **línea histórica antigua e inconexa** (servidor
  stdlib `http.server`, PWA previa). NO mezclar esa historia con la actual — no comparten
  ancestro git. Se conserva como archivo.
- **Los tests mueven/crean ficheros**: `pwa/ganaderos_demo.sqlite` aparece modificado tras
  correr pytest → hacer `git checkout -- pwa/ganaderos_demo.sqlite` antes de commitear.
- Ficheros locales sin trackear que NO son del proyecto (no commitear): `.opencode/`,
  `decompiled/`, `original/`, `scratch/`, `hola.txt`, `scripts/test_groq_live.py`.


## 5. Autenticación — diseño ACTUAL (post-KISS, commit b7c40f3)

**Historia en 3 actos** (para entender decisiones pasadas):
1. Password única compartida (`PWA_PASSWORD`, default `mvp-testing`) → token HMAC 30 días.
2. Feature `multi-user-rbac` (otra IA): RBAC con roles admin/vaquero/veterinario + PIN de 4
   dígitos + teclado táctil + contraseña maestra. **El dueño la rechazó**: sobre-ingeniería.
3. **Actual (KISS)**: login = "¿Quién eres?" (elegir operador) + **contraseña compartida de
   la explotación**. Sin PINs, sin teclado, sin roles visibles, sin usuario vet.

**Objetivo real del multi-usuario**: solo **atribución** (saber quién hizo qué consultas)
para una futura **consolidación/merge de bases de datos**. NO hay permisos ni roles funcionales.

Detalles técnicos:
- `POST /api/auth/login` acepta `{password, user_id?}`. Con `user_id` válido emite token
  firmado con ese usuario; sin `user_id` o inválido → `usr_admin` (Álvaro) por defecto.
- Token: HMAC-SHA256 (`expira:user_id:rol:nonce.firma`), clave = `PWA_SECRET_KEY`
  (en `.env` de la OPi, valor aleatorio). **⚠️ El `PWA_AUTH_SECRET` del compose.yaml es un
  nombre muerto**: el código usa `PWA_SECRET_KEY`. Pendiente de arreglar en el repo.
- Usuarios sembrados (solo si la tabla `usuarios` está vacía): `usr_admin` (Álvaro, admin)
  + `usr_jose`, `usr_amelia`, `usr_alex`, `usr_otro` (rol `operador`, todos iguales).
  `usr_paco` y `usr_vet` fueron eliminados de la BD real de la OPi.
- Frontend: `pwa/js/modules/auth.js` — pantalla única: tarjetas de operador + formulario
  de contraseña siempre visible; 2º clic en tarjeta = deseleccionar. Respaldo offline con
  caché de usuarios (`campo_pwa_users_cache`). Renderizado inmediato sin esperar a la red.
- Backdoor E2E: el token literal `e2e-valid-auth-token` solo se acepta si `APP_ENV=e2e` o `test`.

## 6. Cómo correr las pruebas (local, Windows)

```bat
python -m pytest tests/ -q            :: 94 tests (unit + integration)
node tests/frontend/test_modules.mjs  :: 16 tests de módulos ES
node --check pwa/js/modules/auth.js   :: sintaxis de un módulo suelto
python -m ruff check src/ tests/      :: lint (CI exige 0 errores)
npx playwright test tests/e2e/        :: E2E (requiere navegadores instalados)
```
CI: `.github/workflows/ci.yml` (ruff + pytest + build Docker) en push a master/develop y PRs.


## 7. Trampas conocidas (leer antes de operar)

1. **Sesiones SSH anidadas**: si un comando queda "colgado", puede que el terminal esté
   DENTRO de la OPi (ssh interactivo abierto) y el alias `opi-lan` no exista ahí. Salir con `exit`.
2. **PowerShell expande `$(...)` localmente** en `ssh host "cmd $(...)"`. Para ejecutarlo en
   el remoto, usar comillas simples: `ssh host 'cmd $(...)'`.
3. `read_files` con rangos puede devolver "outdated" si el fichero cambia; relectura simple.
4. `git archive` produce tars problemáticos en Windows; preferir `git checkout <ref> -- .`
   o `git show ref:ruta`.
5. Tras pytest, restaurar `pwa/ganaderos_demo.sqlite` (ver §4).
6. El `.env` del repo local NO se lee por IA por petición del dueño (contiene claves).
   `cargar_env()` / `_cargar_env_file()` es el mecanismo del código.
7. **El CWD de la shell se resetea entre comandos**: si se envían varios comandos separados,
   cada uno debe empezar con `Set-Location` a la ruta absoluta del repo.
8. **BD de PRODUCCIÓN en la OPi**: `pwa/ganaderos_campo.sqlite` (export real, ~1.6 MB, NO
   trackeada por git). La `ganaderos_demo.sqlite` trackeada es solo para tests/demos.
   No confundir al ejecutar SQL directo sobre producción. En paralelo con 5: si pytest
   ensucia el demo, restaurar con `git checkout --`, pero NUNCA tocar así la BD real de la OPi.
9. **Comandos git secuenciales**: si se lanzan varios git (checkout/merge/push) en el mismo
   lote, ejecutarlos como comandos INDEPENDIENTES y secuenciales; en paralelo compiten
   (locks "another git process", pushes perdidos, merges a rama equivocada).
10. **Comandos con sudo**: NUNCA ejecutar `sudo` de forma autónoma ni intentar adivinar credenciales.
    Pedir siempre explícitamente al dueño del repo los comandos que requieran `sudo` en la OPi.
11. **`DOMContentLoaded` en ES Modules (`type="module"`)**: los módulos son diferidos por
    diseño. En recargas rápidas o tras logout (`location.reload()`), el parser puede terminar
    antes de registrar el listener (`document.readyState === 'interactive'` o `'complete'`),
    dejando la app colgada en el loader inicial para siempre. Comprobar siempre:
    `if (document.readyState === 'loading') { addEventListener(...) } else { bootstrap(); }`.
12. **Recarga en caliente de SQLite WASM en cliente**: tras descargar una BD nueva en background,
    `this.db` en memoria no se actualiza sola. Hay que sustituir la instancia (`_reemplazarBaseDatosEnCaliente`),
    disparar evento custom (`campo:db-updated`) y re-renderizar las vistas al vuelo.
13. **Timeouts defensivos en IndexedDB**: llamadas a `objectStore.get()` pueden encallarse si
    otra pestaña o el Service Worker bloquea el storage. Envolver siempre en `Promise.race` con
    un timeout razonable (ej. 1.5s) que degrade a `null` de forma segura.

## 8. Estado y pendientes (2026-09-29)

- [x] Login KISS desplegado y ACTIVO en producción (verificado: `POST /api/auth/login`
  con `user_id` devuelve al operador elegido).
- [x] `PWA_SECRET_KEY` aleatoria en el `.env` de la OPi.
- [x] Roster de operadores: Álvaro (admin) + Jose, Amelia, Alex, Otro (rol único `operador`).
  Desplegado y **resincronizado en la BD real** de la OPi (`ganaderos_campo.sqlite`; backup
  en `/home/varo/ganaderos_campo_backup_20260929_1706.sqlite`). `usr_paco` y `usr_vet` eliminados de producción.
- [x] Cambio de contraseña de la explotación (`POST /api/auth/change-password` + formulario en modal de usuario solo para admin) con persistencia en `.env` y memoria.
- [x] Gatear el backdoor `e2e-valid-auth-token` por entorno (`APP_ENV` en `e2e` / `test`).
- [x] Eliminar endpoint legado `/api/auth/login-pin` y su schema `PinLoginRequest`.
- [x] **Actualización de Base de Datos de Producción (Agosto 2026):** Extraído directamente de
  `db-actualizada/bdlibro.mdb` (374 compras con importes y precio/kg corregidos, 2397 animales,
  2228 partos, 5534 movimientos). Desplegado a `pwa/ganaderos_campo.sqlite` en la OPi.
- [x] **PR #15 — Sincronización en caliente y usabilidad:**
  - Recarga en memoria WASM (`this.db`) al recibir una BD nueva en background sin requerir recargar la página.
  - Botón directo `🔄 Sincronizar censo ahora` en el modal de usuario con feedback visual.
  - Paginación incremental (`Mostrar más animales (+50)`) con contador de coincidencias (`Mostrando X de Y`).
  - Contraseña del backend por defecto fijada a `ganaderos` (compatible con `mvp-testing` en tests).
  - Service Worker v24.
- [x] **PR #16 — Estabilidad de arranque y login instantáneo:**
  - Bootstrap seguro verificando `document.readyState !== 'loading'` para evitar que la app quede colgada en el spinner inicial tras un reload/logout.
  - Timeout defensivo de 1.5s en transacciones de IndexedDB.
  - Renderizado instantáneo de la pantalla de login desde caché/defaults sin bloquearse esperando a la red.
  - Service Worker v25.
- [x] **PR #17 — Épica Campo (Fase 1 y 2.1) + Reglas de Oro:**
  - **Fase 1 completada (Motor Outbox Local-First):**
    - Módulo `pwa/js/modules/outbox.js`: store `GanaderosMutacionesOffline` en IndexedDB con soporte para tipos de eventos auditados (`parto`, `movimiento`, `tratamiento`, `pesaje`, `nota`), generación de UUID, status `pending`/`synced` y modal de inspección táctil de la cola.
    - Badge visual en header (`🟢 Al día` / `🟡 N pendientes de sincronizar`) y botón de sincronización manual.
    - Sincronización transparente con el endpoint `/api/sync/push` de la Orange Pi.
  - **Fase 2.1 completada (Registro de Parto y Nacimiento Offline):**
    - Modal táctil `pwa/js/modules/views/birth_modal.js` con touch-targets de ≥48px.
    - Búsqueda táctil de madres reconociendo `Vaca`, `Hembra`, `Hembras` y `H`.
    - Botón de acceso directo en cabecera del buscador y en la ficha técnica de vacas activas.
    - Persistencia optimista instantánea en SQLite WASM (`db_client.js`) que inserta el parto y la cría en el censo en 0 ms.
    - Service Worker v26.
  - **Fase 3 completada (Endpoint de Ingesta y Auditoría en Orange Pi):**
    - `POST /api/sync/push` y `GET /api/sync/estado`: tabla append-only `eventos_campo` en SQLite del hub con epoch incremental, idempotencia estricta por UUID y validación de tipos.
  - **Tests y Reglas de Oro:**
    - Test 08 E2E en Playwright validando flujo completo de parto y outbox.
    - En `AGENTS.md`: Prohibición estricta de push directo a `master` (siempre `develop` -> PR -> merge) y regla de `sudo` sin adivinar claves ni ejecución autónoma.
- [x] Arreglar `compose.yaml`: pasar `PWA_SECRET_KEY` y `PWA_PASSWORD=${PWA_PASSWORD:-ganaderos}` (eliminada variable obsoleta `PWA_AUTH_SECRET`).
- [x] **PR #19 — Refactorización integral de arquitectura limpia y resiliencia:**
  - **Asincronía real en IA:** `llm_gateway.py` migrado a `httpx.AsyncClient` liberando el event loop de Uvicorn/FastAPI.
  - **Erradicación de bootstrap hacks:** Eliminado `os.execve` con `_VENV_CANDIDATES` en `app.py`.
  - **Fail-fast y observabilidad:** Structured logging (`logger.error(..., exc_info=True)`) en lectores de Access y arranque de BD en lugar de excepciones silenciosas.
  - **Resiliencia IndexedDB:** Eliminados timeouts arbitrarios de 1.5s en `db_client.js` y `outbox.js`.
  - **Optimización en repositorios:** Nuevos métodos SQL `list_activos()`, `list_reproductoras()`, `count_activos()` evitando filtrado masivo en memoria RAM de Python.
- [x] **PR #21 — Erradicación de Deuda Técnica y Vulnerabilidades de Red Teaming:**
  - **Blindaje de contratos de dominio:** Eliminado `hasattr` y fallback a `list_all` en `CensoService` y `GenealogiaService`. Formalizado protocolo `IntentResolver`.
  - **Seguridad en `.env`:** Reescritura atómica segura mediante `tempfile.mkstemp` + `os.fsync` + `os.replace` con `threading.Lock` y sanitización contra inyección de variables en `_set_password`.
  - **DRY y limpieza de paths:** Eliminado path absoluto `/home/varo` en `llm_gateway.py` y extraídas funciones helper compartidas para peticiones y parsing de tools.
- [x] **PR #25 — Refuerzo exhaustivo de suite de integración y Playwright E2E sin aserciones triviales:**
  - **Eliminación de aserciones superficiales**: erradicadas comprobaciones de longitud (`length > 30`) y validaciones ciegas de DOM sin transición de estado.
  - **9 flujos E2E completos en Playwright**: arranque/manifiesto, teclado numérico de campo 4 dígitos/vacíos, ficha técnica y genealogía descendente, recetas sanitarias y tiempos de retirada en carne (`DRAXXIN`), módulo de alimentación (piensos/costes), movimientos REGA y navegación cruzada a ficha activa, modo 100% offline con degradación grácil del asistente, ciclo completo de parto offline y sincronización outbox al reconectar, autenticación multi-operador con persistencia tras reload.
  - **Backend y concurrencia**: creado `test_sync_concurrency.py` con `ThreadPoolExecutor` para pruebas multi-operador en paralelo, monotonicidad de epoch, deduplicación e idempotencia estricta, y tests de seguridad en `/api/database`.
  - **Fixes de usabilidad**: botones dinámicos de limpiar filtro siempre interactuables, navegación segura a fichas en movimientos y conservación de selección de animal ante eventos de sincronización.
- [ ] (Opcional) `sudo usermod -aG docker varo` en la OPi.
- [ ] **Siguientes Fases de la Épica de Campo (Local-First Offline Writes & Conciliación con Access):**
  - **Fase 2.2: Cambio de Lote / Ubicación de Animales**:
    - Modal táctil para mover animales o grupos entre cercados (ej. de *DUEÑA* a *CEBADERO* o *RIVERA*).
    - Actualización inmediata del campo `corral` en SQLite local + mutación de tipo `movimiento` en Outbox.
  - **Fase 2.3: Registro de Tratamiento Sanitario en Campo**:
    - Ficha de aplicación de fármaco de la lista oficial, cálculo de fecha fin de supresión de carne y alerta visual sanitaria.
  - **Fase 4: Pipeline de Conciliación con Access (`bdlibro.mdb`)**:
    - Script bidireccional en PC (`scripts/sync_access_merge.py`): extrae eventos no conciliados de la OPi vía API (`/api/sync/eventos`), los inserta en `C:\GANADEROS 10\bdlibro.mdb` (respetando autonuméricos de Access) y marca `conciliado_en_access=1`.
    - Regeneración y despliegue del censo consolidado.

## 9. Glosario rápido

- **Crotal**: identificación oficial del animal (`ES` + dígitos). `crotal_4` = últimos 4
  dígitos, índice de búsqueda principal.
- **REGA/CEA**: código oficial de explotación (ej. `ES371261100121`). Históricas inactivas:
  Cipérez (671) y Cerezal (591); sus movimientos son traspasos internos, no ventas.
- **Supresión de carne**: días de espera tras medicación (`tiempo_carne` en recetas).
- **Local-first**: la verdad se exporta del Access al SQLite; el móvil trabaja sobre su copia.



