# BÁO CÁO NGHIÊN CỨU TOÀN DIỆN: HỆ SINH THÁI MÃ NGUỒN MỞ XỬ LÝ PHỤ ĐỀ VIDEO & KIẾN TRÚC STUDIO

**Mục tiêu:** Phân tích chuyên sâu các dự án mã nguồn mở tiêu biểu trên GitHub, đánh giá ưu/nhược điểm và rút ra bài học kiến trúc áp dụng trực tiếp cho dự án **Subtitle Localizer Studio** (mục tiêu chạy mượt mà trên phần cứng Windows, GPU 6GB RTX 3050 Laptop, giao diện React hiện đại phong cách CapCut).

---

## 1. VIDEO SUBTITLE EXTRACTION (OCR PHỤ ĐỀ VIDEO CỨNG / HARDSUB)

### 1.1. YaoFANGUK/video-subtitle-extractor (VSE)
- **Link GitHub:** [YaoFANGUK/video-subtitle-extractor](https://github.com/YaoFANGUK/video-subtitle-extractor) (Tác giả: YaoFANGUK / Yillik - ~7k stars)
- **Kiến trúc & Tech Stack:**
  - Ngôn ngữ: Python.
  - GUI: PyQt5 / PySide2.
  - OCR Engine: PaddleOCR (PP-OCRv2/v3/v4), RapidOCR.
  - Thị giác máy tính: OpenCV, NumPy.
- **Cơ chế hoạt động cốt lõi:**
  - **Phát hiện phụ đề dựa trên biến thiên khung hình (Frame Differencing):** Chữ phụ đề có tính chất đứng yên (static) qua một chuỗi khung hình liên tiếp so với hậu cảnh biến đổi. VSE tính toán độ sai khác pixel và histogram trong vùng ROI giữa các frame.
  - **3 chế độ trích xuất:**
    - *Fast Mode:* Bỏ qua khung hình cố định (stride sampling N frames/lần), dùng model mobile nhẹ.
    - *Auto Mode:* Giám sát ngưỡng sai khác trong ROI để đánh dấu thời điểm phụ đề xuất hiện (start time) và biến mất (end time), sau đó chỉ chạy OCR trên frame đại diện ở giữa.
    - *Precise Mode:* Quét từng frame đơn lẻ (chậm nhưng bắt được các câu hiển thị cực ngắn).
  - **Bộ lọc vùng trừ (Watermark Exclusion):** Cho phép đặt các ô ROI phụ để thuật toán bỏ qua logo nhà đài hoặc watermark chuyển động.
  - **Từ điển sửa lỗi (Typo Dictionary):** Bảng ánh xạ regex/từ vựng để tự động thay thế các từ nhận diện sai phổ biến.
- **Điểm mạnh nổi bật:**
  - Phổ biến hàng đầu trong cộng đồng xử lý phim truyền hình và video ngắn (Douyin/TikTok).
  - Hỗ trợ 87+ ngôn ngữ với model PP-OCR được tiền huấn luyện rất tốt cho tiếng Trung, Anh, Nhật, Hàn.
  - Tốc độ tách ở chế độ Auto tương đối nhanh nhờ chỉ OCR các frame ứng viên.
- **Điểm yếu & Hạn chế:**
  - **Bản quyền GPL-3.0:** Không thể copy hoặc liên kết trực tiếp vào mã nguồn đóng/thương mại (vi phạm nguyên tắc bản quyền của Subtitle Localizer Studio).
  - **Tính thời gian dựa trên `frame_index / FPS` cố định:** Hoàn toàn sai lệch và gây desync phụ đề nghiêm trọng đối với video tốc độ khung hình biến thiên (Variable Frame Rate - VFR) hoặc video bị rụng khung hình (dropped frames).
  - **Rò rỉ bộ nhớ (Memory Leak):** Khi xử lý video dài trên 1 giờ, việc tích trữ các buffer ảnh trong RAM làm ứng dụng dễ crash.
  - **Lỗi nhận diện khi lia máy (Camera Panning):** Khi khung hình chuyển động quá nhanh, thuật toán frame difference tưởng lầm hậu cảnh là phụ đề mới.
- **Bài học cho Subtitle Localizer Studio:**
  - Tuyệt đối không tính thời gian bằng `frame / fps`. Bắt buộc đọc thời gian trình chiếu thực tế (**Presentation Timestamp - PTS**) từ luồng demux của FFmpeg/PyAV.
  - Viết lại clean-room thuật toán Auto-stride và ROI Edge Difference bằng OpenCV/NumPy dưới bản quyền MIT/Apache.
  - Tích hợp tính năng loại trừ Watermark và bảng Typo Map vào backend pipeline.

---

### 1.2. SWHL/RapidVideOCR & timminator/VideOCR & apm1467/videocr
- **Links GitHub:**
  - [SWHL/RapidVideOCR](https://github.com/SWHL/RapidVideOCR) (Tác giả: RapidAI / SWHL - ~1.2k stars)
  - [timminator/VideOCR](https://github.com/timminator/VideOCR) (Tác giả: timminator - ~800 stars)
  - [apm1467/videocr](https://github.com/apm1467/videocr) (Tác giả: apm1467)
- **Kiến trúc & Tech Stack:**
  - RapidVideOCR: Python, ONNX Runtime, RapidOCR (mô hình PaddleOCR được chuyển đổi sang ONNX).
  - VideOCR: Python, PaddleOCR, Google Lens API (hybrid cloud fallback), Docker container.
  - videocr: Python, Tesseract OCR, OpenCV.
- **Điểm mạnh nổi bật:**
  - **RapidVideOCR siêu nhẹ & tối ưu hiệu năng:** Bằng việc chạy mô hình OCR qua **ONNX Runtime**, nó loại bỏ hoàn toàn sự phụ thuộc vào framework khổng lồ PaddlePaddle (tiết kiệm hàng gigabyte bộ nhớ cài đặt và tối ưu hóa suy luận CPU/DirectML/CUDA).
  - **timminator/VideOCR cung cấp cơ chế cứu hộ (Rescue Pass):** Tích hợp Google Lens cho các đoạn chữ viết nghệ thuật, phông chữ uốn lượn mà OCR local đọc sai. Đóng gói Docker hoàn chỉnh.
  - Giấy phép thông thoáng (Apache-2.0 / MIT).
- **Điểm yếu:**
  - `apm1467/videocr` dựa vào Tesseract nên tốc độ rất chậm, nhận diện tiếng Đông Á (Trung, Nhật, Hàn, Việt) rất kém nếu không huấn luyện lại.
  - RapidVideOCR không tự tách frame mà phụ thuộc vào việc phải chạy VideoSubFinder trước đó.
  - Google Lens API phụ thuộc mạng, có nguy cơ bị chặn IP (Cloudflare/Bot detection) và rò rỉ dữ liệu video cá nhân.
- **Bài học cho Subtitle Localizer Studio:**
  - **Sử dụng ONNX Runtime làm runtime mặc định cho OCR:** Giúp bộ cài đặt Windows nhẹ hơn, khởi động tức thì, và chỉ tiêu tốn ~300-500MB VRAM so với mức >2GB của toàn bộ runtime PyTorch/PaddlePaddle. Phù hợp hoàn hảo với ngân sách 6GB VRAM trên máy tính cá nhân.
  - Kiến trúc hóa tầng OCR thành 2 mức: Mức 1 chạy mô hình ONNX cực nhanh (PP-OCRv4/v5 ONNX); Mức 2 (Rescue Pass) dùng PaddleOCR-VL hoặc VLM nhỏ khi độ tin cậy (confidence) của Mức 1 dưới 70%.

---

### 1.3. Subtitle Edit (Desktop Core Engine)
- **Link GitHub:** [SubtitleEdit/subtitleedit](https://github.com/SubtitleEdit/subtitleedit) (Tác giả: Nikolaj Olsson - ~15k stars)
- **Kiến trúc & Tech Stack:**
  - C#, .NET 8 / .NET Framework, Windows Forms, MPV Player, FFmpeg, Tesseract, Whisper.cpp.
- **Cơ chế Hardsub OCR:**
  - Chụp ảnh frame qua FFmpeg/DirectShow.
  - Binarization & Color Keying: Người dùng chọn màu chữ (ví dụ: chữ vàng viền đen) để thuật toán nhị phân hóa, loại bỏ hoàn toàn nền video phức tạp trước khi đưa vào Tesseract hoặc bộ so khớp pixel nhị phân (nOCR).
  - **Rule-based Fix Engine:** Kho biểu thức chính quy (Regex) đồ sộ tích lũy qua hơn 10 năm để sửa lỗi OCR đặc trưng: nhầm `l` (chữ L thường) với `I` (chữ i hoa) hoặc số `1`, nhầm số `0` với chữ `O`, lỗi dính chữ, dấu phẩy biến thành dấu chấm, v.v.
- **Điểm mạnh nổi bật:**
  - Hệ thống kiểm tra chất lượng phụ đề đỉnh cao: Cảnh báo câu hiển thị quá ngắn (<800ms), câu quá dài (>5s), tốc độ đọc vượt ngưỡng (Characters Per Second - CPS > 20), số ký tự trên dòng vượt quá 40.
  - Khả năng tạo dạng sóng âm thanh (Audio Waveform Peaks) siêu nhanh qua FFmpeg mà không cần load cả file audio vào RAM.
- **Điểm yếu:**
  - Kiến trúc desktop nguyên khối (WinForms), không phù hợp cho nền tảng web hiện đại.
  - OCR hardsub phụ thuộc nhiều vào việc người dùng phải chỉnh tay ngưỡng nhị phân (threshold) nếu phụ đề đổi màu.
- **Bài học cho Subtitle Localizer Studio:**
  - Kế thừa trọn vẹn bộ quy tắc làm sạch dữ liệu (**Subtitle Sanitizer**): Sửa lỗi ký tự tương đồng, chuẩn hóa dấu tiếng Việt Unicode dựng sẵn (NFC), xóa ký tự rác.
  - Đưa bộ chỉ số CPS, CPL (Characters Per Line) và cảnh báo chồng lấn thời gian (Overlap Warnings) vào UI review của Studio.

---

### 1.4. VideoSubFinder (VSF)
- **Link:** SourceForge & Mirror [SWHL/VideoSubFinder](https://github.com/SWHL/VideoSubFinder) (Tác giả: sucledu)
- **Kiến trúc & Tech Stack:** C++, OpenCV, Intel IPP, CUDA, DirectShow.
- **Đặc điểm:**
  - Không làm nhiệm vụ OCR nhận diện văn bản.
  - Chuyên môn hóa 100% vào việc phát hiện và tách xuất ảnh chứa phụ đề (tạo ra thư mục ảnh `ClearRGB` và `ClearText` cùng file text đánh dấu thời gian bắt đầu/kết thúc).
  - Tốc độ cực nhanh nhờ tối ưu hóa bằng C++ thuần và xử lý song song trên GPU.
- **Bài học cho Studio:** Cung cấp một Adapter tùy chọn cho người dùng muốn tận dụng binary của VideoSubFinder ngoài hệ thống, đồng thời duy trì bộ trích xuất native chạy ngầm trong Python để đảm bảo phần mềm hoạt động "out-of-the-box" không cần cài thêm công cụ ngoài.

---

## 2. VIDEO SUBTITLE REMOVAL & INPAINTING (XÓA PHỤ ĐỀ CỨNG, CHE MỜ, LÀM MỊN)

| Dự án / Mô hình | Kiến trúc cốt lõi | VRAM yêu cầu | Tốc độ (FPS) | Chất lượng phục hồi | Bản quyền |
|---|---|---|---|---|---|
| **ProPainter** (ICCV 2023) | Dual-Domain Propagation + Sparse Spatiotemporal Transformer + Flow Completion | >8GB (1080p full) | 1 - 4 FPS | **Xuất sắc nhất (SOTA)**, không nhấp nháy | CC-BY-NC-SA 4.0 (Phi thương mại) |
| **LaMa** (WACV 2022) | Fast Fourier Convolutions (FFC) Image Inpainting | ~1.5 - 2GB (GPU/CPU) | 30 - 60 FPS | Tốt cho nền phẳng, có thể flicker nếu áp dụng frame-by-frame | Apache-2.0 |
| **E2FGVI** (CVPR 2022) | End-to-End Flow-Guided Video Inpainting | ~4 - 6GB | 8 - 15 FPS | Khá tốt, mượt mà thời gian | Apache-2.0 |
| **STTN** (ECCV 2020) | Spatial-Temporal Transformer Network | ~4GB | 10 - 20 FPS | Trung bình khá (hơi mờ ở vùng động) | Apache-2.0 |
| **FFmpeg Box/Blur** | Delogo / Boxblur / Drawbox Filters | 0MB VRAM (CPU) | >120 FPS | Làm mờ hoặc tạo thanh màu che | LGPL / GPL |

### 2.1. Phân tích chi tiết ProPainter
- **Link GitHub:** [sczhou/ProPainter](https://github.com/sczhou/ProPainter) (Tác giả: Shangchen Zhou - NTU S-Lab)
- **Kiến trúc:**
  - Mạng hoàn thiện dòng quang học (Flow Completion Network) phục hồi chuyển động của các điểm ảnh bị chữ che khuất.
  - Cơ chế lan truyền kép (Dual-Domain Propagation): Vừa "vá" điểm ảnh từ các khung hình trước/sau theo vector chuyển động, vừa lan truyền ở tầng đặc trưng ẩn (feature map).
  - Mask-Guided Sparse Transformer: Chỉ tính toán self-attention cho các token nằm trong vùng mặt nạ bị che, tiết kiệm tài nguyên so với Transformer truyền thống.
- **Ưu & Nhược:** Chất lượng xóa phụ đề đẹp nhất hiện nay, không để lại vết mờ hay hiện tượng bóng ma (ghosting). Tuy nhiên, ăn rất nhiều VRAM và tốc độ render chậm.
- **Giải pháp áp dụng cho Subtitle Localizer Studio (GPU 6GB):**
  - **Kỹ thuật Spatial Cropping:** Không bao giờ đưa nguyên khung hình 1080p vào ProPainter. Chỉ cắt đúng dải phụ đề (Bounding Box ROI, ví dụ: 1920x150), đưa dải ảnh nhỏ này vào ProPainter để inpaint, sau đó dán đè (alpha blending) trở lại video gốc.
  - **Kỹ thuật Temporal Chunking:** Chia video thành các đoạn ngắn 20-30 frames với độ gối đầu (overlap) 5 frames để khử đường biên chuyển tiếp, giải phóng VRAM liên tục giữa các chunk.

### 2.2. Phân tích LaMa (Large Mask Inpainting) & IOPaint
- **Link GitHub:** [advimman/lama](https://github.com/advimman/lama) & [Sanster/IOPaint](https://github.com/Sanster/IOPaint)
- **Kiến trúc:** Sử dụng Fast Fourier Convolutions (FFC) giúp mô hình có trường nhìn toàn cục (global receptive field) ngay từ tầng đầu tiên. Cực kỳ hiệu quả trong việc xóa các khối hình chữ nhật lớn và thay thế bằng hoa văn nền tương đồng.
- **Ưu & Nhược:** Tốc độ suy luận siêu tốc (chỉ ~20ms trên GPU, chạy tốt trên CPU với ONNX Runtime), bản quyền Apache-2.0 sạch. Điểm yếu là mô hình xử lý 2D tĩnh; nếu inpaint video frame-by-frame mà hậu cảnh có chuyển động phức tạp, vùng inpaint sẽ bị nhấp nháy nhẹ (temporal inconsistency).
- **Giải pháp cho Studio:**
  - Cung cấp chế độ **"Fast AI Inpaint"** sử dụng LaMa ONNX.
  - Để khắc phục hiện tượng nhấp nháy: Áp dụng bộ lọc làm mịn thời gian đơn giản (Temporal Exponential Moving Average giữa các frame kế tiếp trong vùng tĩnh) hoặc chỉ kích hoạt inpaint ở các frame có chữ xuất hiện theo dữ liệu mốc thời gian của phụ đề đã nhận diện.

### 2.3. Khuyến nghị phân tầng Inpainting cho Subtitle Localizer Studio
Thiết lập 3 cấp độ trong cài đặt Export của Studio:
1. **Tier 1 - Standard (Mặc định, Tức thì, 0% VRAM):** Dùng FFmpeg filter `boxblur` làm mờ cục bộ vùng phụ đề, hoặc phủ một dải đen mờ (semi-transparent band) thời thượng phong cách phim điện ảnh.
2. **Tier 2 - Balanced AI (Nhanh, Nhẹ):** LaMa ONNX kết hợp OpenCV Dilation mask (mở rộng viền 3-5px để xóa sạch bóng đổ của chữ) và Temporal Smoothing.
3. **Tier 3 - Pro SOTA (Chất lượng cao nhất):** ProPainter / E2FGVI chạy với ROI Cropping và Temporal Chunking (thông báo người dùng thời gian xuất sẽ lâu hơn).

---

## 3. SUBTITLE TRANSLATION & AI PIPELINE (LLM, WHISPERX, BATCH PROCESSING)

### 3.1. pyVideoTrans (Quy trình dịch video đa bước)
- **Link GitHub:** [jianchang512/pyvideotrans](https://github.com/jianchang512/pyvideotrans) (Tác giả: jianchang512 - ~15k stars)
- **Kiến trúc:** Xây dựng một đường ống (pipeline) hoàn chỉnh gồm: Tách âm thanh -> Faster-Whisper ASR -> Phân cụm câu -> Gọi API dịch (hỗ trợ OpenAI, Gemini, Claude, DeepSeek, Ollama local) -> Edge-TTS / Clone Voice -> Trộn âm và ghép video.
- **Kinh nghiệm xử lý Batching:**
  - Gom các câu phụ đề thành từng nhóm (batch 20-40 câu).
  - Xử lý lỗi Rate Limit (HTTP 429) bằng hàng đợi retry có thời gian chờ tăng dần (exponential backoff).
- **Vấn đề tồn tại:** Thường xuyên gặp lỗi **"Lệch số lượng câu"**: Khi gửi 30 câu sang LLM, do tính chất sinh từ tự do, LLM có thể tự động gộp 2 câu ngắn thành 1 hoặc tách 1 câu dài thành 2, khiến kết quả trả về chỉ có 28 hoặc 29 câu, làm vỡ toàn bộ cấu trúc thời gian của file SRT.

### 3.2. WhisperX (Đỉnh cao của căn chỉnh thời gian âm thanh)
- **Link GitHub:** [m-bain/whisperX](https://github.com/m-bain/whisperX) (Tác giả: Max Bain - Oxford University)
- **Kiến trúc 4 giai đoạn độc đáo:**
  1. **VAD (Voice Activity Detection) bằng Pyannote:** Cắt audio thành các phân đoạn giọng nói chuẩn xác, loại bỏ hoàn toàn đoạn nhạc nền hoặc khoảng lặng (triệt tiêu 100% hiện tượng ảo giác lặp từ của Whisper).
  2. **Faster-Whisper (CTranslate2):** Nhận diện nội dung với tốc độ gấp 4-8 lần Whisper gốc.
  3. **Forced Phoneme Alignment (Wav2Vec2):** Khớp các âm vị ký tự trực tiếp với phổ âm thanh (spectrogram), tạo ra mốc thời gian chi tiết đến **từng từ (word-level timestamps)** với sai số dưới 50ms.
  4. **Speaker Diarization:** Phân tách giọng nói theo từng người nói (Speaker ID).
- **Ứng dụng cho Subtitle Localizer Studio:**
  - Khi người dùng muốn tinh chỉnh mốc thời gian của phụ đề OCR khớp với tiếng nói trong video, WhisperX Forced Alignment là công cụ số 1 thế giới để tự động "bắt dính" (snap) ranh giới phụ đề vào đúng lúc nhân vật bắt đầu mở miệng và kết thúc câu nói.

### 3.3. Kỹ thuật Dịch Phụ Đề bằng LLM trong Môi Trường Sản Xuất
Để bản dịch tự nhiên sang tiếng Việt và không bao giờ bị lệch mốc thời gian, kiến trúc AI Pipeline cần tuân thủ 4 nguyên tắc kỹ thuật sau:

#### A. Kỹ thuật Cửa sổ trượt có ngữ cảnh (Context-Aware Sliding Window)
Không dịch đơn lẻ từng câu. Gửi một mẻ 20-30 câu cần dịch, nhưng đính kèm thêm 3 câu trước đó và 2 câu phía sau dưới dạng `<context>` (chỉ để LLM đọc hiểu diễn biến hội thoại, quan hệ nhân vật để chọn đại từ xưng hô tiếng Việt phù hợp như anh/em, chú/cháu, không dịch phần context này).

#### B. Ép cấu trúc đầu ra tuyệt đối (Strict Structured JSON Schema)
Thay vì để LLM trả về text tự do rồi dùng regex bóc tách (dễ lỗi), sử dụng tính năng **Structured Output / JSON Schema**.
- Với Google Gemini API: Sử dụng tham số `response_schema` để ép trả về schema:
  ```json
  {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "id": {"type": "integer"},
        "target": {"type": "string"}
      },
      "required": ["id", "target"]
    }
  }
  ```
  Điều này loại bỏ hoàn toàn nguy cơ mất câu hoặc lệch ID.

#### C. Prompt Engineering chuyên sâu cho Subtitle Formatting
- Quy định độ dài tối đa để mắt người đọc kịp: Tối đa 2 dòng, mỗi dòng không quá 38-42 ký tự tiếng Việt.
- Giữ nguyên các thẻ định dạng phụ đề nếu có: `<i>...</i>`, `{\an8}`, ngắt dòng `\N`.
- Quy chuẩn hóa cách dịch danh từ riêng, thuật ngữ nhất quán xuyên suốt toàn bộ video.

#### D. Chiến lược phân bổ mô hình (Cloud vs Local trên 6GB VRAM):
- **Ưu tiên Cloud API:** Gemini 1.5 Flash / 2.0 Flash là lựa chọn số 1: Tốc độ dịch hàng trăm dòng chỉ trong vài giây, ngữ cảnh cực lớn, chi phí siêu rẻ (hoặc miễn phí theo hạn mức), chất lượng dịch Trung/Nhật/Hàn/Anh sang tiếng Việt mượt mà hàng đầu.
- **Phương án Offline (Bảo mật/Không mạng):**
  - Sử dụng **TranslateGemma 4B** hoặc **MADLAD-400 3B** lượng tử hóa GGUF (4-bit/Q4_K_M) chạy qua `llama.cpp` wrapper: Chỉ chiếm ~2.5 - 3.2 GB VRAM, dịch song ngữ cực tốt.
  - Sử dụng **NLLB-200 distilled 600M** chạy qua CTranslate2: Chỉ chiếm ~1.2 GB VRAM, cực nhẹ cho máy cấu hình yếu.

---

## 4. WEB-BASED VIDEO & SUBTITLE EDITOR UI (KIẾN TRÚC GIAO DIỆN TIMELINE & CANVAS)

### 4.1. Kiến trúc Timeline Đa Tầng Hiệu Năng Cao (Multi-track Timeline)
Nghiên cứu từ các dự án web video editor hàng đầu (`xzdarcy/react-timeline-editor`, `remotion`, `Twick`, `FreeCut`):

```
+---------------------------------------------------------------------------------------------------+
| TIME RULER (Thước đo thời gian: 00:00:10, 00:00:20... + Tỉ lệ Zoom)                               |
+---------------------------------------------------------------------------------------------------+
| AUDIO WAVEFORM TRACK (Canvas hiển thị sóng âm thanh dựa trên Pre-computed Peaks)                  |
+---------------------------------------------------------------------------------------------------+
| VIDEO FILMSTRIP TRACK (Dải ảnh thumbnail tạo từ WebP Sprite Sheet)                                |
+---------------------------------------------------------------------------------------------------+
| SUBTITLE CUE TRACK (Các block phụ đề tương tác: kéo dãn 2 đầu, di chuyển, snap mốc thời gian)     |
+---------------------------------------------------------------------------------------------------+
| SCRUBBER / PLAYHEAD (Kim tua thời gian đồng bộ vòng lặp requestAnimationFrame với Video Player)   |
+---------------------------------------------------------------------------------------------------+
```

#### A. Xử lý Sóng Âm Thanh (Audio Waveform) không làm đơ trình duyệt:
- **Sai lầm phổ biến:** Dùng Web Audio API `AudioContext.decodeAudioData` để giải mã file âm thanh 1 tiếng trực tiếp trong trình duyệt -> ngốn >1.5GB RAM và làm treo tab trình duyệt.
- **Chuẩn công nghiệp:** Backend FFmpeg tạo trước file dữ liệu đỉnh âm thanh (**Peaks Data** dạng JSON hoặc mảng nhị phân Int8/Int16 chỉ nặng ~500KB cho 1 giờ audio).
- Frontend React sử dụng HTML5 Canvas để vẽ sóng âm. Áp dụng kỹ thuật **Virtualization**: Chỉ vẽ các điểm sóng âm nằm trong khung nhìn (Viewport) hiện tại dựa trên hệ số zoom. Khi người dùng cuộn (scroll) hoặc zoom, chỉ cần `requestAnimationFrame` vẽ lại vùng nhìn thấy.

#### B. Xử lý Dải Ảnh Thu Nhỏ (Filmstrip Thumbnails):
- Backend FFmpeg xuất ảnh dạng **Sprite Sheet (Tiled WebP Image)**: 1 file ảnh duy nhất chứa lưới 10x10 (100 frame thumbnail nhỏ).
- Frontend vẽ từng frame lên Timeline Canvas bằng lệnh `ctx.drawImage(spriteSheet, sx, sy, sW, sH, dx, dy, dW, dH)`. Cách này giúp timeline hiển thị hàng trăm ảnh thumbnail mượt mà mà không tạo ra hàng trăm thẻ `<img>` trong DOM.

#### C. Đồng bộ Scrubber (Kim tua):
- Không dùng sự kiện `timeupdate` của thẻ `<video>` HTML5 (vì sự kiện này chỉ kích hoạt 4-15 lần/giây gây hiện tượng giật cục).
- Sử dụng vòng lặp `requestAnimationFrame(renderLoop)` để đọc `video.currentTime` liên tục 60 FPS, đảm bảo kim tua và vệt sóng âm di chuyển mượt mà tuyệt đối.

---

### 4.2. Kiến trúc Bounding Box ROI Overlay (Khung quét chữ tương tác)
- **Thách thức:** Khung hiển thị video trên giao diện web thường dùng `object-fit: contain` để thích ứng với kích thước màn hình. Kích thước hiển thị trên trình duyệt (CSS rendered pixels) khác biệt hoàn toàn với độ phân giải gốc của video (Native pixels, ví dụ 1080x1920 hoặc 1920x1080).
- **Giải pháp: Hệ tọa độ chuẩn hóa (Normalized 0.0 – 1.0):**
  - Mọi tọa độ ROI được lưu dưới dạng tỉ lệ phần trăm từ 0.0 đến 1.0:
    $$\text{norm\_x} = \frac{x}{W_{\text{video}}}, \quad \text{norm\_y} = \frac{y}{H_{\text{video}}}, \quad \text{norm\_w} = \frac{w}{W_{\text{video}}}, \quad \text{norm\_h} = \frac{h}{H_{\text{video}}}$$
  - Trên giao diện React: Dùng `ResizeObserver` theo dõi kích thước thực của vùng video, tính toán độ lệch viền đen (Letterbox/Pillarbox padding) để đặt khung ROI chính xác từng pixel:
    $$\text{display\_x} = \text{pad\_left} + (\text{norm\_x} \times \text{rendered\_width})$$
  - Khi gửi về backend Python: Chuyển đổi ngược về kích thước pixel gốc của video để cắt ảnh (crop) chính xác 100%.

---

### 4.3. Hiển thị Phụ Đề Chuẩn WYSIWYG trên Web với JASSUB (libass WebAssembly)
- **Vấn đề:** CSS thông thường không thể mô phỏng chính xác các tính chất phức tạp của phụ đề `.ass` (viền stroke nhiều lớp, bóng đổ theo góc, căn lề `\an8`, phông chữ đặc thù, hiệu ứng karaoke). Dẫn đến việc khi xem trên web một kiểu nhưng khi FFmpeg render video xuất ra lại ra một kiểu khác.
- **Dự án giải pháp:** [ThaUnknown/jassub](https://github.com/ThaUnknown/jassub) (bản nâng cấp hiện đại của `JavascriptSubtitlesOctopus`).
  - Biên dịch trực tiếp thư viện C `libass` sang **WebAssembly (WASM)** với khả năng tăng tốc phần cứng WebGL.
  - Nhúng trực tiếp vào thẻ `<video>` trên React. Render từng khung hình phụ đề chính xác đến từng điểm ảnh theo đúng chuẩn `libass`.
  - **Kết quả:** Những gì người dùng nhìn thấy trong trình duyệt lúc biên tập là **100% giống hệt (Pixel-Perfect WYSIWYG)** với video MP4 cuối cùng được xuất ra từ FFmpeg!

---

## 5. TỔNG HỢP BÀI HỌC VÀ ĐỀ XUẤT ÁP DỤNG TRỰC TIẾP CHO SUBTITLE LOCALIZER STUDIO

### 5.1. Bảng Đề Xuất Công Nghệ & Tích Hợp Cho Dự Án

| Thành phần Studio | Công nghệ lựa chọn đề xuất | Lý do & Giá trị mang lại |
|---|---|---|
| **OCR Runtime** | **RapidOCR (ONNX Runtime)** + cứu hộ PP-OCR-VL | Tiết kiệm VRAM (chỉ tốn ~300MB), không cần cài đặt PaddlePaddle, khởi động tức thì trên Windows. |
| **Đo mốc thời gian** | **FFmpeg Demuxer (Real PTS)** | Loại bỏ hoàn toàn lỗi lệch phụ đề do Variable Frame Rate (VFR) của Video-Subtitle-Extractor. |
| **Lọc vùng quét** | **OpenCV Edge Differencing + Typo Map** | Học tập cơ chế Auto-stride và từ điển sửa lỗi của VSE nhưng triển khai clean-room bản quyền MIT. |
| **Inpainting Xóa Chữ** | **LaMa ONNX (Fast) + ProPainter ROI Chunk (SOTA)** | LaMa cho tốc độ xuất nhanh; ProPainter cho chất lượng cao nhất khi người dùng yêu cầu, chỉ chạy trong vùng crop ROI để không vượt quá 6GB VRAM. |
| **AI Translation** | **Gemini API (Cloud) + TranslateGemma/MADLAD (Local)** | Ép kiểu `response_schema` JSON tuyệt đối để không bao giờ bị lệch mốc thời gian phụ đề; hỗ trợ dịch tiếng Việt tự nhiên có ngữ cảnh. |
| **Audio Waveform** | **FFmpeg Pre-computed Peaks Data** | Tạo file cache sóng âm siêu nhẹ, render Canvas mượt mà, không gây tràn bộ nhớ trình duyệt. |
| **Timeline Editor** | **React + Virtualized Canvas + CSS Track** | Thao tác kéo thả block phụ đề trực quan, kim tua 60 FPS đồng bộ requestAnimationFrame. |
| **Subtitle Preview** | **JASSUB (libass WASM / WebGL)** | Đảm bảo tính nhất quán hiển thị tuyệt đối giữa Web Player và bản xuất FFmpeg libass. |

### 5.2. Chiến Lược Quản Lý Tài Nguyên Phần Cứng (Budgeting 6GB VRAM trên RTX 3050 Laptop)
Để phần mềm không bao giờ bị dính lỗi `CUDA Out of Memory (OOM)`:
1. **Quy tắc thực thi tuần tự (Single GPU Stage):**
   Tại một thời điểm chỉ có một tác vụ AI nặng được giữ quyền trên GPU.
   - Khi bước quét phụ đề (OCR) kết thúc: Giải phóng bộ nhớ ONNX/CUDA Provider (`torch.cuda.empty_cache()` / giải phóng runtime).
   - Khi bước dịch thuật (Translation) chạy mô hình local: Nạp mô hình dịch vào VRAM; dịch xong -> Giải phóng mô hình dịch.
   - Khi bước xóa chữ (Inpainting) chạy: Nạp mô hình inpaint vào VRAM; inpaint xong -> Giải phóng.
2. **Cô lập tiến trình (Process Isolation):**
   Tách biệt hoàn toàn tiến trình API (FastAPI) và tiến trình tính toán nền (Background Worker Process). Nếu worker xử lý video bị lỗi hoặc quá tải bộ nhớ, tiến trình API và giao diện React của người dùng vẫn hoạt động bình thường, không bao giờ bị sập ứng dụng.
