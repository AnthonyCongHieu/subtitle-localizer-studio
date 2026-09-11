@echo off
chcp 65001 >nul
title C?M D?CH PH? ?? AI LOCAL - RTX 5080 (KINGPC -> PC6)
color 0A

echo =====================================================================
echo       C?M M?Y CH? SUY LU?N D?CH PH? ?? AI LOCAL (RTX 5080 16GB)
echo   M?y ch? x? l?: 192.168.1.219:11434 (KingPC) - M?y g?i: pc6
echo =====================================================================
echo.

set "INPUT_FILE=%~1"
if "%INPUT_FILE%"=="" (
    echo [H??NG D?N]: K?o v? th? file ph? ?? .srt ti?ng Trung v?o file .bat n?y!
    echo Ho?c nh?p ???ng d?n file .srt c?n d?ch d??i ??y:
    set /p INPUT_FILE="???ng d?n file .srt: "
)

if not exist "%INPUT_FILE%" (
    echo [L?I]: Kh?ng t?m th?y file: %INPUT_FILE%
    pause
    exit /b 1
)

echo.
echo ?? ch?n file: %INPUT_FILE%
echo.
echo CH?N CH? ?? D?CH:
echo [1] T?C ?? C?C NHANH (Qwen 14B - D?ch 1 t?p 500 c?u ch? 2 ph?t, 100%% VRAM GDDR7) [KHUY?N D?NG]
echo [2] CHU?N ?I?N ?NH MASTER (Qwen 32B - T??ng ???ng 100%% Gemini Flash, m?t 8-9 ph?t)
echo.
set /p MODE="Ch?n ch? ?? (1 ho?c 2, m?c ??nh l? 1): "
if "%MODE%"=="" set MODE=1

set MODEL_NAME=qwen2.5:14b
if "%MODE%"=="2" set MODEL_NAME=qwen2.5:32b-instruct-q3_K_M

echo.
echo [?ANG X? L?]: ?ang k?t n?i m?y ch? 192.168.1.219 ?? d?ch ph? ??...
powershell.exe -ExecutionPolicy Bypass -File "%~dp0translate_srt_production.ps1" -InputSrt "%INPUT_FILE%" -Model "%MODEL_NAME%" -ServerUrl "http://192.168.1.219:11434"

echo.
echo =====================================================================
echo [HO?N T?T]: File ph? ?? ti?ng Vi?t ?? ???c t?o ngay c?nh file g?c!
echo =====================================================================
pause
