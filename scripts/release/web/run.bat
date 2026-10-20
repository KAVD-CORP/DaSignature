@echo off
rem Starts DaSignature in your browser from this folder (needs Node.js 18 or later).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo DaSignature needs Node.js 18 or later: https://nodejs.org ^(install it, then run this again^).
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=4173
if "%NO_BROWSER%"=="" (node server.mjs %PORT% --open) else (node server.mjs %PORT%)
if errorlevel 1 pause
