@echo off
chcp 65001 >nul
title Ganaderos Campo - Sincronización Manual

echo ========================================================
echo   GANADEROS CAMPO - SINCRONIZACION MANUAL DE CENSO
echo ========================================================
echo.
echo Conectando con la Orange Pi y comprobando datos...
echo.

python "%~dp0ganaderos_launcher.py" --no-launch

echo.
echo ========================================================
echo   Proceso finalizado. Puedes cerrar esta ventana.
echo ========================================================
pause
