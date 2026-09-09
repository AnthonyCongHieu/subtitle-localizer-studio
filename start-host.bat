@echo off
setlocal
chcp 65001 >nul
title Subtitle Localizer - LAN Host (Coordinator + Worker)
set "ROOT=%~dp0"
cd /d "%ROOT%"
set "SL_COORDINATOR_URL=http://127.0.0.1:8899"
python "%ROOT%scripts\run_studio.py" --no-browser %*
if errorlevel 1 pause
endlocal
