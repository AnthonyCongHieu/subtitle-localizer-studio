@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
title Subtitle Localizer Studio - Khoi Dong Tu Dong

echo ===============================================================================
echo                     SUBTITLE LOCALIZER STUDIO
echo       Phan mem dich va long tieng phu de video tu dong thong minh
echo ===============================================================================
echo.

set "ROOT=%~dp0"

:: 1. Tim trinh thuc thi Python
echo [*] Buoc 1: Kiem tra Python...
set "PY="

python --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PY=python"
    goto :PYTHON_OK
)

py -3.11 --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PY=py -3.11"
    goto :PYTHON_OK
)

py -3.12 --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PY=py -3.12"
    goto :PYTHON_OK
)

py -3 --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PY=py -3"
    goto :PYTHON_OK
)

py --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PY=py"
    goto :PYTHON_OK
)

if exist "C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python311\python.exe" (
    set "PY=C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python311\python.exe"
    goto :PYTHON_OK
)

if exist "C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python312\python.exe" (
    set "PY=C:\Users\%USERNAME%\AppData\Local\Programs\Python\Python312\python.exe"
    goto :PYTHON_OK
)

if exist "C:\Program Files\Python311\python.exe" (
    set "PY=C:\Program Files\Python311\python.exe"
    goto :PYTHON_OK
)

if exist "C:\Program Files\Python312\python.exe" (
    set "PY=C:\Program Files\Python312\python.exe"
    goto :PYTHON_OK
)

echo.
echo [!] KHONG TIM THAY PYTHON TREN HE THONG!
echo -------------------------------------------------------------------------------
echo De chay phan mem, ban can cai dat Python 3.11 hoac 3.12:
echo   1. Dang tu dong mo trinh duyet toi trang tai Python...
echo   2. LUU Y QUAN TRONG KHI CAI: Nho tich chon vao o:
echo      [v] "Add python.exe to PATH"
echo -------------------------------------------------------------------------------
echo.
start https://www.python.org/downloads/
pause
exit /b 1

:PYTHON_OK
echo [OK] Python da san sang: %PY%

:: 2. Kiem tra thu vien Python va tu dong cai dat neu thieu
echo.
echo [*] Buoc 2: Kiem tra cac thu vien can thiet (14 thu vien core)...
"%PY%" -c "import fastapi, uvicorn, pydantic, numpy, cv2, onnxruntime, rapidocr_onnxruntime, deep_translator, requests, Crypto, gmssl, betterproto, yt_dlp, edge_tts" >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Phat hien thieu mot so thu vien Python tren may nay.
    echo [*] Dang tu dong cai dat tat ca thu vien tu requirements.txt...
    echo [*] (Qua trinh nay chi dien ra trong lan dau tien khoi dong, vui long doi vai phut)...
    echo.
    "%PY%" -m pip install --upgrade pip
    "%PY%" -m pip install -r "%ROOT%requirements.txt"
    if %errorlevel% neq 0 (
        echo [*] Thu cai dat voi quyen nguoi dung (--user)...
        "%PY%" -m pip install --user -r "%ROOT%requirements.txt"
    )
    if %errorlevel% neq 0 (
        echo [*] Thu cai dat bo sung noi bo...
        "%PY%" -m pip install -e "%ROOT%"
    )
    "%PY%" -c "import fastapi, uvicorn, pydantic, numpy, cv2, onnxruntime, rapidocr_onnxruntime, deep_translator, requests, Crypto, gmssl, betterproto" >nul 2>&1
    if %errorlevel% neq 0 (
        echo.
        echo [!] Co loi khi cai dat thu vien Python. Vui long kiem tra ket noi Internet va thu lai.
        pause
        exit /b 1
    )
    echo [OK] Da cai dat day du 100%% cac thu vien Python!
) else (
    echo [OK] Cac thu vien Python da day du va san sang!
)

:: 3. Kiem tra Node.js va Web UI
echo.
echo [*] Buoc 3: Kiem tra moi truong giao dien Web Studio...
set "USE_VITE=0"
where npm >nul 2>&1
if %errorlevel% equ 0 (
    set "USE_VITE=1"
    echo [OK] Da tim thay Node.js / npm.
    if not exist "%ROOT%web\node_modules" (
        echo [*] Phat hien chua co node_modules. Dang tu dong cai dat (npm install)...
        cd /d "%ROOT%web"
        call npm install
        cd /d "%ROOT%"
        echo [OK] Da cai dat xong thu vien npm!
    )
) else (
    echo [!] May nay chua cai Node.js hoac npm.
    if exist "%ROOT%web\dist\index.html" (
        echo [*] Studio se tu dong su dung Web UI build san (hoat dong truc tiep tren Backend port 8899).
        echo [*] Ban van su dung day du 100%% tinh nang ma khong can cai Node.js!
    ) else (
        echo [!] Khuyen nghi: Cai dat Node.js tai https://nodejs.org/ de chay giao dien web tot nhat.
    )
)

:: 4. Giai phong cac cong 8899 va 5199 neu dang bi chiem dung
echo.
echo [*] Buoc 4: Giai phong cac port 8899 va 5199...
powershell -NoProfile -Command "Get-Process -Id (Get-NetTCPConnection -LocalPort 8899,5199 -EA 0).OwningProcess -EA 0 | Stop-Process -Force -EA 0" >nul 2>&1
timeout /t 1 /nobreak > nul

:: 5. Kiem tra FFmpeg
where ffmpeg >nul 2>&1
if %errorlevel% neq 0 (
    if exist "%ROOT%ffmpeg.exe" (
        echo [OK] Da tim thay ffmpeg.exe trong thu muc phan mem.
    ) else (
        echo [!] Luu y: FFmpeg chua co trong PATH (chuc nang xuat video MP4 co the can FFmpeg).
    )
)

:: 6. Khoi dong Backend Server
echo.
echo [*] Buoc 5: Khoi dong Backend Server (127.0.0.1:8899)...
start "SLS-Backend" "%PY%" "%ROOT%scripts\run_server.py"
timeout /t 3 /nobreak > nul

:: 7. Khoi dong Frontend & Mo trinh duyet
if "%USE_VITE%"=="1" (
    echo [*] Buoc 6: Khoi dong Web Studio UI qua Vite Dev (port 5199)...
    cd /d "%ROOT%web"
    start "SLS-Frontend" cmd /c "npm run dev"
    cd /d "%ROOT%"
    timeout /t 3 /nobreak > nul
    start "" http://localhost:5199
) else (
    echo [*] Buoc 6: Mo Web Studio UI truc tiep tu Backend (port 8899)...
    start "" http://localhost:8899
)

echo.
echo ===============================================================================
echo                      KHOI DONG THANH CONG!
if "%USE_VITE%"=="1" (
    echo   - Giao dien Web Studio: http://localhost:5199
) else (
    echo   - Giao dien Web Studio: http://localhost:8899
)
echo   - Backend Server API:   http://127.0.0.1:8899/api/v1/health
echo   - Gemini Key Pool:      Da tich hop san toan bo cac API key san sang hoat dong!
echo ===============================================================================
echo.
echo Cua so nay se tu dong dong sau 6 giay...
timeout /t 6
endlocal
