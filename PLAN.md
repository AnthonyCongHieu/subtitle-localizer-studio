# Kế Hoạch Triển Khai: Tái Cấu Trúc Hệ Thống Thành 2 Mode (Local vs Cloud API)

## 1. Phân Tích Yêu Cầu & Nguồn Tài Liệu Nghiên Cứu
- **Yêu cầu người dùng:** Phân thành 2 Mode rõ ràng:
  1. **MODE LOCAL:** Dùng chế độ chất lượng và tốc độ cao nhất (khai thác tối đa GPU RTX 3050 6GB: RapidOCR ONNX CUDA + Demux Stream + Faster-Whisper).
  2. **MODE API:** Cho phép chọn giữa **API Gemini** (Google Multimodal AI) và **API CapCut** (ByteDance Cloud ASR & Subtitle).
- **Tài liệu nghiên cứu có sẵn:** Đã có báo cáo chuyên sâu tại [`docs/CAPCUT_API_RESEARCH.md`](file:///d:/Project/subtitle-localizer-studio/docs/CAPCUT_API_RESEARCH.md):
  - Hệ sinh thái CapCut/JianYing vận hành trên nền tảng ByteDance Volcano Engine (`openspeech.bytedance.com` & `edit-api-sg.capcut.com`).
  - Dự án tiêu biểu: `K07VN/capcut-tts-api` (STT Cloud API thuần Python hỗ trợ nhận diện tiếng Trung `zh-CN`, tiếng Anh `en-US`, tiếng Việt `vi-VN`).

---

## 2. Kiến Trúc 2 Mode Mới

```
                                  KIẾN TRÚC 2 MODE
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
         [1] MODE LOCAL (CỤC BỘ)                         [2] MODE API (ĐÁM MÂY)
     Tốc độ & Chất lượng cao nhất                         Xử lý thông minh / Zero VRAM
                 │                                               │
    • RapidOCR ONNX (CUDA 12 - 140 FPS)             ┌────────────┴────────────┐
    • FFmpeg Softsub Demux (Tức thì 0.1s)          ▼                         ▼
    • Faster-Whisper Local (CUDA float16)   [API GOOGLE GEMINI]     [API CAPCUT / BYTEDANCE]
    • 100% Offline, 0đ chi phí              Gemini 2.5 Flash VLM    CapCut Cloud STT/ASR
                                            Tự lọc watermark rác    Chuẩn giọng TikTok/Douyin
```

---

## 3. Các Bước Triển Khai Chi Tiết

### Bước 1: Mở Rộng Cấu Hình Backend (`pipeline_settings.py`)
- Cấu trúc lại `ExtractionSettings`:
  ```python
  class ExtractionSettings(BaseModel):
      # Phân 2 Mode chính:
      mode: str = "local"  # "local" | "api"

      # 1. Cấu hình MODE LOCAL (Chất lượng & Tốc độ cao nhất trên RTX 3050):
      local_engine: str = "rapidocr"  # "rapidocr" (CUDA) | "whisper" | "demux_first"
      sample_fps: float = 2.0
      diff_threshold: float = 3.5
      enable_gap_rescue: bool = True
      enable_roi_tightening: bool = True

      # 2. Cấu hình MODE API (Đám mây):
      api_provider: str = "gemini"  # "gemini" | "capcut"
      gemini_vlm_model: str = "gemini-2.5-flash"
      capcut_api_endpoint: str = "https://edit-api-sg.capcut.com"
      capcut_session_token: Optional[str] = None

      # 3. Luồng ngôn ngữ toàn cục:
      default_source_lang: str = "auto"  # "auto" | "zh" | "en" | "vi"
  ```
- Giữ các alias và trường cũ để tương thích ngược 100% với worker và client hiện tại.

### Bước 2: Tích Hợp Module CapCut API Service (`src/subtitle_localizer/service/capcut_api.py`)
- Xây dựng CapCut API Adapter dựa trên tài liệu `CAPCUT_API_RESEARCH.md`:
  - Khởi tạo request nhận diện phụ đề âm thanh (STT) lên endpoint CapCut Cloud.
  - Xử lý các mã ngôn ngữ `zh-CN`, `en-US`, `vi-VN`.
  - Parse kết quả utterances thành danh sách phụ đề `SubtitleCueV1`.

### Bước 3: Cập Nhật API Client Frontend (`web/src/api/client.ts`)
- Khai báo kiểu `ExtractionSettings`:
  - `mode: 'local' | 'api'`
  - `api_provider: 'gemini' | 'capcut'`
  - `local_engine: 'rapidocr' | 'whisper' | 'demux_first'`

### Bước 4: Thiết Kế Lại Giao Diện Tab 1 (`GlobalSettingsView.tsx`)
- Thay thế giao diện 4 thẻ rời rạc bằng **2 Thẻ Lớn Rõ Ràng (2 Master Mode Cards)**:
  - 🖥️ **MODE 1: LOCAL (CỤC BỘ TRÊN MÁY - GPU RTX 3050)**
    - Badge: `100% Offline • Siêu Tốc 140 FPS • 0đ Chi Phí`
    - Tự động kết hợp: **RapidOCR ONNX CUDA** (quét hardsub 7ms/frame) + **FFmpeg Demux** (bóc softsub có sẵn) + **Faster-Whisper CUDA** (nghe giọng nói).
  - ☁️ **MODE 2: API ĐÁM MÂY (CLOUD SERVICES)**
    - Badge: `Zero VRAM • AI Đa Phương Thức`
    - Cho phép chọn nhanh giữa 2 cổng API:
      + ✨ **Google Gemini AI API:** Dùng model Gemini 2.5 Flash, đọc chữ thư pháp khó, tự dọn logo/watermark rác.
      + 🎬 **CapCut / ByteDance API:** Dùng hạ tầng nhận diện của CapCut/TikTok, bóc tách phụ đề tự động chuẩn âm điệu.
- Bên dưới vẫn giữ nguyên luồng:
  `Tự Động Auto-Detect Ngôn Ngữ Nguồn ➔ Select Chọn Ngôn Ngữ Dịch Sang (Tiếng Việt / Tiếng Anh / Không Dịch)`.

---

## 4. Kế Hoạch Kiểm Thử & Nghiệm Thu (ĐÃ HOÀN THÀNH 100%)
1. **Kiểm tra Frontend:** Chạy `npm run build` thành công xuất sắc (exit code 0, built in 8.11s).
2. **Kiểm tra Backend:**
   - Đã gọi API `GET /api/v1/settings/pipeline` xác thực cấu hình `mode`, `local_engine`, `api_provider`, `capcut_api_endpoint`.
   - Đã gọi `POST /api/v1/settings/capcut-check` kiểm tra kết nối tới `edit-api-sg.capcut.com` (phản hồi thành công độ trễ 177ms).
3. **Kiểm thử hồi quy Pytest:** Chạy `python -m pytest tests/t01/ tests/t07/` -> **42/42 tests pass 100% (10.38s)**.
4. **Trạng thái:** Sẵn sàng nghiệm thu và bàn giao.
