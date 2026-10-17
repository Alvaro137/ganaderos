@echo off
chcp 65001 >nul
rem ============================================================
rem Sincronizar Access bdlibro.mdb (Recetas + Censo) con Orange Pi
rem ============================================================
cd /d "%~dp0.."
echo ============================================================
echo   Sincronizando bdlibro.mdb con la Orange Pi y Git Vault
echo ============================================================

python "%~dp0sync_access_merge.py" --force-export %*

if errorlevel 1 (
    echo.
    echo Ha ocurrido un error al sincronizar. Pulsa una tecla para cerrar...
    pause >nul
) else (
    echo.
    echo [OK] Base de datos sincronizada con exito con la Orange Pi y moviles.
    timeout /t 5
)
