# Kế Hoạch Triển Khai: Ticket T23 — Tách Cụm % & Chi Tiết Tiến Trình Xuống Cạnh Dòng Thời Gian (Relocate Live Task Progress & Fix Header UI Cramping)

## 1. Bối Cảnh & Vấn Đề Xác Minh (Evidence-Based)
Dựa trên hình ảnh phản ánh của người dùng (`media_1788854127824.png` và `media_1788854146730.png`) cùng yêu cầu:
> *"fix lỗi UI"*
> *"cho cái % và chi tiết từng cái chung ra cái kế chỗ dòng thời gian kia được mà"*

1. **Header bị co ép & Nút bấm vỡ thành 3 dòng thẳng đứng**:
   - Khối tiến trình quét (`Đang quét OCR: 23% (28/420 frames)...`) cùng nút `[■ Dừng]` nhồi nhét trực tiếp bên trong nhóm nút Header, chiếm hơn 260px và làm co cụm các nút `2. Dịch AI`, `3. Đọc Lại [Xong]` thành 3 dòng chữ đứng, đẩy nút `[ ⬇ Xuất Video ]` văng khỏi màn hình.
2. **Thanh công cụ đỉnh Trình phát Video (VideoPlayer) bị cắt lẹm**:
   - Ở màn hình hẹp, cụm công cụ `[ Vùng ROI | Kéo Video ]` bị ép sát mép trái hoặc mất góc do thiếu thuộc tính co giãn hợp lý.

---

## 2. Giải Pháp Kỹ Thuật Đã Triển Khai (Implemented Scope)

### 2.1. Đưa Cụm Tiến Trình % & Nút Dừng Xuống Kế Dòng Thời Gian (Timeline)
- Tệp: [`web/src/components/timeline/BottomTimeline.tsx`](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/components/timeline/BottomTimeline.tsx)
  - Nhập `Loader2, Square` từ `lucide-react`.
  - Mở rộng `BottomTimelineProps` với: `isScanning?: boolean`, `statusMessage?: string | null`, `onStopScan?: () => void`, `isTranslating?: boolean`, `isDubbing?: boolean`.
  - Đặt khối pill tiến trình thời gian thực `data-testid="timeline-progress-pill"` trên thanh công cụ timeline ngay sau nút Hút Dính (Magnet Snap) và bộ đếm timecode: hiển thị spinner chuyển động `Loader2`, chuỗi trạng thái chi tiết kèm %, số frames, và nút `[■ Dừng]` màu đỏ khi đang quét.

### 2.2. Giải Phóng Header & Chuẩn Hóa Chống Co Ép Nút Bấm
- Tệp: [`web/src/components/layout/StudioHeader.tsx`](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/components/layout/StudioHeader.tsx)
  - Loại bỏ giới hạn cứng `max-w-[calc(50%-140px)]` ở cụm hành động bên phải.
  - Thay thế khối text tiến trình quét cồng kềnh trong Nút 1 bằng nút bấm chuẩn gọn gàng `1. Đang Quét...` có spinner và hiệu ứng nhấp để dừng.
  - Áp dụng `whitespace-nowrap shrink-0 px-3 py-1.5` cho toàn bộ 3 nút pipeline và nút `Xuất Video`, đảm bảo luôn giữ trên 1 hàng ngang duy nhất.

### 2.3. Chống Cắt Lẹm Toolbar Video Player
- Tệp: [`web/src/components/player/VideoPlayer.tsx`](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/components/player/VideoPlayer.tsx)
  - Bổ sung `shrink` và `truncate` cho vùng tiêu đề video và `shrink-0` cho nhóm nút công cụ, loại bỏ hiện tượng bị cắt xén góc trái trên màn hình hẹp.

### 2.4. Kết Nối Luồng Trạng Thái Toàn Cục
- Tệp: [`web/src/App.tsx`](file:///e:/tool%20edit/subtitle-localizer-studio/web/src/App.tsx)
  - Truyền đầy đủ `isScanning`, `statusMessage`, `handleStopScan`, `isTranslatingAll`, `isDubbingAll` vào `<BottomTimeline />`.

---

## 3. Kết Quả Nghiệm Thu & Thẩm Định (Verification Results)
- **Kiểm thử Red-First T23 (`tests/t23/test_timeline_progress_and_header_ui.py`)**: 4/4 bài test PASSED (Exit Code 0).
- **Kiểm thử Liền Kề & Hồi Quy (`tests/t22/ tests/t20/ tests/t19/ tests/t07/`)**: 26/26 bài test PASSED (Exit Code 0).
- **Kiểm thử Toàn Bộ Kho Mã Nguồn (`pytest tests/`)**: 425/425 bài test PASSED (100% Pass Rate).
- **Frontend Typecheck & Production Build (`npm --prefix web run build`)**: Thành công 100%, Exit Code 0, 0 lỗi TypeScript.
- **Quét Ký Tự Lỗi UTF-8 / Mojibake**: 0 ký tự lỗi (`\ufffd`) trên toàn bộ các tệp.
- **Thẩm Định Viên Độc Lập**: **APPROVED** 🎯 (Subagent `bc6d8242-ee75-49ec-8542-5e288afeb336`).
- **Trạng thái**: `STOPPED_AFTER_TICKET`.
