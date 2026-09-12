@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Subtitle Localizer Studio - Hardware Setup
set "ROOT=%~dp0"
cd /d "%ROOT%"
set "PY=python"
if exist "%ROOT%.venv\Scripts\python.exe" set "PY=%ROOT%.venv\Scripts\python.exe"

echo [1/6] Checking Python...
%PY% --version >nul 2>&1 || (echo [ERROR] Python 3.11+ is required. Install from https://www.python.org/downloads/ & exit /b 1)
if not exist "%ROOT%.venv\Scripts\python.exe" (
  echo [2/6] Creating isolated virtual environment...
  %PY% -m venv "%ROOT%.venv" || exit /b 1
  set "PY=%ROOT%.venv\Scripts\python.exe"
)
echo [3/6] Installing core engines...
"%PY%" -m pip install --upgrade pip >nul || exit /b 1
"%PY%" -m pip install -r requirements.txt || exit /b 1
where nvidia-smi >nul 2>&1
if %errorlevel% equ 0 (
  echo [4/6] NVIDIA detected; installing GPU OCR runtime...
  "%PY%" -m pip install -r requirements-gpu.txt || echo [WARN] GPU packages failed; CPU OCR remains available.
) else (echo [4/6] NVIDIA not detected; keeping CPU OCR runtime.)
echo [5/6] Selecting a local translation model from RAM/VRAM...
"%PY%" scripts\configure_hardware.py --settings pipeline_settings.json || exit /b 1
where ollama >nul 2>&1
if %errorlevel% neq 0 (
  echo [*] Ollama is missing; attempting a per-user install through winget...
  where winget >nul 2>&1 && winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements >nul 2>&1
  where ollama >nul 2>&1 || echo [WARN] Ollama could not be installed automatically. API and OCR still work; install Ollama then rerun setup.
) else (
  for /f "delims=" %%S in ('powershell -NoProfile -Command "(Get-Content pipeline_settings.json -Raw | ConvertFrom-Json).translation.local_supported"') do set "LOCAL_SUPPORTED=%%S"
  for /f "delims=" %%M in ('powershell -NoProfile -Command "(Get-Content pipeline_settings.json -Raw | ConvertFrom-Json).translation.local_model"') do set "MODEL=%%M"
  for /f "delims=" %%M in ('powershell -NoProfile -Command "(Get-Content pipeline_settings.json -Raw | ConvertFrom-Json).translation.local_fallback_model"') do set "FALLBACK_MODEL=%%M"
  echo [*] Pulling Local quality model %MODEL% (if missing)...
  ollama pull %MODEL% || echo [WARN] Quality model pull failed; API fallback remains available.
  if /I not "%FALLBACK_MODEL%"=="%MODEL%" (
    echo [*] Pulling Local rescue model %FALLBACK_MODEL% (if missing)...
    ollama pull %FALLBACK_MODEL% || echo [WARN] Rescue model pull failed; API fallback remains available.
  )
)
echo [6/6] Running runtime smoke checks...
"%PY%" -c "import fastapi, numpy, cv2, onnxruntime; print('engines: OK')" || exit /b 1
echo Setup complete. Starting Studio...
"%PY%" scripts\run_studio.py %*
exit /b %errorlevel%
