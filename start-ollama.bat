@echo off
echo =========================
echo Ollama Server Starting
echo =========================
echo.

set "OLLAMA_KEEP_ALIVE="
set "ENV_FILE=%~dp0.env"

if exist "%ENV_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in (`findstr /R "^[A-Za-z_][A-Za-z0-9_]*=" "%ENV_FILE%"`) do (
    if /I "%%A"=="OLLAMA_KEEP_ALIVE" set "OLLAMA_KEEP_ALIVE=%%~B"
  )
)

if not defined OLLAMA_KEEP_ALIVE set "OLLAMA_KEEP_ALIVE=30m"
set "OLLAMA_KEEP_ALIVE=%OLLAMA_KEEP_ALIVE:"=%"

echo OLLAMA_KEEP_ALIVE=%OLLAMA_KEEP_ALIVE%
echo.

ollama serve

pause
