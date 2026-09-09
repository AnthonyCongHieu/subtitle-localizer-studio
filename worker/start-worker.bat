@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Subtitle Localizer - Worker
cd /d "%~dp0"

rem This folder is portable: copy it (together with the repository source, or
rem use the packaged bundle) to another Windows machine and run this file.
set "WORKER_DIR=%~dp0"
python "%WORKER_DIR%bootstrap_worker.py" %*
if errorlevel 1 (
  echo.
  echo [!] Worker stopped with exit code %errorlevel%.
  pause
)
endlocal
