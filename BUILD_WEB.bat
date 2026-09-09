@echo off
setlocal
chcp 65001 > nul
title Build Giao Dien Web - Subtitle Localizer Studio

set "ROOT=%~dp0"
cd /d "%ROOT%web"

echo ===============================================================================
echo         BUILD GIAO DIEN WEB (PRODUCTION) - SUBTITLE LOCALIZER STUDIO
echo ===============================================================================
echo.

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Khong tim thay Node.js / npm tren he thong!
    echo Vui long cai dat Node.js tai: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [*] Phat hien chua co node_modules. Dang cai dat thu vien npm...
    call npm install
)

echo [*] Dang bien dich giao dien (tsc ^&^& vite build)...
call npm run build

if %errorlevel% equ 0 (
    echo.
    echo ===============================================================================
    echo [OK] DA BUILD THANH CONG! Ban build web/dist da duoc dong bo moi nhat.
    echo      Bay gio ban co the khoi dong KHOI_DONG_STUDIO.bat de trai nghiem.
    echo ===============================================================================
) else (
    echo.
    echo [!] Build that bai voi ma loi %errorlevel%.
)

cd /d "%ROOT%"
echo.
pause
endlocal
