@echo off
chcp 65001 >nul
title [RTX 5090 WORKSTATION] - SUBTITLE LOCALIZER AI SERVER (LAN 11434)
color 0A

echo ============================================================================
echo   🚀 KHỞI ĐỘNG OLLAMA AI DỊCH THUẬT SIÊU TỐC TRÊN RTX 5090 (32GB VRAM)
echo   📍 Máy trạm: kingpc (192.168.1.219) ^| Cổng LAN: 11434
echo ============================================================================
echo.

:: 1. Cấu hình biến môi trường cho phép lắng nghe toàn bộ mạng LAN
set OLLAMA_HOST=0.0.0.0:11434
set OLLAMA_ORIGINS=*
set OLLAMA_NUM_PARALLEL=4
set OLLAMA_FLASH_ATTENTION=1

:: 2. Tự động mở cổng tường lửa Windows cho cổng 11434 nếu chưa mở
netsh advfirewall firewall show rule name="Ollama LAN 11434" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [*] Đang mở cổng tường lửa Windows Firewall cho cổng 11434...
    powershell -Command "New-NetFirewallRule -DisplayName 'Ollama LAN 11434' -Direction Inbound -LocalPort 11434 -Protocol TCP -Action Allow -Profile Any" >nul 2>&1
    echo [v] Đã kích hoạt Firewall Rule cho cổng 11434.
)

:: 3. Kiểm tra và tải model Qwen 2.5 32B đỉnh cao nếu chưa có
echo [*] Đang kiểm tra mô hình AI Qwen 2.5 32B trên RTX 5090...
start /b "" ollama serve >nul 2>&1
timeout /t 3 /nobreak >nul

ollama list | findstr /i "qwen2.5:32b" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [*] Chưa phát hiện qwen2.5:32b. Đang tải model về RTX 5090 (Khoảng 19GB)...
    ollama pull qwen2.5:32b
) else (
    echo [v] Mô hình qwen2.5:32b đã sẵn sàng trong VRAM RTX 5090!
)

echo.
echo ============================================================================
echo   🎉 OLLAMA RTX 5090 SERVER ĐANG CHẠY SẴN SÀNG TRÊN MẠNG LAN!
echo   👉 Địa chỉ kết nối từ máy chính: http://192.168.1.219:11434
echo   👉 Mô hình đề xuất: qwen2.5:32b (hoặc qwen2.5:72b)
echo   🛑 Giữ cửa sổ này mở để duy trì máy chủ dịch thuật RTX 5090.
echo ============================================================================
echo.

ollama serve
pause
