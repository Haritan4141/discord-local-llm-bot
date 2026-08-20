@echo off
setlocal
chcp 65001 >nul

set "CONTROL=%~dp0comfyui-music.ps1"
if not exist "%CONTROL%" (
    echo [ERROR] comfyui-music.ps1 was not found next to this BAT file.
    pause
    exit /b 1
)

set "COMFYUI_DIR="
if exist "C:\StabilityMatrix-v2.15.5\Data\Packages\ComfyUI\venv\Scripts\python.exe" set "COMFYUI_DIR=C:\StabilityMatrix-v2.15.5\Data\Packages\ComfyUI"
if not defined COMFYUI_DIR if exist "C:\StabilityMatrix\Data\Packages\ComfyUI\venv\Scripts\python.exe" set "COMFYUI_DIR=C:\StabilityMatrix\Data\Packages\ComfyUI"

if not defined COMFYUI_DIR (
    echo [ERROR] ComfyUI Python environment was not found.
    echo Checked StabilityMatrix-v2.15.5 and StabilityMatrix.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CONTROL%" -Mode Status -Quiet
set "STATUS=%ERRORLEVEL%"
if "%STATUS%"=="0" (
    echo [INFO] ComfyUI is already running on port 8188.
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CONTROL%" -Mode Status
    echo Use free-comfyui-music.bat to release the model, or stop-comfyui-music.bat to stop the server.
    pause
    exit /b 0
)
if not "%STATUS%"=="1" (
    echo [ERROR] Port 8188 is occupied or a stale ComfyUI process was detected.
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CONTROL%" -Mode Status
    echo Use stop-comfyui-music.bat to clean up the verified ComfyUI process.
    pause
    exit /b 2
)

echo [INFO] Starting ComfyUI for Discord /music...
echo [INFO] ComfyUI directory: %COMFYUI_DIR%
echo [INFO] Endpoint: http://0.0.0.0:8188
echo Keep this window open while music generation is in use.
pushd "%COMFYUI_DIR%"
venv\Scripts\python.exe main.py --listen 0.0.0.0 --port 8188 --disable-auto-launch
set "EXIT_CODE=%ERRORLEVEL%"
popd
echo [INFO] ComfyUI exited with code %EXIT_CODE%.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CONTROL%" -Mode Status
pause
exit /b %EXIT_CODE%
