@echo off
cd /d %~dp0

echo ==============================
echo Discord Local LLM Bot Starting
echo ==============================
echo.

node index.mjs >> bot.log 2>&1

echo.
echo Bot stopped.
pause
