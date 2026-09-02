@echo off
setlocal
chcp 65001 > nul
title Subtitle Localizer Studio

echo.
echo  ============================================================
echo   SUBTITLE LOCALIZER STUDIO
echo   Backend: http://127.0.0.1:8899
echo   Web UI:  http://localhost:5199
echo  ============================================================
echo.

set "ROOT=%~dp0"
set "PY=C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe"
if not exist "%PY%" set "PY=python"

:: Cai npm neu chua co
if not exist "%ROOT%web\node_modules" (
    echo [*] Cai dat npm dependencies...
    cd /d "%ROOT%web"
    call npm install
    cd /d "%ROOT%"
)

:: Khoi dong Backend
echo [1/3] Khoi dong Backend...
start "SLS-Backend" /min "%PY%" "%ROOT%scripts\run_server.py"

:: Cho backend 4 giay
echo [*] Cho Backend khoi dong (4s)...
timeout /t 4 /nobreak > nul

:: Khoi dong Frontend
echo [2/3] Khoi dong Frontend...
cd /d "%ROOT%web"
start "SLS-Frontend" /min cmd /c "npm run dev"
cd /d "%ROOT%"

:: Cho frontend 3 giay
timeout /t 3 /nobreak > nul

:: Mo trinh duyet
echo [3/3] Mo trinh duyet...
start "" http://localhost:5199

echo.
echo  ============================================================
echo   DA KHOI DONG XONG!
echo   Web UI:      http://localhost:5199
echo   Backend API: http://127.0.0.1:8899/api/v1/health
echo  ============================================================
timeout /t 10
endlocal
