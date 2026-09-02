@echo off
chcp 65001 > nul
title Subtitle Localizer Studio

echo.
echo  ============================================================
echo   SUBTITLE LOCALIZER STUDIO
echo   Backend: http://127.0.0.1:8899
echo   Web UI:  http://localhost:5199
echo  ============================================================
echo.

:: Lấy thư mục gốc chứa file .bat này
set "ROOT=%~dp0"

:: Python path
set "PY=C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe"
if not exist "%PY%" (
    echo [!] Khong tim thay Python 3.11 tai %PY%
    echo     Thu dung "python" mac dinh...
    set "PY=python"
)

:: Cài npm nếu chưa có node_modules
if not exist "%ROOT%web\node_modules" (
    echo [1] Dang cai dat npm dependencies lan dau...
    cd /d "%ROOT%web"
    call npm install
    if errorlevel 1 (
        echo [LOI] npm install that bai!
        pause
        exit /b 1
    )
    cd /d "%ROOT%"
)

:: Khởi động Backend
echo [1] Khoi dong Backend Server (port 8899)...
start "SLS-Backend" /min "%PY%" "%ROOT%scripts\run_server.py"

:: Chờ backend sẵn sàng
timeout /t 3 /nobreak > nul

:: Khởi động Frontend
echo [2] Khoi dong Web Studio (port 5199)...
start "SLS-Frontend" /min cmd /c "cd /d %ROOT%web && npm run dev"

:: Chờ Vite sẵn sàng
timeout /t 3 /nobreak > nul

:: Mở trình duyệt
echo [3] Mo trinh duyet...
start "" http://localhost:5199

echo.
echo  ============================================================
echo   DA KHOI DONG THANH CONG!
echo.
echo   Web UI:      http://localhost:5199
echo   Backend API: http://127.0.0.1:8899/api/v1/health
echo.
echo   Dong cua so nay khong anh huong den Backend va Web UI.
echo  ============================================================
echo.
timeout /t 10
