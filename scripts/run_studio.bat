@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion
title Subtitle Localizer Studio (1-Click Launcher)

echo ==================================================================
echo   🚀 KHỞI ĐỘNG SUBTITLE LOCALIZER STUDIO
echo ==================================================================
echo.

cd /d "%~dp0\.."

:: 1. Tự động phát hiện Python
set PYTHON_EXE=
where python >nul 2>nul
if %errorlevel% equ 0 (
    set PYTHON_EXE=python
) else (
    if exist "C:\Program Files\Python311\python.exe" (
        set "PYTHON_EXE=C:\Program Files\Python311\python.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
        set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
        set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    ) else if exist "C:\Python311\python.exe" (
        set "PYTHON_EXE=C:\Python311\python.exe"
    ) else (
        where py >nul 2>nul
        if !errorlevel! equ 0 (
            set PYTHON_EXE=py -3.11
        )
    )
)

if "%PYTHON_EXE%"=="" (
    echo [LỖI] Không tìm thấy Python trên máy tính của bạn!
    echo Vui lòng cài đặt Python 3.11 và tích chọn "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

echo [1/3] Python Runtime: %PYTHON_EXE%

:: 2. Kiểm tra bản build Web UI
if not exist "web\dist\index.html" (
    echo [2/3] Chưa tìm thấy bản build giao diện. Đang tự động build Web UI...
    where npm >nul 2>nul
    if %errorlevel% equ 0 (
        cd web
        call npm run build
        cd ..
    ) else (
        echo [CẢNH BÁO] Không tìm thấy npm để build. Sẽ chạy trực tiếp backend.
    )
) else (
    echo [2/3] Giao diện Web UI (Production) đã sẵn sàng.
)

:: 3. Tự động mở trình duyệt sau 2 giây
echo [3/3] Đang khởi động Server tại http://127.0.0.1:8899 ...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:8899"

echo.
echo ==================================================================
echo   ✅ STUDIO ĐANG CHẠY! TRÌNH DUYỆT SẼ TỰ ĐỘNG MỞ TRONG GIÂY LÁT...
echo   Địa chỉ truy cập: http://127.0.0.1:8899
echo   (Đóng cửa sổ này để dừng chương trình)
echo ==================================================================
echo.

"%PYTHON_EXE%" scripts\run_server.py

pause
