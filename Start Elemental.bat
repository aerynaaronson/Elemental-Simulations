@echo off
rem Starts the local server with all CPU cores enabled and opens the simulation in your browser.
cd /d "%~dp0"
python tools\serve.py 8765 --open
if errorlevel 1 (
  echo.
  echo Could not start. Port 8765 may already be in use, or Python may not be on PATH.
  pause
)
