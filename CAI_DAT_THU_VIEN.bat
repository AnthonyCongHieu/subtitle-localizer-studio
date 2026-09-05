@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
title Cai Dat Thu Vien - Subtitle Localizer Studio

echo ===============================================================================
echo         CAI DAT THU VIEN CHO SUBTITLE LOCALIZER STUDIO
echo ===============================================================================
echo.

set "ROOT=%~dp0"

:: 1. Python
echo [*] Kiem tra Python...
set "PY="
python --version >nul 2>&1 && set "PY=python"
if not defined PY (
    py -3.11 --version >nul 2>&1 && set "PY=py -3.11"
)
if not defined PY (
    py -3.12 --version >nul 2>&1 && set "PY=py -3.12"
)
if not defined PY (
    py -3 --version >nul 2>&1 && set "PY=py -3"
)
if not defined PY (
    py --version >nul 2>&1 && set "PY=py"
)

if not defined PY (
    echo [!] Khong tim thay Python! Vui long cai Python 3.11+ tai https://www.python.org/downloads/
    start https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [OK] Python: %PY%
echo [*] Dang cai dat thu vien Python tu requirements.txt...
"%PY%" -m pip install --upgrade pip
"%PY%" -m pip install -r "%ROOT%requirements.txt"
if %errorlevel% neq 0 (
    "%PY%" -m pip install --user -r "%ROOT%requirements.txt"
)
"%PY%" -m pip install -e "%ROOT%"

:: 2. Node.js
echo.
echo [*] Kiem tra npm...
where npm >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Da tim thay npm. Dang cai dat node_modules...
    cd /d "%ROOT%web"
    call npm install
    cd /d "%ROOT%"
    echo [OK] Da cai dat xong thu vien web!
) else (
    echo [!] May chua cai npm / Node.js. Web UI van co the chay truc tiep tu ban build san qua Backend!
)

echo.
echo ===============================================================================
echo   HOAN TAT CAI DAT! Bay gio ban co the chay file KHOI_DONG_STUDIO.bat.
echo ===============================================================================
echo.
pause
endlocal
