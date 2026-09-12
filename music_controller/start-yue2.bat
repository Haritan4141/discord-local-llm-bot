@echo off
setlocal
title YuE2 - Start - BLUE
set "CONTROL=%~dp0yue2-control.ps1"
if not exist "%CONTROL%" (
    echo ERROR: yue2-control.ps1 is missing.
    if /I not "%~1"=="--check" pause
    exit /b 1
)
set "CHECK="
if /I "%~1"=="--check" set "CHECK=-CheckOnly"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%CONTROL%" -Action Start %CHECK%
set "RESULT=%ERRORLEVEL%"
if /I not "%~1"=="--check" pause
exit /b %RESULT%
