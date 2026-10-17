# AGENTS.md. Instrucciones para agentes de IA

Lee primero [`CONTEXT.md`](./CONTEXT.md). Es la memoria maestra del proyecto (arquitectura, despliegue en la Orange Pi, autenticación, trampas conocidas y pendientes).

Reglas de oro:
1. Nada se despliega sin: tests locales en verde → push `develop` → PR de `develop` a `master` (nunca push directo a `master`) → merge de la PR → `git pull` en la OPi → pedir al usuario `sudo systemctl restart ganaderos`.
2. El servicio de producción es systemd (`ganaderos.service`, puerto 8010), no Docker. El puerto 8000 es la estación meteorológica: no tocar.
3. Tras correr pytest, restaurar `pwa/ganaderos_demo.sqlite` antes de commitear.
4. No commitear: `.opencode/`, `scratch/`, `decompiled/`, `original/`, `hola.txt`.
5. No leer ni publicar `.env` (contiene claves).
6. Comandos con sudo: nunca ejecutar `sudo` de forma autónoma ni adivinar claves. Pedir siempre los comandos con sudo explícitamente al dueño del repo.


