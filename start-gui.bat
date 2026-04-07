@echo off
cd /d %~dp0

echo ==============================
echo Discord Local LLM Bot GUI
echo ==============================
echo.

if not exist node_modules\dotenv\package.json (
  goto install_deps
)
if not exist node_modules\discord.js\package.json (
  goto install_deps
)
goto run_gui

:install_deps
  echo Dependencies not found. Running npm install...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )

:run_gui

node gui-server.mjs

echo.
echo GUI stopped.
pause
