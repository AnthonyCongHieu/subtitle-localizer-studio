# BÁO CÁO KIỂM TOÁN CHUYÊN SÂU TOÀN DIỆN: UI, BACKEND & HỆ THỐNG LOGIC
**Dự án:** Subtitle Localizer Studio  
**Thời gian kiểm toán:** 04/09/2026  
**Phương pháp kiểm toán:** DevTools Trình duyệt thực tế (DOM, CSS Computed, Accessibility Tree, Debounce Timers), Pytest Test Suite, Kiểm tra trực tiếp API FastAPI, Kiểm tra thực thi FFmpeg CLI, Đối soát mã nguồn hai chiều (Frontend <-> Backend).  
**Nguyên tắc thực thi:** 100% bằng chứng thực nghiệm bảo chứng, không đưa ra giả định chủ quan, ghi nhận đầy đủ mã thoát (exit code) và terminal log.

---

## MỤC LỤC
1. [Tổng quan hiện trạng hệ thống](#1-tổng-quan-hiện-trạng-hệ-thống)
2. [Chi tiết kiểm thử Frontend & Giao diện UI](#2-chi-tiết-kiểm-thử-frontend--giao-diện-ui)
3. [Chi tiết kiểm thử Backend & Test Suite](#3-chi-tiết-kiểm-thử-backend--test-suite)
4. [Các phát hiện & Lỗi ẩn đã được bảo chứng thực nghiệm](#4-các-phát-hiện--lỗi-ẩn-đã-được-bảo-chứng-thực-nghiệm)
5. [Hạng mục cần điều tra chuyên sâu bổ sung](#5-hạng-mục-cần-điều-tra-chuyên-sâu-bổ-sung)

---

## 1. TỔNG QUAN HIỆN TRẠNG HỆ THỐNG

* **Backend:** FastAPI, Uvicorn (Port `8899`), SQLite/File Repository, FFmpeg, RapidOCR ONNX, Edge-TTS.
* **Frontend:** React 18, Vite (Port `5199`), TailwindCSS, Lucide Icons, Canvas/CSS Transforms.
* **Tệp video kiểm thử trực tiếp:** `uploads/美女总裁不好惹，小神医专治不服_Tap_01.mp4` (Thời lượng 2 phút 47 giây, 1080x1920 dọc).
* **Video ghi hình thao tác tự động trên trình duyệt:**  
  `recording.webm` (Lưu tại: `C:/Users/pc2/.gemini/antigravity/brain/c68b89e9-9838-4c8e-b56f-c4e8c84dd49c/recording.webm`).

---

## 2. CHI TIẾT KIỂM THỬ FRONTEND & GIAO DIỆN UI

### 2.1. Đồng bộ Tọa độ 1:1 giữa Ô quét ROI và Lớp phủ mờ (Preview Mask)
* Cả ô tương tác ROI (`RoiOverlay`) và lớp mờ (`PreviewMask`) đều sử dụng chung không gian tọa độ container (`videoBoxRef`):
  $$\text{pixel\_x} = \text{round}(\text{region.x} \times \text{boxDimensions.width})$$
  $$\text{pixel\_y} = \text{round}(\text{region.y} \times \text{boxDimensions.height})$$
* **Bằng chứng thực nghiệm đo kiểm DOM trên màn hình Studio:**
  * **Tại Y = 20% (0.20):**
    * ROI Box: `top: 119px, left: 0px, width: 335px, height: 45px`
    * Preview Mask: `top: 119px, left: 0px, width: 335px, height: 45px`
    * Độ lệch: $\Delta x = 0\text{px}, \Delta y = 0\text{px}, \Delta w = 0\text{px}, \Delta h = 0\text{px}$ (Khớp tuyệt đối).
  * **Tại Y = 50% (0.50):**
    * ROI Box: `top: 298px, left: 0px, width: 335px, height: 45px`
    * Preview Mask: `top: 298px, left: 0px, width: 335px, height: 45px`
    * Độ lệch: $\Delta x = 0\text{px}, \Delta y = 0\text{px}, \Delta w = 0\text{px}, \Delta h = 0\text{px}$ (Khớp tuyệt đối).
  * **Tại Y = 80% (0.80):**
    * ROI Box: `top: 478px, left: 0px, width: 335px, height: 45px`
    * Preview Mask: `top: 478px, left: 0px, width: 335px, height: 45px`
    * Độ lệch: $\Delta x = 0\text{px}, \Delta y = 0\text{px}, \Delta w = 0\text{px}, \Delta h = 0\text{px}$ (Khớp tuyệt đối).
* **SVG Spotlight Mask:** Thẻ `#roi-spotlight-mask rect` nhận chuẩn tọa độ pixel, không bị rách mép hay lộ phụ đề gốc khi di chuyển ô quét.

### 2.2. Kiểm tra 9 Kiểu Che (Mask Styles) & Thanh trượt Độ mờ (Blur Strength)
* Đã chuyển đổi và kiểm tra Computed Styles của cả 9 kiểu:
  1. `feather_tight`: Backdrop-blur 24px, nền rgba(0,0,0,0.2), viền feather gradient 4%-96%.
  2. `optical_blend`: Backdrop-blur 28px, nền rgba(0,0,0,0.1), viền quang học mềm 5%-95%.
  3. `soft_cinema`: Backdrop-blur 20px, gradient dọc đen 35% -> 15% -> transparent.
  4. `blur`: Backdrop-blur 24px, nền đen 15%.
  5. `glass`: Backdrop-blur 24px, nền trắng 5%, viền sáng nhẹ 10%.
  6. `ambient`: Backdrop-blur 18px, gradient chuyển tiếp đáy 40% -> 20%.
  7. `feather`: Backdrop-blur 20px, góc bo nhẹ 4px.
  8. `box`: Nền đen thuần 90% cinema.
  9. `mosaic`: Nền điểm chấm radial mosaic kính mờ.
* **Thanh trượt Blur Strength (6px đến 48px):**
  * Tại **6px**: DOM nhận `style.backdropFilter = "blur(6px)"`, nhãn `6px`.
  * Tại **38px**: DOM nhận `style.backdropFilter = "blur(38px)"`, nhãn `38px`.
  * Tại **48px**: DOM nhận `style.backdropFilter = "blur(48px)"`, nhãn `48px`.

### 2.3. Kiểm tra Thanh trượt Xoay (-180° đến 180°) & Logic Chu kỳ 360°
* Kéo góc dương (+37°): Video wrapper nhận `transform: ... rotate(37deg)`.
* Kéo góc âm (-180°): Video wrapper nhận `transform: ... rotate(-180deg)`.
* Nhấp nút reset 0°: Giá trị trở về `0°`, video wrapper xóa góc nghiêng về `rotate(0deg)`.
* Nhấp nút +90° liên tục 4 lần:
  * $0^\circ \rightarrow 90^\circ \rightarrow 180^\circ \rightarrow -90^\circ \rightarrow 0^\circ$
  * Hàm chuẩn hóa góc `normalizeRotation` xử lý modulo chuẩn xác, thanh trượt không bị nhảy góc hay kẹt cứng.

### 2.4. Kiểm tra Zoom (50% đến 300%) & Tính độc lập của Vùng quét ROI
* Kéo Zoom 200%: Video wrapper nhận `transform: ... scale(2)`.
* Kéo Zoom 300%: Video wrapper nhận `transform: ... scale(3)`.
* **Tính bảo toàn vùng quét:** Zoom chỉ tác động lên phần tử `<video>`, các lớp overlay (Ô ROI và Lớp phủ mờ) không bị phóng to theo, đảm bảo phụ đề quét luôn khớp chính xác với khung hình gốc.
* Nút Fit: Bấm nút khôi phục ngay về trạng thái `'fit'` (`scale(1)` chuẩn khung hình).

### 2.5. Toàn màn hình & Tách biệt Click (Play/Pause) vs Double-Click (Fullscreen)
* **Toàn màn hình & Phím F:**
  * Bấm nút Fullscreen hoặc nhấn phím `F`/`f`: `videoBoxRef` co giãn theo `100vw / 100vh`.
  * Bộ quan sát `ResizeObserver` bắt kịp kích thước màn hình mới, tự động phóng to ô ROI và lớp mờ tương ứng 100%, không bị co cụm về góc.
* **Debouncing Timer 240ms:**
  * Thử nghiệm Single-click: Tại 100ms video vẫn giữ nguyên trạng thái; sau 240ms (tại 300ms) video bắt đầu Play.
  * Thử nghiệm Double-click (2 click cách nhau 60ms): Lệnh click thứ 2 đã hủy hoàn toàn timer play/pause (`playWasNotTriggeredOnDoubleClick = true`), chỉ kích hoạt chuyển đổi toàn màn hình.

### 2.6. Hệ thống Thông báo Toast & Bảng Nhật ký Toàn cục
* **Toast góc dưới phải (`.fixed.bottom-4.right-4`):** Hiển thị các hành động (Lật video, xoay góc, đổi vị trí sub...), tự động biến mất sau 3.5 giây.
* **Drawer Nhật ký góc dưới trái (`.fixed.bottom-12.left-3`):**
  * Nút "Nhật ký" mở drawer hiển thị danh sách log có nhãn thời gian, phân loại, cấp độ.
  * Nút **Sao chép log**: Chép toàn bộ văn bản log vào clipboard theo định dạng chuẩn.
  * Nút **Xóa lịch sử**: Làm sạch store trong bộ nhớ và làm rỗng bảng hiển thị.

---

## 3. CHI TIẾT KIỂM THỬ BACKEND & TEST SUITE

### 3.1. Kết quả Bộ Kiểm thử Pytest Toàn Diện
* **Lệnh chạy:**
  ```powershell
  python -m pytest tests/ -q --ignore=tests/t14/test_concurrency_stress.py
  ```
  * **Kết quả:** **241 passed in 35.00s**
  * **Mã thoát (Exit code):** `0`
* **Kiểm thử T08 (Render/Export/Masking) & T10 (API Integration):**
  ```powershell
  python -m pytest tests/t08/ tests/t10/ -v
  ```
  * **Kết quả:** **12 passed, 0 failed**
  * **Mã thoát (Exit code):** `0`

### 3.2. Kiểm thử Thực tế Các Endpoint API Máy chủ
* `GET /api/v1/health` $\rightarrow$ `200 OK`
* `GET /api/v1/projects` $\rightarrow$ `200 OK`
* `GET /api/v1/projects/{id}/cues` $\rightarrow$ `200 OK`
* `GET /api/v1/projects/{id}/video/stream` $\rightarrow$ `206 Partial Content` (Range stream mượt mà)
* `GET /api/v1/projects/{id}/audio-waveform` $\rightarrow$ `200 OK` (Trả về 801 điểm biên độ âm thanh)
* `GET /api/v1/downloader/queue/list` $\rightarrow$ `200 OK`
* `GET /api/v1/settings/gemini-pool` $\rightarrow$ `200 OK` (44 khóa API sẵn sàng)

### 3.3. Kiểm thử Tự động Nhận diện Vùng chữ (Auto-Detect ROI bằng RapidOCR)
* Gọi `POST /api/v1/projects/proj-338648bc/roi/auto-detect` tại PTS 15.0s:
  * Engine RapidOCR nhận diện chính xác dòng chữ phụ đề tiếng Trung trên video.
  * Trả về tọa độ chuẩn hóa: `x: 0.1376, y: 0.6277, width: 0.722, height: 0.0727` (Status: `success`).

### 3.4. Kiểm thử Lồng tiếng AI (Edge-TTS) & Hòa trộn Âm thanh (Audio Ducking)
* Gọi `POST /api/v1/projects/proj-338648bc/dubbing/run`:
  * Tạo tệp `outputs/proj-338648bc/voiceover_proj-338648bc.mp3` dung lượng 89,068 bytes, giọng `vi-VN-NamMinhNeural`.
* Gọi Render MP4:
  * FFmpeg tự động áp dụng `amix=inputs=2:duration=first:dropout_transition=2` với nhạc nền giảm còn 25% khi có tiếng đọc thuyết minh.
  * Video xuất ra có đầy đủ track hình ảnh H.264 và âm thanh AAC chuẩn hóa (Dung lượng: 47.4 MB).

---

## 4. CÁC PHÁT HIỆN & LỖI ẨN ĐÃ ĐƯỢC BẢO CHỨNG THỰC NGHIỆM

### 🔴 LỖI 1 [CRITICAL]: FFmpeg sập mã lỗi `-22` khi Boxblur trên vùng ROI có chiều cao nhỏ
* **Tệp tin:** [`src/subtitle_localizer/render/mask.py` (Dòng 24-26)](file:///e:/tool%20edit/subtitle-localizer-studio/src/subtitle_localizer/render/mask.py#L24-L26)
* **Bản chất:**
  * Khi áp dụng `feather_tight` hoặc `optical_blend`, hệ thống gán cứng `radius = 14`.
  * Bộ lọc `boxblur` của FFmpeg tự động lấy `chroma_radius = luma_radius = 14`.
  * Trong video chuẩn YUV420p, mặt phẳng màu có chiều cao bằng $1/2$ chiều cao khung hình, FFmpeg quy định bán kính chroma tối đa là $H / 4$.
  * Với các video có phụ đề 1 dòng kích thước chiều cao $H \le 56\text{px}$, FFmpeg lập tức sập với mã lỗi `-22`.
* **Bằng chứng tái hiện thực nghiệm:**
  ```powershell
  ffmpeg -f lavfi -i color=c=black:s=1280x720:d=1 -vf "split[main][sub];[sub]crop=1280:30:0:600,boxblur=luma_radius=10:luma_power=3[blurred];[main][blurred]overlay=0:600" -f null -
  ```
  **Mã thoát:** `1`  
  **Thông điệp lỗi:**
  ```text
  [Parsed_boxblur_2 @ 00000202664ce200] Invalid chroma_param radius value 10, must be >= 0 and <= 7
  [Parsed_boxblur_2 @ 00000202664ce200] Failed to evaluate filter params: -22.
  Task finished with error code: -22 (Invalid argument)
  Conversion failed!
  ```

---

### 🔴 LỖI 2 [CRITICAL]: Lỗi HTTP 500 khi Tải File Phụ Đề .SRT / .ASS do Tên Video Chứa Ký Tự Tiếng Việt hoặc Tiếng Trung
* **Tệp tin:** [`src/subtitle_localizer/service/server.py` (Dòng 1280 và 1298)](file:///e:/tool%20edit/subtitle-localizer-studio/src/subtitle_localizer/service/server.py#L1280)
* **Bản chất:**
  ```python
  filename = f"{project.title}.srt"
  return Response(
      content=srt_content.encode("utf-8"),
      media_type="text/plain; charset=utf-8",
      headers={"Content-Disposition": f'attachment; filename="{filename}"'},
  )
  ```
  Starlette/ASGI mã hóa các header HTTP bằng bảng mã `latin-1`. Khi tiêu đề dự án chứa ký tự tiếng Trung (`美女总裁不好惹...`) hoặc tiếng Việt có dấu (`Nữ tổng tài...`), `v.encode("latin-1")` bị crash với ngoại lệ `UnicodeEncodeError`.
* **Bằng chứng tái hiện thực nghiệm:**
  Gọi `GET /api/v1/projects/proj-338648bc/export/srt?use_translated=true`:
  ```text
  Traceback (most recent call last):
    File "starlette/responses.py", line 61, in init_headers
      raw_headers = [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()]
  UnicodeEncodeError: 'latin-1' codec can't encode characters in position 22-36: ordinal not in range(256)
  INFO: 127.0.0.1 - "GET /api/v1/projects/proj-338648bc/export/srt HTTP/1.1" 500 Internal Server Error
  ```

---

### 🔴 LỖI 3 [CRITICAL]: Máy chủ từ chối các kiểu che mờ mới với mã lỗi HTTP 422
* **Tệp tin:** [`src/subtitle_localizer/service/server.py` (Dòng 864)](file:///e:/tool%20edit/subtitle-localizer-studio/src/subtitle_localizer/service/server.py#L864)
* **Bản chất:**
  Giao diện và `SubtitleMasker` hỗ trợ 9 kiểu che, nhưng tại `_do_export_mp4`, backend lại chặn:
  ```python
  if mask_mode not in {"box", "blur", "none"}:
      raise HTTPException(status_code=422, detail="Unsupported mask mode")
  ```
* **Bằng chứng tái hiện thực nghiệm:**
  ```powershell
  curl.exe -s -X POST http://localhost:8899/api/v1/projects/proj-338648bc/export/mp4 -H "Content-Type: application/json" -d "{\"mask_mode\":\"feather_tight\",\"use_translated\":true}"
  ```
  **Kết quả:**
  ```json
  HTTP/1.1 422 Unprocessable Entity
  {"detail":"Unsupported mask mode"}
  ```

---

### 🔴 LỖI 4 [CRITICAL]: Lỗi giải mã Subprocess trên Windows (`UnicodeDecodeError: 'charmap'`) khi FFmpeg/yt-dlp/ffprobe xuất chuỗi ký tự UTF-8
* **Tệp tin:**
  * [`src/subtitle_localizer/render/export.py` (Dòng 86, 97)](file:///e:/tool%20edit/subtitle-localizer-studio/src/subtitle_localizer/render/export.py#L86)
  * [`src/subtitle_localizer/media/probe.py` (Dòng 88, 107)](file:///e:/tool%20edit/subtitle-localizer-studio/src/subtitle_localizer/media/probe.py#L88)
  * [`src/subtitle_localizer/service/downloader.py` (Dòng 208, 214, 997, 1009)](file:///e:/tool%20edit/subtitle-localizer-studio/src/subtitle_localizer/service/downloader.py#L208)
* **Bản chất:**
  * Các lệnh `subprocess.run(..., capture_output=True, text=True)` không truyền tham số `encoding="utf-8"`.
  * Trên hệ điều hành Windows, Python mặc định sử dụng bảng mã ANSI của hệ thống (CP1252 / charmap).
  * Khi FFmpeg in log tiến trình chứa tên tệp tiếng Việt/tiếng Trung, hoặc ffprobe đọc metadata có ký tự Unicode, luồng đọc `_readerthread` bị sập lập tức: `UnicodeDecodeError: 'charmap' codec can't decode byte 0x81 in position ...`.
* **Bằng chứng thực nghiệm:** Đã ghi nhận trực tiếp trong log tiến trình `task-3282.log` khi kết xuất video `美女总裁不好惹，小神医专治不服_Tap_01.mp4`. Tại `server.py:1369`, nhà phát triển đã từng phải sửa lỗi này cho `pick_file.py` bằng `encoding="utf-8"`, nhưng chưa áp dụng đồng bộ cho các module render và probe.

---

### 🔴 LỖI 5 [CRITICAL]: Rò rỉ đĩa cứng nghiêm trọng & Tích tụ file video tạm trong mã nguồn (`downloader/src/`)
* **Tệp tin:**
  * [`src/subtitle_localizer/downloader/hongguo_parser.py` (Dòng 660, 703)](file:///e:/tool%20edit/subtitle-localizer-studio/src/subtitle_localizer/downloader/hongguo_parser.py#L660)
  * [`src/subtitle_localizer/service/downloader.py` (Dòng 30, 932-944)](file:///e:/tool%20edit/subtitle-localizer-studio/src/subtitle_localizer/service/downloader.py#L30)
* **Bản chất:**
  * Tại `downloader.py:30`: `parser.schedule_video_cleanup = lambda filepath, delay_seconds=0: None` đã vô hiệu hóa hoàn toàn cơ chế tự dọn dẹp file tạm của bộ giải mã.
  * Sau khi FFmpeg stream tải về tệp `src/subtitle_localizer/downloader/src/video_{time_ns}.mp4`, hàm `_download_hongguo_task` sao chép sang thư mục `uploads/` (`shutil.copy2`) nhưng **không bao giờ xóa** tệp gốc trong `downloader/src/`.
  * Hơn thế nữa, logic dự phòng `max(files, key=os.path.getmtime)` tại dòng 937 quét toàn bộ thư mục này, dẫn đến nguy cơ nhặt nhầm video cũ của phiên trước khi tải hàng loạt.
* **Bằng chứng thực nghiệm đo kiểm:**
  * Quét thực tế thư mục `src/subtitle_localizer/downloader/src/`: Hiện đang có **81 tệp video MP4** bị bỏ quên với dung lượng từ 3MB đến 18MB mỗi tệp (tổng dung lượng rò rỉ xấp xỉ **600MB - 1GB** nằm ngay trong thư mục mã nguồn Git).
  * Vi phạm trực tiếp quy tắc lưu trữ trong `AGENTS.md`: *"Do not commit videos, models, proxies, caches, outputs, databases"*.

---

### 🔴 LỖI 6 [CRITICAL]: Nuốt lỗi âm thầm (Silent Failure) & Báo trạng thái "Completed" ảo trong Batch Processing
* **Tệp tin:** [`web/src/components/project/DashboardBatchHub.tsx` (Dòng 618-649)](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/components/project/DashboardBatchHub.tsx#L618-L649)
* **Bản chất:**
  ```typescript
  try {
    await apiClient.retranslateProject(targetProj.project_id);
  } catch {}
  ...
  try {
    await apiClient.exportMp4(targetProj.project_id, { use_translated: true, mask_mode: 'blur' });
  } catch {}

  setQueueItems((prev) =>
    prev.map((it, i) => (i === idx ? { ...it, status: 'completed' } : it))
  );
  ```
  * Khi xử lý hàng loạt nhiều video, các bước Dịch thuật (`retranslateProject`) và Kết xuất MP4 (`exportMp4`) được bọc trong các khối `try ... catch {}` rỗng.
  * Nếu FFmpeg bị sập, ổ cứng đầy hoặc mất kết nối API, lỗi bị nuốt hoàn toàn. Vòng lặp ngay lập tức gán nhãn `status: 'completed'` và hiển thị dấu tích xanh cho người dùng, dù video kết xuất không hề được tạo ra.

---

### 🟡 LỖI 7 [LOGIC]: Checkbox "Áp dụng lật video vào MP4 xuất ra" bị liệt (Dead UI Control)
* **Tệp tin:** [`web/src/components/sidebar/CapcutSidebar.tsx` (Dòng 506-525 và Dòng 135)](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/components/sidebar/CapcutSidebar.tsx#L506-L525)
* **Bản chất:** Checkbox cho phép người dùng chọn lật ngang/dọc khi xuất video để lách bản quyền, nhưng hàm `handleExportMp4` không gửi thông số lật lên API và backend cũng chưa có trường nhận thông số này. Video kết xuất luôn là video gốc chưa lật.

---

### 🟡 LỖI 8 [LOGIC]: Gán cứng `mask_mode: 'blur'` trong Batch Hub và Sidebar chỉ có 3 tùy chọn mờ
* **Tệp tin:**
  * [`web/src/components/project/DashboardBatchHub.tsx` (Dòng 642)](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/components/project/DashboardBatchHub.tsx#L642): Gán cứng `mask_mode: 'blur'` khi render hàng loạt, bỏ qua toàn bộ thiết lập trong Preset Profile đã chọn (`feather_tight`, `optical_blend`, v.v.).
  * [`web/src/components/sidebar/CapcutSidebar.tsx` (Dòng 84, 530-538)](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/components/sidebar/CapcutSidebar.tsx#L84): State `maskMode` nội bộ chỉ có `'blur' | 'box' | 'none'`, không nhận prop `maskStyle` từ Studio Toolbar, làm mất tính đồng bộ kiểu che mờ khi xuất video từ Sidebar.

---

### 🟡 LỖI 9 [LOGIC]: Vòng lặp Từ điển Thuật ngữ (`DEFAULT_CHINESE_VIETNAMESE_GLOSSARY`) bị bỏ trống (`pass`)
* **Tệp tin:** [`src/subtitle_localizer/translation/real.py` (Dòng 82-85)](file:///e:/tool%20edit/subtitle-localizer-studio/src/subtitle_localizer/translation/real.py#L82-L85)
* **Bản chất:**
  ```python
  # Áp dụng từ điển ngữ cảnh chuyên sâu
  for zh_term, vi_term in DEFAULT_CHINESE_VIETNAMESE_GLOSSARY.items():
      if zh_term in source_text:
          pass
  ```
  Từ điển chứa hơn 30 thuật ngữ hội thoại / tiếng lóng tiếng Trung (được định nghĩa ở dòng 15-49) bị bỏ trống bằng lệnh `pass`, hoàn toàn không có tác dụng thay thế hay tinh chỉnh bản dịch.

---

### 🟡 LỖI 10 [FRONTEND HANG]: Nguy cơ đóng băng tạo Thumbnail Video trên Trình duyệt khi `seeked` không kích hoạt
* **Tệp tin:** [`web/src/components/timeline/BottomTimeline.tsx` (Dòng 163-174)](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/components/timeline/BottomTimeline.tsx#L163-L174)
* **Bản chất:**
  Hàm trích xuất thumbnail client-side tạo `new Promise` chờ sự kiện `offscreenVideo.onseeked`. Tại mốc `i = 0` (`targetTime = 0`), nếu video đã ở vị trí 0s hoặc gặp lỗi định dạng, trình duyệt không kích hoạt sự kiện `seeked`. Do không có `timeout` bảo vệ, Promise bị treo vĩnh viễn, khiến cờ `isGeneratingThumbs` kẹt ở `true` liên tục.

---

### 🟡 LỖI 11 [UI CONSTRAINT]: Thanh trượt Vị trí dọc (Y) bị khóa cứng từ 40% đến 95%
* **Tệp tin:** [`web/src/components/sidebar/CapcutSidebar.tsx` (Dòng 648)](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/components/sidebar/CapcutSidebar.tsx#L648)
* **Bản chất:** `<input type="range" min="40" max="95" ... />` chặn người dùng kéo vùng quét phụ đề lên phía trên khung hình (Y < 40%). Với các video có phụ đề ở mép trên (tiêu đề, ghi chú trên đỉnh), người dùng không thể chỉnh được qua thanh trượt trong Sidebar.

---

### 🟡 LỖI 12 [REACT WARNING]: Cảnh báo setState đồng thời trong chu kỳ Render
* **Tệp tin:** [`web/src/components/common/GlobalActivityLogger.tsx:L57`](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/components/common/GlobalActivityLogger.tsx#L57) & [`App.tsx`](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/App.tsx)
* **Bản chất:** Khi phát event ghi log đồng bộ trong chu kỳ re-render của component cha, React đưa ra cảnh báo: `Cannot update a component ('GlobalActivityLogger') while rendering a different component ('App')`. Cần đẩy việc gọi listener vào `queueMicrotask()`.

---

### 🔵 LỖI 13 [DEAD CODE]: Toàn bộ thư mục `web/src/components/editor/` (~120KB) là mã rác không sử dụng
* **Tệp tin:** `web/src/components/editor/` gồm 7 tệp (`CueTable.tsx`, `EditorView.tsx`, `ExportModal.tsx`, `ProxyPlayer.tsx`, `RoiSelector.tsx`, `WaveformTimeline.tsx`, `useUndoRedo.ts`).
* **Bản chất:** Không có bất kỳ thành phần nào trong ứng dụng chính (`App.tsx`, `DashboardBatchHub.tsx`, `CapcutSidebar.tsx`) nhập (import) các tệp này. Đây là tàn dư từ phiên bản kiến trúc cũ, gây phân tâm khi bảo trì và làm tăng kích thước bundle build không cần thiết.

---

## 5. KẾT QUẢ ĐIỀU TRA CHUYÊN SÂU 4 HẠNG MỤC BỔ SUNG

### 5.1. Luồng Tải Video Hàng Loạt & Đồng Bộ Đa Luồng (Adversarial Concurrency Stress Test)
* **Kiểm thử thực nghiệm:** Đã thực thi bộ kiểm thử áp lực đa luồng đối kháng tại `tests/t14/test_concurrency_stress.py`.
* **Kết quả:** **7/7 test passed in 21.98s** (Exit code: `0`).
  * Ghi nhận nạp đồng thời 200 tác vụ từ 20 luồng song song: 0 tác vụ bị mất mát, 0 trùng lặp ID.
  * Thử nghiệm liên tục tạm dừng (pause) và tiếp tục (resume) khi đang tải: Khóa đồng bộ `RLock` và biến điều kiện `Condition` hoạt động ổn định, không xuất hiện deadlock.
  * Tự động phục hồi và chuyển tiếp tác vụ khi một tập phim gặp ngoại lệ: Hàng đợi tự động xử lý tiếp các tập còn lại mà không bị sập worker.

### 5.2. Cơ Chế Luân Chuyển Khóa API Gemini Pool Khi Dính Rate Limit (429)
* **Mã nguồn:** [`src/subtitle_localizer/translation/key_pool.py`](file:///e:/tool%20edit/subtitle-localizer-studio/src/subtitle_localizer/translation/key_pool.py) & [`real.py`](file:///e:/tool%20edit/subtitle-localizer-studio/src/subtitle_localizer/translation/real.py)
* **Kết quả đối soát:**
  * Khi gặp lỗi HTTP 429: Hệ thống tự động đọc header `Retry-After` (hoặc mặc định 60s) và đưa key vào danh sách cách ly tạm thời (`_cooldowns`).
  * Nếu lỗi là do hết hạn mức ngày (`daily_quota_exhausted` / RPD): Hệ thống tự động cách ly key trong 4 giờ (14,400s).
  * Hàm `get_next_key()` xoay tua theo cơ chế Round-Robin, tự động nhảy qua các key đang cooldown và chỉ trả về key khả dụng.
  * Khi toàn bộ key trong pool đều bận hoặc gặp lỗi, hệ thống tự động kích hoạt **Fallback Pass** chuyển sang `GoogleTranslator` (deep-translator) để đảm bảo không có câu phụ đề nào bị bỏ sót.

### 5.3. An Toàn File Tạm Trong Quy Trình Render & Dịch Thuật
* **Quy trình kết xuất MP4:**
  * File tạm `.tmp_subtitles_*.ass` được tạo bằng `NamedTemporaryFile` và được dọn dẹp bảo đảm trong khối `finally` tại `server.py:961-966`.
  * File video render tạm `.tmp_render_*.mp4` áp dụng cơ chế Atomic Replace (`os.replace`) và tự dọn dẹp khi có lỗi tại `export.py:106-108`.
  * **Điểm rò rỉ duy nhất được phát hiện:** Tệp video tải về của Hồng Quả trong thư mục `src/subtitle_localizer/downloader/src/` (Đã nêu chi tiết tại Lỗi 5).

### 5.4. Rà Soát Xung Đột Phím Tắt Toàn Cục
* **Kết quả rà soát sự kiện bàn phím:**
  * Phím `Space` (Play/Pause) và phím `F` (Fullscreen) trong `VideoPlayer.tsx` đã có điều kiện chặn:
    ```typescript
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    ```
  * Cần bổ sung thêm điều kiện chặn đối với thẻ `<select>` và thuộc tính `isContentEditable` để ngăn kích hoạt nhầm khi người dùng tương tác với các dropdown cài đặt hoặc các ô chỉnh sửa rich-text.

---

## 6. BẢN ĐỒ LỘ TRÌNH KHẮC PHỤC (KHI CÓ YÊU CẦU SỬA)

Khi người dùng chính thức phê duyệt chuyển sang giai đoạn sửa lỗi, quy trình sửa sẽ được thực thi theo các bước nguyên tử (atomic commits) bảo toàn 100% test suite:

1. **Gói 1 [Render & Export Safety]:**
   * Sửa `mask.py`: Khống chế `chroma_radius` của `boxblur` hoặc chuyển sang `gblur=sigma=10:steps=2` an toàn tuyệt đối với mọi kích thước chiều cao ROI.
   * Sửa `export.py`, `probe.py`, `downloader.py`: Bổ sung `encoding="utf-8", errors="replace"` vào toàn bộ các lệnh `subprocess.run(..., text=True)`.
   * Sửa `server.py`: Mã hóa header tên file theo chuẩn RFC 5987 / RFC 6266 (`filename*=UTF-8''...`) cho các endpoint xuất `.srt` và `.ass`.
   * Mở rộng danh sách `mask_mode` được chấp nhận tại `_do_export_mp4` để đón nhận cả 9 kiểu che.
2. **Gói 2 [Storage & Disk Cleanup]:**
   * Bổ sung cơ chế dọn dẹp tự động tệp MP4 trong `downloader/src/` sau khi đã copy thành công vào thư mục `uploads/`.
   * Dọn sạch 81 file MP4 rác đang tích tụ trong `downloader/src/` để giải phóng dung lượng và đưa repository về trạng thái sạch theo `AGENTS.md`.
3. **Gói 3 [Batch Hub & Sidebar Synchronization]:**
   * Sửa `DashboardBatchHub.tsx`: Bỏ việc nuốt lỗi âm thầm trong các khối `catch {}`; ghi nhận đúng trạng thái `failed` khi export thất bại; truyền `mask_mode` theo đúng Preset Profile thay vì gán cứng `'blur'`.
   * Sửa `CapcutSidebar.tsx`: Truyền tham số lật video (`applyFlipToExport`, `isFlippedH`, `isFlippedV`) lên API xuất MP4; đồng bộ kiểu che mờ từ prop `maskStyle` thay vì cố định 3 kiểu.
4. **Gói 4 [Frontend Resilience & Polish]:**
   * Sửa `BottomTimeline.tsx`: Bổ sung timeout 1.5s cho Promise `onseeked` khi tạo thumbnail client-side để tránh treo vô hạn.
   * Sửa `GlobalActivityLogger.tsx`: Bọc callback thông báo vào `queueMicrotask()`.
   * Kích hoạt logic thay thế trong `DEFAULT_CHINESE_VIETNAMESE_GLOSSARY` tại `real.py`.
   * Dọn dẹp an toàn các file chết trong `web/src/components/editor/`.
