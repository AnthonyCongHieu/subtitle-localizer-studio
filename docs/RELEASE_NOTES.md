# Subtitle Localizer Studio — Release Notes & Hướng Dẫn Sử Dụng

## Giới thiệu

Subtitle Localizer Studio là giải pháp hoàn chỉnh cho máy trạm Windows (tối ưu phần cứng GPU NVIDIA RTX 3050 Laptop 6GB) giúp tự động nhận diện hard subtitle từ video bằng OCR (tiếng Trung, Nhật, Hàn, Anh), dựng timing chính xác theo PTS thực tế (hỗ trợ CFR và VFR), dịch sang tiếng Việt và biên tập phụ đề trên giao diện localhost Studio.

## Tính năng chính

1. **Import Video & Phân tích PTS:** Hỗ trợ video ngang và dọc (Shorts/TikTok/Reels), phân tích chính xác CFR/VFR và sinh proxy video nhẹ.
2. **Nhận diện ROI & Watermark Filter:** Tự động phát hiện vùng phụ đề và loại bỏ logo/watermark xuất hiện liên tục.
3. **Đa OCR Engine:** Hỗ trợ PaddleOCR v6/v5, Korean v5 và Mock Engine cho CI/CD.
4. **Tái tạo Phụ đề (Cue Reconstruction):** Ghép nối mốc thời gian, sắp xếp thứ tự đọc 2 dòng, lọc chớp tắt flicker (<250ms), gán cờ cảnh báo chất lượng.
5. **Dịch máy thông minh:** Ngữ cảnh 3 câu (prev + curr + next), bảo toàn thuật ngữ (Glossary) và số liệu, hỗ trợ TranslateGemma, NLLB-200, OPUS-MT.
6. **Localhost Studio Editor (React + Tailwind):**
   - Video Proxy Player đồng bộ Playhead.
   - Timeline & Waveform canvas.
   - Bảng chỉnh sửa song ngữ (Source & Vietnamese translated).
   - Chỉnh sửa timing, Split câu, Merge câu, Lock câu chống ghi đè, Undo/Redo.
   - Lọc các câu có độ tin cậy thấp.
7. **Masking & Xuất file:** Che subtitle cũ (Blur/Box/Crop/STTN fallback), xuất SRT UTF-8, ASS tùy biến styles và render MP4 với tăng tốc phần cứng NVENC.

## Hướng dẫn khởi chạy

### Khởi chạy Backend Server:
```powershell
& 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' scripts/run_server.py
```
Backend API sẽ hoạt động tại: `http://127.0.0.1:8000/api/v1/health`

### Khởi chạy Web Studio:
```powershell
cd web
npm install
npm run dev
```
Truy cập giao diện tại: `http://localhost:5173`
