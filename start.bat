@echo off
rem Ardna - double-click this file to start the whole site.
rem It opens the backend API in a second window, then starts the website and opens the browser.
rem Keep both windows open while you use the site. Close them to stop.
title Ardna - website
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed. Install version 20 or newer from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python is not installed. Install version 3.11 or newer from https://www.python.org and run this file again.
  echo.
  pause
  exit /b 1
)

echo Starting the backend API in a second window...
start "Ardna - backend" cmd /k call "%~dp0start-backend.bat"

cd /d "%~dp0frontend"
if not exist node_modules (
  echo Installing website dependencies. This happens only the first time and can take a few minutes...
  call npm install
  if errorlevel 1 (
    echo.
    echo Installation failed. Check your internet connection and run this file again.
    echo.
    pause
    exit /b 1
  )
)

echo Waiting for the backend to answer on http://127.0.0.1:8765 ...
set /a tries=0
:waitapi
curl -s -o nul -m 2 http://127.0.0.1:8765/api/v1/health
if not errorlevel 1 goto apiready
set /a tries+=1
if %tries% geq 90 (
  echo.
  echo The backend did not start. Look at the "Ardna - backend" window for the reason.
  echo The website will open, but it will show "cannot reach the server" until the backend runs.
  echo.
  goto apiready
)
timeout /t 2 /nobreak >nul
goto waitapi
:apiready

echo.
echo Starting Ardna. The browser will open by itself.
echo Keep this window and the backend window open. Close them to stop.
echo.
call npm run dev -- --open

echo.
echo The website has stopped.
pause
