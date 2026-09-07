@echo off
setlocal
chcp 65001 > nul
title Subtitle Localizer Studio (Unified 1-CMD Launcher)

set "ROOT=%~dp0.."
cd /d "%ROOT%"

set "PY="

python --version >nul 2>&1
if %errorlevel% equ 0 (
    set PY=python
    goto :PYTHON_OK
)

py -3.11 --version >nul 2>&1
if %errorlevel% equ 0 (
    set PY=py -3.11
    goto :PYTHON_OK
)

py -3.12 --version >nul 2>&1
if %errorlevel% equ 0 (
    set PY=py -3.12
    goto :PYTHON_OK
)

py -3 --version >nul 2>&1
if %errorlevel% equ 0 (
    set PY=py -3
    goto :PYTHON_OK
)

py --version >nul 2>&1
if %errorlevel% equ 0 (
    set PY=py
    goto :PYTHON_OK
)

if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set PY="%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    goto :PYTHON_OK
)
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set PY="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    goto :PYTHON_OK
)
if exist "C:\Program Files\Python311\python.exe" (
    set PY="C:\Program Files\Python311\python.exe"
    goto :PYTHON_OK
)
if exist "C:\Program Files\Python312\python.exe" (
    set PY="C:\Program Files\Python312\python.exe"
    goto :PYTHON_OK
)

echo.
echo [!] KHONG TIM THAY PYTHON TREN HE THONG!
echo ===============================================================================
pause
exit /b 1

:PYTHON_OK
%PY% "%ROOT%\scripts\run_studio.py" %*

if %errorlevel% neq 0 (
    echo.
    echo [!] Tien trinh ket thuc voi ma loi: %errorlevel%
    pause
)

endlocal
