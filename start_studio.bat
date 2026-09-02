@echo off
chcp 65001 > nul
title Subtitle Localizer Studio Launcher

echo ==============================================================================
echo                 SUBTITLE LOCALIZER STUDIO - KHỞI ĐỘNG
echo ==============================================================================
echo.

set REPO_DIR=%~dp0
cd /d "%REPO_DIR%"

:: 1. Xác định Python 3.11 executable
set PYTHON_EXE=C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe
if not exist "%PYTHON_EXE%" (
    where python >nul 2>&1
    if %errorlevel% equ 0 (
        set PYTHON_EXE=python
    ) else (
        echo [LỖI] Không tìm thấy Python 3.11 trên máy tính!
        echo Vui lòng cài đặt Python 3.11 và thử lại.
        pause
        exit /b 1
    )
)

echo [*] Sử dụng Python: %PYTHON_EXE%

:: 2. Khởi động Backend Server
echo [*] Đang khởi động Backend Server (FastAPI) tại http://127.0.0.1:8000 ...
start "Subtitle Localizer - Backend Server (127.0.0.1:8000)" cmd /k "cd /d \"%REPO_DIR%\" && \"%PYTHON_EXE%\" scripts/run_server.py"

:: Chờ 2 giây để backend khởi động
timeout /t 2 /nobreak > nul

:: 3. Kiểm tra và cài đặt Frontend Node dependencies nếu cần
cd /d "%REPO_DIR%web"
if not exist "node_modules" (
    echo [*] Thư mục web/node_modules chưa tồn tại. Đang chạy 'npm install'...
    call npm install
    if %errorlevel% neq 0 (
        echo [LỖI] 'npm install' thất bại! Vui lòng kiểm tra lại kết nối mạng hoặc Node.js.
        pause
        exit /b 1
    )
)

:: 4. Khởi động Web Frontend (Vite)
echo [*] Đang khởi động Web Studio (React + Vite) tại http://localhost:5173 ...
start "Subtitle Localizer - Web Studio (localhost:5173)" cmd /k "cd /d \"%REPO_DIR%web\" && npm run dev"

:: Chờ 2 giây để Vite dev server sẵn sàng
timeout /t 2 /nobreak > nul

:: 5. Mở trình duyệt web
echo [*] Đang mở trình duyệt truy cập Studio...
start http://localhost:5173

echo.
echo ==============================================================================
echo   Subtitle Localizer Studio đã khởi động thành công!
echo   - Web UI:     http://localhost:5173
echo   - Backend API: http://127.0.0.1:8000/api/v1/health
echo ==============================================================================
echo.
echo Nhấn phím bất kỳ để đóng cửa sổ launcher này (các server vẫn tiếp tục chạy).
pause > nul
