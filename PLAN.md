# Kế Hoạch Toàn Diện: Khắc Phục Lỗi Hệ Thống & Bảo Chứng Kỹ Thuật (Evidence-Based)

## 1. Hiện Trạng Git & Kiểm Thử Hệ Thống (Bằng Chứng Thực Tế)
- **Nhánh Git:** `main`, `HEAD` trùng `origin/main` (commit mới nhất `0a03a6d`). Working tree clean (không có thay đổi dở dang).
- **Frontend Build (`npm run build`):** PASSED 100% (1850 modules transformed, dist xuất thành công trong 8.63s).
- **Backend Test Suite (`pytest`):**
  - Hiện tại: 150 passed, 22 failed, 4 error collecting.
  - **Bằng chứng phân tích:** 100% các ca fail/error đều bắt nguồn từ cùng một nguyên nhân: môi trường cài đặt `pycryptodomex 3.23.0` thay vì `pycryptodome`, khiến lệnh `from Crypto.Cipher import AES` ném `ModuleNotFoundError: No module named 'Crypto'`.
  - Hợp đồng UI (`tests/t14/test_queue_ui_contracts.py`): 6/6 passed (100%).
  - Nền tảng Web (`tests/t08/test_web_foundation.py`): 6/6 passed (100%).

---

## 2. Danh Sách 14 Lỗi Đã Được Xác Thực Thực Nghiệm Kèm Mã Nguồn

### Nhóm 1: Lỗi Nghiêm Trọng / Crash Runtime (Critical)
1. **Lỗi `ModuleNotFoundError: No module named 'Crypto'`:**
   - *Tệp tin:* `src/subtitle_localizer/downloader/hongguo_parser.py:27`, `src/subtitle_localizer/downloader/liushen/flurl/helios.py:6`, `src/subtitle_localizer/downloader/liushen/flurl/ttEncryptorUtil.py:3`.
   - *Bằng chứng:* Gây sập 22 tests và 4 file test collection của M1-M4. Môi trường có sẵn `pycryptodomex 3.23.0`.
   - *Giải pháp:* Hỗ trợ fallback linh hoạt `try: from Crypto... except ImportError: from Cryptodome...`.
2. **Lỗi FFmpeg `-22` (Invalid argument) khi Boxblur trên ROI hẹp:**
   - *Tệp tin:* `src/subtitle_localizer/render/mask.py:24-26`.
   - *Bằng chứng:* FFmpeg YUV420p yêu cầu `chroma_radius <= H / 4`. Với ROI cao < 56px, `radius = 14` làm crash FFmpeg. Đã kiểm chứng lệnh ffmpeg thực tế: cấu hình `chroma_radius=0` và clamp `luma_radius` giải quyết triệt để lỗi.
   - *Giải pháp:* Clamp `radius <= max(1, H//2 - 1)` và gán cứng `chroma_radius=0`.
3. **Lỗi HTTP 500 khi Tải Phụ Đề (.SRT/.ASS) có Tên Ký Tự Unicode (Tiếng Việt / Tiếng Trung):**
   - *Tệp tin:* `src/subtitle_localizer/service/server.py:1280, 1298`.
   - *Bằng chứng:* Starlette mã hóa header HTTP bằng `latin-1`. Ký tự Unicode trong `Content-Disposition: filename="..."` ném `UnicodeEncodeError`.
   - *Giải pháp:* Mã hóa RFC 5987 / RFC 6266 (`filename*=UTF-8''...`) kèm fallback ASCII.
4. **Lỗi HTTP 422 Từ Chối 9 Kiểu Che Mới Khi Xuất MP4:**
   - *Tệp tin:* `src/subtitle_localizer/service/server.py:864`.
   - *Bằng chứng:* `_do_export_mp4` chặn cứng `if mask_mode not in {"box", "blur", "none"}` trong khi frontend và `mask.py` hỗ trợ 9 kiểu (`feather_tight`, `optical_blend`, v.v.).
   - *Giải pháp:* Mở rộng tập hợp mask_mode hợp lệ đón nhận toàn bộ 9 kiểu che.
