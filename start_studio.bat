@echo off
chcp 65001 > nul
title Subtitle Localizer Studio Launcher

echo ==============================================================================
echo                 SUBTITLE LOCALIZER STUDIO - KHỞI ĐỘNG
echo ==============================================================================
echo.

set "REPO_DIR=%~dp0"
cd /d "%REPO_DIR%"

:: 1. Xác định Python 3.11 executable
set "PYTHON_EXE=C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe"
if not exist "%PYTHON_EXE%" (
    where python >nul 2>&1
    if %errorlevel% equ 0 (
        set "PYTHON_EXE=python"
    ) else (
        echo [LỖI] Không tìm thấy Python trên máy tính!
        echo Vui lòng kiểm tra lại Python 3.11.
        pause
        exit /b 1
    )
)

echo [*] Python executable: %PYTHON_EXE%

:: 2. Kiểm tra node_modules ở web/
if not exist "%REPO_DIR%web\node_modules" (
    echo [*] Thư mục web\node_modules chưa có. Đang cài đặt thư viện npm...
    cd /d "%REPO_DIR%web"
    call npm install
    cd /d "%REPO_DIR%"
)

:: 3. Khởi động Backend Server (FastAPI trên port 8899)
echo [*] Đang khởi động Backend Server trên http://127.0.0.1:8899 ...
start "Subtitle Localizer - Backend Server" "%PYTHON_EXE%" "%REPO_DIR%scripts\run_server.py"

:: Chờ 2 giây để backend khởi động
timeout /t 2 /nobreak > nul

:: 4. Khởi động Web Studio (Vite trên port 5199)
echo [*] Đang khởi động Web Studio trên http://localhost:5199 ...
start "Subtitle Localizer - Web Studio" cmd /k "cd /d "%REPO_DIR%web" && npm run dev"

:: Chờ 2 giây
timeout /t 2 /nobreak > nul

:: 5. Mở trình duyệt web
echo [*] Đang mở trình duyệt web...
start http://localhost:5199

echo.
echo ==============================================================================
echo   Subtitle Localizer Studio đã khởi động thành công!
echo   - Web UI:      http://localhost:5199
echo   - Backend API: http://127.0.0.1:8899/api/v1/health
echo ==============================================================================
echo.
echo (Bạn có thể đóng cửa sổ này, 2 cửa sổ Backend và Web UI sẽ tiếp tục chạy.)
timeout /t 5 > nul
