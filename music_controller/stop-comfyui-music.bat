@echo off
setlocal
chcp 65001 >nul
set "CONTROL=%~dp0comfyui-music.ps1"
if not exist "%CONTROL%" (
    echo [ERROR] comfyui-music.ps1 was not found next to this BAT file.
    pause
    exit /b 1
)
echo [INFO] Stopping only the verified ComfyUI music process on port 8188...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CONTROL%" -Mode Stop
pause