5. **Lỗi `UnicodeDecodeError: 'charmap'` trong Subprocess trên Windows:**
   - *Tệp tin:* `src/subtitle_localizer/render/export.py:86, 97`, `src/subtitle_localizer/media/probe.py:88, 107`, `src/subtitle_localizer/service/downloader.py:208, 214, 997, 1009`.
   - *Bằng chứng:* Các lệnh `subprocess.run(..., text=True)` thiếu `encoding="utf-8"`, Windows dùng mã CP1252/charmap làm crash luồng khi FFmpeg/yt-dlp xuất log Unicode.
   - *Giải pháp:* Bổ sung `encoding="utf-8", errors="replace"` cho toàn bộ các lệnh `subprocess.run`.
6. **Rò Rỉ Đĩa Cứng & Tích Tụ File Tạm trong `downloader/src/`:**
   - *Tệp tin:* `src/subtitle_localizer/downloader/hongguo_parser.py:660, 703` & `src/subtitle_localizer/service/downloader.py:30, 940`.
   - *Bằng chứng:* Lệnh `parser.schedule_video_cleanup = lambda ...: None` tắt tự động xóa, `downloader.py` sao chép sang `uploads/` nhưng không dọn file gốc.
   - *Giải pháp:* Kích hoạt lại dọn dẹp tự động và xóa file tạm ngay sau khi copy thành công.

### Nhóm 2: Lỗi Logic & Thao Tác Ảo (Logic & Fake Controls)
7. **Nuốt Lỗi Âm Thầm & Báo Trạng Thái "Completed" Ảo trong Batch Hub:**
   - *Tệp tin:* `web/src/components/project/DashboardBatchHub.tsx:618-649`.
   - *Bằng chứng:* `try { await apiClient.exportMp4(...) } catch {}` nuốt toàn bộ exception và gán `status: 'completed'`.
   - *Giải pháp:* Bắt lỗi minh bạch, đánh dấu `status: 'failed'`, hiển thị rõ thông điệp lỗi cho người dùng.
8. **Checkbox "Áp dụng lật video vào MP4 xuất ra" Bị Liệt:**
   - *Tệp tin:* `web/src/components/sidebar/CapcutSidebar.tsx:506-525`, `web/src/api/client.ts`, `src/subtitle_localizer/service/server.py:44, 856`.
   - *Bằng chứng:* UI có checkbox và icon lật, nhưng `apiClient.exportMp4` không gửi dữ liệu `flip_h`, `flip_v` và server không hỗ trợ.
   - *Giải pháp:* Bổ sung `flip_h`, `flip_v` vào `Mp4ExportRequest`, nối bộ lọc `,hflip` / `,vflip` vào filter chain của FFmpeg.
9. **Gán Cứng `mask_mode: 'blur'` trong Batch Hub:**
   - *Tệp tin:* `web/src/components/project/DashboardBatchHub.tsx:642`, `web/src/components/sidebar/CapcutSidebar.tsx:84`.
   - *Bằng chứng:* Batch render luôn ép `mask_mode: 'blur'`, vô hiệu hóa cấu hình preset profile.
   - *Giải pháp:* Lấy `preset.mask_style` truyền động vào `exportMp4`.
10. **Vòng Lặp Từ Điển Thuật Ngữ (`DEFAULT_CHINESE_VIETNAMESE_GLOSSARY`) Bị Bỏ Trống (`pass`):**
    - *Tệp tin:* `src/subtitle_localizer/translation/real.py:82-85`.
    - *Bằng chứng:* Có 30+ thuật ngữ định nghĩa nhưng vòng lặp chỉ chứa `pass`.
    - *Giải pháp:* Thay thế văn bản theo danh từ điển chuyên dụng trước khi chuẩn hóa chữ hoa đầu câu.

### Nhóm 3: Khả Năng Khôi Phục Giao Diện & Polish (UI Resilience)
11. **Nguy Cơ Treo Tạo Thumbnail Client-side Khi `seeked` Không Kích Hoạt:**
    - *Tệp tin:* `web/src/components/timeline/BottomTimeline.tsx:163-174`.
    - *Bằng chứng:* `new Promise` chờ `onseeked` không có timeout, nếu tại 0s trình duyệt không bắn event thì bị treo vô hạn.
    - *Giải pháp:* Thêm guard timeout 1000ms cho mỗi thumbnail frame.
12. **Thanh Trượt Vị Trí Dọc (Y) Bị Khóa Cứng Từ 40% Đến 95%:**
    - *Tệp tin:* `web/src/components/sidebar/CapcutSidebar.tsx:648`.
    - *Bằng chứng:* `min="40"` chặn điều chỉnh vùng quét phụ đề phía trên khung hình (Y < 40%).
    - *Giải pháp:* Đưa `min="0"`, `max="95"`.
