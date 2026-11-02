# Instalar Accesos Directos de Ganaderos 10 y Sincronizador en el Escritorio
# Ejecutar con: powershell -ExecutionPolicy Bypass -File .\scripts\instalar_accesos_directos.ps1

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$DesktopPath = [Environment]::GetFolderPath("Desktop")

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Instalador de Accesos Directos - Ganaderos Campo" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Directori del repositorio: $RepoRoot"
Write-Host " Escritorio destino:        $DesktopPath"
Write-Host ""

# Detectar intérprete de Python (preferir pythonw para no mostrar ventana de consola si se desea, o python)
$PythonExe = (Get-Command pythonw -ErrorAction SilentlyContinue).Source
if (-not $PythonExe) {
    $PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
}

if (-not $PythonExe) {
    Write-Warning "No se encontró Python en el PATH del sistema. Se usará 'python.exe' por defecto."
    $PythonExe = "python.exe"
} else {
    Write-Host "[+] Python detectado: $PythonExe" -ForegroundColor Green
}

$WshShell = New-Object -ComObject WScript.Shell

# 1. Acceso Directo: Ganaderos 10 (Lanzador Inteligente)
$LnkGanaderos = Join-Path $DesktopPath "Ganaderos 10.lnk"
$ShortcutG = $WshShell.CreateShortcut($LnkGanaderos)
$ShortcutG.TargetPath = $PythonExe
$ShortcutG.Arguments = "`"$RepoRoot\scripts\ganaderos_launcher.py`""
$ShortcutG.WorkingDirectory = $RepoRoot
$ShortcutG.Description = "Lanzador Inteligente de Ganaderos 10 con sincronización automática de campo"

# Buscar icono original si existe en la instalación de Ganaderos
$PossibleExePaths = @(
    "C:\Program Files (x86)\Ganaderos10\Ganaderos.exe",
    "C:\Program Files\Ganaderos10\Ganaderos.exe",
    "C:\Ganaderos10\Ganaderos.exe"
)

$IconFound = $false
foreach ($p in $PossibleExePaths) {
    if (Test-Path $p) {
        $ShortcutG.IconLocation = "$p,0"
        $IconFound = $true
        break
    }
}

if (-not $IconFound) {
    # Icono genérico de base de datos / aplicación de Windows
    $ShortcutG.IconLocation = "$env:SystemRoot\System32\shell32.dll,248"
}

$ShortcutG.Save()
Write-Host "[+] Creado acceso directo: $LnkGanaderos" -ForegroundColor Green

# 2. Acceso Directo: Sincronizar con Campo (Manual)
$LnkSync = Join-Path $DesktopPath "Sincronizar con Campo.lnk"
$ShortcutS = $WshShell.CreateShortcut($LnkSync)
$ShortcutS.TargetPath = Join-Path $RepoRoot "scripts\sincronizar_manual.bat"
$ShortcutS.WorkingDirectory = $RepoRoot
$ShortcutS.Description = "Sincronización manual directa con la nube y respaldo en Git Vault"
$ShortcutS.IconLocation = "$env:SystemRoot\System32\shell32.dll,238" # Icono de flechas circulares / sync
$ShortcutS.Save()
Write-Host "[+] Creado acceso directo: $LnkSync" -ForegroundColor Green

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " ¡Accesos directos creados correctamente en el Escritorio!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
