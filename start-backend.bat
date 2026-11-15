@echo off
rem Ardna - double-click to start the backend API (FastAPI + SQLite) on http://localhost:8765
rem API documentation: http://localhost:8765/api/v1/docs
title Ardna - backend
cd /d "%~dp0backend"

if not exist .venv (
  echo Creating the Python environment. This happens only the first time...
  python -m venv .venv
  if errorlevel 1 (
    echo.
    echo Python 3.11 or newer is required. Install it from https://www.python.org and run this file again.
    pause
    exit /b 1
  )
  call .venv\Scripts\python.exe -m pip install --upgrade pip
)

rem Installs anything new in requirements.txt; takes a few seconds when nothing changed.
echo Checking Python libraries...
call .venv\Scripts\python.exe -m pip install -q -r requirements.txt
if errorlevel 1 (
  echo.
  echo Installing the Python libraries failed. Check your internet connection and run this file again.
  pause
  exit /b 1
)

echo.
echo Starting the Ardna API on http://localhost:8765
echo Keep this window open. Close it to stop the server.
echo.
call .venv\Scripts\python.exe -m uvicorn app.main:app --port 8765

echo.
echo The server has stopped.
pause
