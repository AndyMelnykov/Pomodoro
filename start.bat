@echo off
cd /d "%~dp0"
start "Pomodoro server" /min node server.js
timeout /t 1 /nobreak >nul
start "" chrome http://127.0.0.1:8765/
