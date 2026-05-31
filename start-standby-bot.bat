@echo off
cd /d %~dp0

echo ==============================
echo Discord Standby Reply Bot
echo ==============================
echo.

node standby-bot.mjs >> standby-bot.log 2>&1

echo.
echo Standby bot stopped.
pause
