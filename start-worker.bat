@echo off
setlocal
chcp 65001 >nul
title Subtitle Localizer - LAN Worker
set "ROOT=%~dp0"
cd /d "%ROOT%"
python "%ROOT%scripts\run_worker_agent.py" %*
if errorlevel 1 pause
endlocal
