@echo off
setlocal
chcp 65001 >nul
set "CONTROL=%~dp0comfyui-music.ps1"
if not exist "%CONTROL%" (
    echo [ERROR] comfyui-music.ps1 was not found next to this BAT file.
    pause
    exit /b 1
)
echo [INFO] Requesting ComfyUI model/VRAM release...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CONTROL%" -Mode Free
pause
