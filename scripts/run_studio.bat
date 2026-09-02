@echo off
chcp 65001 > nul
echo ==================================================================
echo   Khởi động Subtitle Localizer Studio (Windows)
echo ==================================================================

set PYTHON_EXE=C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe

echo [1/2] Khởi động FastAPI Backend Server trên http://127.0.0.1:8000 ...
start "Subtitle Localizer Backend" "%PYTHON_EXE%" scripts/run_server.py

echo [2/2] Vui lòng mở trình duyệt và truy cập Web UI hoặc chạy 'cd web && npm run dev'
echo Backend API sẵn sàng tại: http://127.0.0.1:8000/api/v1/health
echo ==================================================================
pause
