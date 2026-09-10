@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
title Đóng gói Subtitle Localizer Studio (Bản Sạch / Không Kèm Models)

echo ===============================================================================
echo     ĐÓNG GÓI SUBTITLE LOCALIZER STUDIO ĐỂ COPY SANG MÁY KHÁC
echo ===============================================================================
echo.
echo Tùy chọn đóng gói dự án sạch:
echo  - Loại bỏ các model ONNX nặng (benchmarks/models/*.onnx)
echo  - Loại bỏ các video uploads tạm (uploads/ ~3.2GB)
echo  - Loại bỏ kết quả render cũ (outputs/)
echo  - Loại bỏ node_modules (web/dist đã được build sẵn, chạy được ngay)
echo  - Loại bỏ cache / log agent (.claude, .agents, cache, .pytest_cache)
echo  - Giữ lại toàn bộ Source Code, Web UI, Scripts, Cấu hình và Key Pool.
echo.
echo -------------------------------------------------------------------------------
echo [1] Đóng gói thành file .ZIP ra Desktop (Khuyên dùng, ~22MB có kèm proxy xray)
echo [2] Đóng gói thành file .ZIP SIÊU NHẸ ra Desktop (~2MB, không kèm bin/xray)
echo [3] Sao chép thẳng sang thư mục / Ổ USB khác (Copy dạng Folder)
echo [4] Thoát
echo -------------------------------------------------------------------------------
set /p "CHOICE=Nhập lựa chọn của bạn (1/2/3/4, mặc định 1): "

if "%CHOICE%"=="" set "CHOICE=1"

if "%CHOICE%"=="1" (
    echo.
    echo [*] Đang đóng gói bản ZIP tiêu chuẩn ra Desktop...
    python "%~dp0scripts\export_clean_project.py" --format zip
    goto :DONE
)

if "%CHOICE%"=="2" (
    echo.
    echo [*] Đang đóng gói bản ZIP siêu nhẹ ra Desktop...
    python "%~dp0scripts\export_clean_project.py" --format zip --no-bin --dest "%USERPROFILE%\Desktop\subtitle-localizer-studio-ultralight.zip"
    goto :DONE
)

if "%CHOICE%"=="3" (
    echo.
    set /p "DEST_FOLDER=Nhập đường dẫn thư mục đích (Ví dụ D:\Studio hoặc F:\Studio): "
    if "!DEST_FOLDER!"=="" (
        echo [!] Bạn chưa nhập đường dẫn đích. Hủy thao tác.
        pause
        exit /b 1
    )
    echo [*] Đang sao chép dự án sạch sang !DEST_FOLDER!...
    python "%~dp0scripts\export_clean_project.py" --format folder --dest "!DEST_FOLDER!"
    goto :DONE
)

if "%CHOICE%"=="4" (
    echo Đã hủy.
    exit /b 0
)

echo [!] Lựa chọn không hợp lệ.
pause
exit /b 1

:DONE
echo.
echo ===============================================================================
echo [THÀNH CÔNG] ĐÃ HOÀN TẤT ĐÓNG GÓI!
echo.
echo HƯỚNG DẪN DÙNG TRÊN MÁY MỚI:
echo  1. Giải nén hoặc copy thư mục sang máy mới.
echo  2. Cài Python 3.11+ (nhớ tích chọn 'Add python.exe to PATH').
echo  3. Nhấp đúp chuột vào file:  >>> KHOI_DONG_STUDIO.bat <<<
echo     (Phần mềm sẽ tự cài thư viện và mở trình duyệt tại http://127.0.0.1:8899)
echo ===============================================================================
echo.
pause
endlocal
