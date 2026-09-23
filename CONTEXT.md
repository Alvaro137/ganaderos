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
- `POST /api/auth/login-pin` **sigue existiendo como legado** (la UI ya no lo usa). Candidato
  a eliminar en una limpieza futura.
- Token: HMAC-SHA256 (`expira:user_id:rol:nonce.firma`), clave = `PWA_SECRET_KEY`
  (en `.env` de la OPi, valor aleatorio). **⚠️ El `PWA_AUTH_SECRET` del compose.yaml es un
  nombre muerto**: el código usa `PWA_SECRET_KEY`. Pendiente de arreglar en el repo.
- Usuarios sembrados (solo si la tabla `usuarios` está vacía): `usr_admin` (Álvaro, admin)
  + `usr_jose`, `usr_amelia`, `usr_alex`, `usr_otro` (rol `operador`, todos iguales).
  Con `pin_hash='sin-pin'` → el endpoint legado de PIN queda inoperante para estos usuarios.
  `usr_paco` y `usr_vet` fueron eliminados del seed.
- Frontend: `pwa/js/modules/auth.js` — pantalla única: tarjetas de operador + formulario
  de contraseña siempre visible; 2º clic en tarjeta = deseleccionar. Respaldo offline con
  caché de usuarios (`campo_pwa_users_cache`).
- **⚠️ Nuance de despliegue**: los seeds solo aplican a BDs nuevas. La OPi conserva su
  `usuarios` histórica (con `usr_vet`): la pantalla puede mostrar 3 tarjetas. Limpieza
  puntual: `DELETE FROM usuarios WHERE id='usr_vet';` sobre `pwa/ganaderos_demo.sqlite`
  en la OPi (con copia previa o servicio parado).
- Backdoor E2E pendiente de gatear: el token literal `e2e-valid-auth-token` se acepta siempre
  en `extraer_datos_token()` (lo usa Playwright). Debería activarse solo con `APP_ENV=e2e`.

## 6. Cómo correr las pruebas (local, Windows)

```bat
python -m pytest tests/ -q            :: 73 tests (unit + integration)
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

## 8. Estado y pendientes (2026-09-23)

- [x] Login KISS implementado (rama `feature/operator-only-login`, merges en develop/master).
- [x] `PWA_SECRET_KEY` aleatoria en el `.env` de la OPi.
- [ ] **Reiniciar `ganaderos.service` en la OPi** para activar el código nuevo (pendiente del dueño).
- [ ] **Resincronizar la tabla `usuarios` en la BD de la OPi** (la histórica tiene los usuarios
  RBAC antiguos: Álvaro (Administrador), Paco (Vaquero), Veterinario). Ver snippet en la
  conversación del 2026-09-23 o regenerar con los 5 del seed (§5).
- [ ] Limpiar `usr_vet` de la BD de la OPi (ver §5) si aparecen 3 tarjetas.
- [ ] Arreglar `compose.yaml`: pasar `PWA_SECRET_KEY` (hoy pasa `PWA_AUTH_SECRET`, muerto).
- [ ] Gatear el backdoor `e2e-valid-auth-token` por entorno.
- [ ] (Opcional) Eliminar endpoint legado `/api/auth/login-pin` y su schema.
- [ ] (Opcional) `sudo usermod -aG docker varo` en la OPi.
- [ ] (Idea del dueño) UI/UX "field-first": design system propio de alto contraste para sol
  directo, touch targets ≥48px, CrotalBadge con 4 dígitos grandes. Evaluar v0/Stitch con
  prompt de diseño de dominio antes de aceptar su CSS por defecto.

## 9. Glosario rápido

- **Crotal**: identificación oficial del animal (`ES` + dígitos). `crotal_4` = últimos 4
  dígitos, índice de búsqueda principal.
- **REGA/CEA**: código oficial de explotación (ej. `ES371261100121`). Históricas inactivas:
  Cipérez (671) y Cerezal (591); sus movimientos son traspasos internos, no ventas.
- **Supresión de carne**: días de espera tras medicación (`tiempo_carne` en recetas).
- **Local-first**: la verdad se exporta del Access al SQLite; el móvil trabaja sobre su copia.



