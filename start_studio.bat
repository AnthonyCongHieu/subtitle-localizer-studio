@echo off
setlocal enabledelayedexpansion
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

:: 1. Tự động tắt các tiến trình cũ đang chiếm cổng 8899 hoặc 5199
echo [*] Dang giai phong cac cong 8899 va 5199...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8899,5199 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 1 /nobreak > nul

:: 2. Cài npm nếu chưa có
if not exist "%ROOT%web\node_modules" (
    echo [*] Cai dat npm dependencies...
    cd /d "%ROOT%web"
    call npm install
    cd /d "%ROOT%"
)

:: 3. Khởi động Backend
echo [1/3] Khoi dong Backend Server (port 8899)...
start "SLS-Backend" "%PY%" "%ROOT%scripts\run_server.py"

:: Chờ backend 3 giây
timeout /t 3 /nobreak > nul

:: 4. Khởi động Frontend
echo [2/3] Khoi dong Web Studio (port 5199)...
cd /d "%ROOT%web"
start "SLS-Frontend" cmd /c "npm run dev"
cd /d "%ROOT%"

:: Chờ frontend 3 giây
timeout /t 3 /nobreak > nul

:: 5. Mở trình duyệt
echo [3/3] Mo trinh duyet...
start "" http://localhost:5199

echo.
echo  ============================================================
echo   KHOI DONG HOAN TAT!
echo   - Web UI:      http://localhost:5199
echo   - Backend API: http://127.0.0.1:8899/api/v1/health
echo  ============================================================
echo.
timeout /t 8
endlocal
