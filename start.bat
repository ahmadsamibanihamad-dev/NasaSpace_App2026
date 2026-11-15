@echo off
rem Ardna - double-click this file to start the site.
rem It installs dependencies the first time, starts the dev server and opens the browser.
rem Keep this window open while you use the site. Close it (or press Ctrl+C) to stop the server.
title Ardna - dev server
cd /d "%~dp0frontend"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Install version 20 or newer from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies. This happens only the first time and can take a few minutes...
  call npm install
  if errorlevel 1 (
    echo.
    echo Installation failed. Check your internet connection and run this file again.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Starting Ardna. The browser will open by itself.
echo Keep this window open. Close it to stop the server.
echo.
call npm run dev -- --open

echo.
echo The server has stopped.
pause
