# AGENTS.md — Instrucciones para agentes de IA

**Lee primero [`CONTEXT.md`](./CONTEXT.md): es la memoria maestra del proyecto
(arquitectura, despliegue en la Orange Pi, autenticación, trampas conocidas y pendientes).**

Reglas de oro:
1. Nada se despliega sin: tests locales en verde → push `develop` → merge `master` → `git pull` en la OPi → `sudo systemctl restart ganaderos`.
2. El servicio de producción es **systemd** (`ganaderos.service`, puerto 8010), no Docker.
   El puerto 8000 es la estación meteorológica: no tocar.
3. Tras correr pytest, restaurar `pwa/ganaderos_demo.sqlite` antes de commitear.
4. No commitear: `.opencode/`, `scratch/`, `decompiled/`, `original/`, `hola.txt`.
5. No leer ni publicar `.env` (contiene claves).