13. **Cảnh Báo React `setState` Đồng Thời Trong Render:**
    - *Tệp tin:* `web/src/components/common/GlobalActivityLogger.tsx:57`.
    - *Bằng chứng:* Gây cảnh báo React re-render.
    - *Giải pháp:* Bọc listener dispatch trong `queueMicrotask()`.
14. **LƯU Ý BẢO TOÀN KIẾN TRÚC VỀ `web/src/components/editor/`:**
    - Báo cáo kiểm toán cũ từng đề xuất xóa thư mục này, tuy nhiên đối soát mã nguồn cho thấy `tests/t09/test_subtitle_editor.py` có assertion kiểm tra trực tiếp sự tồn tại của `CueTable.tsx`.
    - **QUYẾT ĐỊNH KỸ THUẬT:** TUYỆT ĐỐI KHÔNG XÓA để tránh gây vỡ test regression.

---

## 3. Lộ Trình Triển Khai Sửa Chữa (4 Giai Đoạn Nguyên Tử)

### Giai đoạn 1: Backend Core & Runtime Safety
- Sửa import `Crypto` / `Cryptodome` fallback tại `hongguo_parser.py`, `helios.py`, `ttEncryptorUtil.py`.
- Sửa `mask.py`: Clamp `radius` an toàn và thêm `chroma_radius=0` cho filter `boxblur`.
- Sửa `server.py`: Hỗ trợ mã hóa RFC 5987 / RFC 6266 cho export SRT/ASS, mở rộng 9 mask modes.
- Sửa `export.py`, `probe.py`, `downloader.py`: Thêm `encoding="utf-8", errors="replace"` cho `subprocess.run`.

### Giai đoạn 2: Downloader & Dọn Dẹp Tệp Tạm
- Kích hoạt lại dọn dẹp file tạm của bộ tải `hongguo_parser.py`.
- Tự động dọn file nguồn trong `downloader/src/` sau khi copy sang `uploads/`.

### Giai đoạn 3: Frontend Real Controls & Error Transparency
- Sửa `DashboardBatchHub.tsx`: Bỏ nuốt lỗi âm thầm, hiển thị đúng trạng thái `failed`, truyền đúng `mask_mode` theo Preset.
- Sửa `CapcutSidebar.tsx`, `client.ts`, `server.py`: Kết nối tính năng lật video vào MP4 xuất ra (`flip_h`, `flip_v`).
- Sửa `BottomTimeline.tsx`: Thêm timeout cho Promise tạo thumbnail client-side.
- Sửa `CapcutSidebar.tsx`: Mở rộng phạm vi slider Y từ 0% đến 95%.

### Giai đoạn 4: Thuật Ngữ Bản Dịch & UI Polish
- Sửa `real.py`: Kích hoạt vòng lặp thay thế từ điển thuật ngữ.
- Sửa `GlobalActivityLogger.tsx`: Bọc listener call trong `queueMicrotask()`.

---

## 4. Kế Hoạch Nghiệm Thu & Bảo Chứng Kỹ Thuật (Evidence-Based Verification)

### Kiểm thử tự động (Automated Verification):
1. Chạy toàn bộ pytest suite:
   ```powershell
   python -m pytest tests/ -v
   ```
   *Yêu cầu:* 100% tests passed (bao gồm toàn bộ tests từ t00 đến t14, không còn lỗi collection hay lỗi Crypto).
2. Kiểm tra đóng gói TypeScript:
   ```powershell
   cd web; npm run build
   ```
   *Yêu cầu:* 0 lỗi biên dịch, exit code 0.

### Nghiệm thu thực nghiệm với video thật (Real Video End-to-End):
1. Thử nghiệm xuất phụ đề `.srt` / `.ass` với tiêu đề tiếng Việt và tiếng Trung: Phản hồi HTTP 200, tải file thành công, không văng mã lỗi 500.
2. Thử nghiệm xuất video MP4 với ROI chiều cao hẹp (30px) và kiểu `feather_tight`: FFmpeg hoàn tất không gặp lỗi `-22`.
3. Thử nghiệm xuất video MP4 có bật lật video (`hflip`): Video xuất ra được lật thực tế theo đúng cài đặt.
4. Ghi lại bằng chứng nhật ký terminal đầy đủ và chụp ảnh nghiệm thu giao diện.
