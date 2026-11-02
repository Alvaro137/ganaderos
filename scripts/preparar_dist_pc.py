"""Script para empaquetar de forma limpia y validada la carpeta GanaderosSync para pendrive."""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist" / "GanaderosSync"

if DIST.exists():
    shutil.rmtree(DIST)

DIST.mkdir(parents=True, exist_ok=True)
(DIST / "src").mkdir(parents=True, exist_ok=True)
(DIST / "scripts").mkdir(parents=True, exist_ok=True)
(DIST / "instaladores" / "wheels").mkdir(parents=True, exist_ok=True)

# 1. Copiar src ignorando __pycache__ y .pyc
def ignore_patterns(dir, files):
    return [f for f in files if f == "__pycache__" or f.endswith(".pyc")]

shutil.copytree(ROOT / "src", DIST / "src", ignore=ignore_patterns, dirs_exist_ok=True)

# 2. Copiar scripts necesarios
scripts_to_copy = [
    "ganaderos_launcher.py",
    "sync_access_merge.py",
    "sincronizar_manual.bat",
    "instalar_accesos_directos.ps1",
    "export_gestionavet.py",
]
for s in scripts_to_copy:
    src_file = ROOT / "scripts" / s
    if src_file.exists():
        shutil.copy2(src_file, DIST / "scripts" / s)

# 3. requirements.txt
(DIST / "requirements.txt").write_text("pyodbc>=4.0.39\n", encoding="utf-8")

# 4. .env preconfigurado y .env.example
env_content = (
    "# Configuración de Ganaderos Sync (PC Oficina)\n"
    "GANADEROS_API_URL=https://campo.alvaro137.com\n"
    "PWA_PASSWORD=ganaderos\n\n"
    "# Descomentar si bdlibro.mdb está en una ruta distinta a C:\\GANADEROS 10\\bdlibro.mdb\n"
    "# GANADEROS_DB_PATH=C:\\GANADEROS 10\\bdlibro.mdb\n"
)
(DIST / ".env").write_text(env_content, encoding="utf-8")
(DIST / ".env.example").write_text(env_content, encoding="utf-8")

# 5. iniciar_instalador.bat (1 clic en Windows)
bat_installer = (
    "@echo off\r\n"
    "title Instalador Ganaderos Sync\r\n"
    "color 0B\r\n"
    "echo ==================================================\r\n"
    "echo    GANADEROS 10 - INSTALADOR DE ACCESOS DIRECTOS\r\n"
    "echo ==================================================\r\n"
    "echo.\r\n"
    "echo Configurando accesos directos en el Escritorio...\r\n"
    "powershell -NoProfile -ExecutionPolicy Bypass -File \"%~dp0scripts\\instalar_accesos_directos.ps1\"\r\n"
    "echo.\r\n"
    "echo Proceso completado. Revisa tu Escritorio.\r\n"
    "pause\r\n"
)
(DIST / "iniciar_instalador.bat").write_text(bat_installer, encoding="latin1")

# 6. LEEME_INSTALACION.txt
leeme = """================================================================================
  GUÍA RÁPIDA DE INSTALACIÓN - GANADEROS SYNC (PC GANADEROS 10)
================================================================================

PASO 1: COPIAR AL DISCO LOCAL
--------------------------------------------------------------------------------
1. Conecta este pendrive al ordenador donde está instalado Ganaderos 10.
2. Copia la carpeta completa 'GanaderosSync' a la raíz de tu disco C:
   Quedará en:
      C:\\GanaderosSync\\
   (NUNCA ejecutes la aplicación directamente desde el pendrive).


PASO 2: INSTALAR PYTHON (SI EL PC NO LO TIENE)
--------------------------------------------------------------------------------
Si el ordenador aún no tiene Python instalado:
1. Instala Python versión 32-bit (x86), recomendada versión 3.11 o 3.12.
   ¡MUY IMPORTANTE!: En la primera pantalla del instalador, marca la casilla
   abajo que dice: [X] "Add python.exe to PATH".


PASO 3: INSTALAR EL CONTROLADOR PYODBC
--------------------------------------------------------------------------------
Abre una ventana de comandos (CMD o PowerShell) y escribe:
   pip install pyodbc

* Si el ordenador no tiene internet en ese momento:
   pip install --no-index --find-links=C:\\GanaderosSync\\instaladores\\wheels pyodbc


PASO 4: CREAR LOS ACCESOS DIRECTOS (1 SOLO CLIC)
--------------------------------------------------------------------------------
En la carpeta C:\\GanaderosSync\\:
- Haz doble clic en:
      iniciar_instalador.bat

Esto creará automáticamente dos accesos directos en el Escritorio:
  1. 'Ganaderos 10': Lanza la aplicación oficial sincronizando eventos de campo
     al entrar y actualizando censo + respaldo al salir.
  2. 'Sincronizar con Campo': Icono de rescate para forzar la sincronización
     en cualquier momento sin abrir Access.


PASO 5: COMPROBACIÓN
--------------------------------------------------------------------------------
Haz doble clic en el acceso directo 'Ganaderos 10' del Escritorio.
Al abrirse o al cerrarse, deberías ver la notificación en la esquina inferior:
  "Ganaderos Campo: Censo sincronizado con el móvil y respaldado en Git"
================================================================================
"""
(DIST / "LEEME_INSTALACION.txt").write_text(leeme, encoding="utf-8")

print(f"Carpeta GanaderosSync creada con exito en: {DIST}")
