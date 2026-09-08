# Kế Hoạch Triển Khai: Ticket T18 — Đồng Bộ Editor Nguyên Tử & Trạng Thái Thao Tác Trung Thực

## 1. Bối Cảnh & Vấn Đề Xác Minh (Evidence-Based)
Dựa trên kết quả kiểm thử thực tế từ Chrome và audit hệ thống:
1. **P0 (Race Condition làm mất Manifest)**: 
   - Trong `web/src/App.tsx` (dòng 638-654), debounce 500ms tự động kích hoạt đồng thời 2 API request song song: `saveProjectSettings` (`PUT /settings`) và `saveRegions` (`PUT /regions`).
   - Cả 2 endpoint trong `server.py` đều đọc toàn bộ manifest từ SQLite bằng `repository.get_project()`, sửa trường của mình rồi gọi `repository.save_project(manifest)` ghi đè toàn bộ `manifest_json`.
   - Kết quả: Request nào ghi sau cùng sẽ đè bẹp và làm mất hoàn toàn dữ liệu của request kia (mất ROI hoặc mất settings).
2. **P1 (Auto-save nuốt lỗi ngầm)**:
   - Các lệnh auto-save dùng `.catch(() => {})`, khi backend gặp lỗi hoặc mạng chập chờn thì người dùng không hề hay biết cấu hình chưa được lưu.
   - Chưa có chỉ báo trạng thái lưu góc trên màn hình.
3. **P1 (WebSocket nhãn "Live" sai lệch)**:
   - Trong `App.tsx` dòng 685-686, `setWsConnected(true)` được gọi ngay sau `wsClient.connect()`, không chờ sự kiện `onopen`. Khi mất kết nối (`onclose`, `onerror`), không hề chuyển về `false`.
4. **P1 (Khóa thao tác Dịch và Lồng tiếng khi 0 subtitle cues)**:
   - Khi video chưa quét OCR (0 cues), các nút Dịch và Lồng tiếng vẫn bấm được. Endpoint `retranslate` trả về `{ status: "empty" }` (mã HTTP 200) làm UI tưởng thành công, còn TTS trả lỗi 400. Cần vô hiệu hóa (disable) kèm tooltip "Quét phụ đề trước".

---

## 2. Thay Đổi Cấu Trúc Dữ Liệu & Hợp Đồng API

### 2.1. Backend (`src/subtitle_localizer/persistence/repository.py`)
- Thêm phương thức cập nhật nguyên tử có khóa giao dịch SQLite:
  `patch_project(project_id: str, patch_dict: Dict[str, Any]) -> Optional[ProjectManifestV1]`
  - Sử dụng giao dịch `BEGIN IMMEDIATE` để khóa hàng dự án.
  - Tải `manifest_json` mới nhất trong giao dịch.
  - Hợp nhất dữ liệu mới (ví dụ: `regions`, `custom_pipeline_settings`, `source_language`, ...).
  - Tự động tăng `active_revision += 1` và cập nhật `updated_at`.
  - Lưu lại `manifest_json` và COMMIT.
- Cập nhật cả `save_regions` và `save_project_settings` trong `server.py` để sử dụng `patch_project` nhằm triệt tiêu race condition kể cả khi có 2 client gọi riêng lẻ.

### 2.2. Endpoint Gộp Mới (`src/subtitle_localizer/service/server.py`)
- Thêm endpoint gộp atomic:
  `PUT /api/v1/projects/{project_id}/editor-state`
  - Nhận body: `{ "regions": Optional[List[Dict]], "settings": Optional[Dict[str, Any]] }`
  - Thực hiện cập nhật nguyên tử cả 2 thành phần trong duy nhất 1 database transaction.
- Sửa endpoint `/api/v1/projects/{project_id}/retranslate`:
  - Khi `cues` rỗng (len == 0): Trả về HTTP 400 Bad Request với detail rõ ràng: `"Dự án chưa có phụ đề để dịch. Hãy quét phụ đề trước."` (thay vì 200 status "empty").
- Endpoint `/api/v1/projects/{project_id}/dubbing/run`:
  - Giữ chuẩn HTTP 400 khi `len(cues) == 0`.

### 2.3. Frontend WebSocket Client (`web/src/api/websocket.ts`)
- Mở rộng trạng thái kết nối:
  `type WsConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';`
- Thêm cơ chế lắng nghe trạng thái kết nối:
  - `onStatusChange(callback: (status: WsConnectionStatus) => void): () => void`
  - `isConnected(): boolean` (kiểm tra `readyState === WebSocket.OPEN`)
- Kích hoạt sự kiện chính xác tại `ws.onopen` (`connected`), `ws.onclose` (`reconnecting`/`disconnected`), `ws.onerror` (`disconnected`).

### 2.4. Frontend Auto-save & Header (`web/src/App.tsx` & `StudioHeader.tsx`)
- Trong `App.tsx`:
  - Gộp 2 lệnh gọi song song thành 1 lệnh gọi duy nhất: `apiClient.saveEditorState(activeProject.project_id, { regions, settings })`.
  - Quản lý trạng thái lưu: `saveStatus: 'idle' | 'saving' | 'saved' | 'error'`.
  - Khi lưu lỗi: Không nuốt lỗi, set `saveStatus = 'error'` và bắn log lỗi ra `appLogger.error`.
  - Lắng nghe `wsClient.onStatusChange` để cập nhật `wsStatus`.
- Trong `StudioHeader.tsx`:
  - Hiển thị badge trạng thái lưu:
    - Đang lưu: Spinner vàng/cyan `Đang lưu...`
    - Đã lưu: Checkmark xanh lá `Đã lưu`
    - Lỗi: Cảnh báo đỏ `Lỗi đồng bộ`
  - Hiển thị nhãn Live trung thực:
    - Khi `connected`: Chấm xanh nhấp nháy + chữ `Live`
    - Khi `connecting`/`reconnecting`: Chấm vàng + chữ `Đang nối...`
    - Khi `disconnected`: Chấm xám/đỏ + chữ `Mất kết nối`

### 2.5. Frontend Thao Tác Dịch & Lồng Tiếng (Disable khi 0 Cues)
- `web/src/components/sidebar/LeftMediaSidebar.tsx`:
  - Nút "Lồng tiếng toàn bộ video": `disabled={isDubbingAll || !activeProject || cues.length === 0}` kèm tooltip "Quét phụ đề trước".
- `web/src/components/inspector/RightInspectorPanel.tsx`:
  - Nhận `cues` từ `App.tsx`.
  - Nút "Dịch Toàn Bộ Tập Phim": `disabled={isTranslatingAll || !activeProject || cues.length === 0}` kèm tooltip.
  - Nút "Lồng Tiếng Toàn Bộ Video": `disabled={isDubbingAll || !activeProject || cues.length === 0}` kèm tooltip.
- `web/src/components/project/DashboardBatchHub.tsx`:
  - Nút "Dịch lại" và "Tạo giọng (Voice)" trong modal chi tiết tập: `disabled={isSingleRunning || (inspectingProject.cues_count || 0) === 0}` kèm tooltip.
  - Nút lồng tiếng đơn trên card: `disabled={(project.cues_count || 0) === 0}`.

---

## 3. Các Rủi Ro & Biện Pháp Phòng Ngừa
1. **Rủi ro SQLite Database Lock trong môi trường đa luồng (Multi-threading)**:
   - *Biện pháp*: Dùng `BEGIN IMMEDIATE;` với cơ chế timeout hợp lý và `try...finally` đảm bảo ROLLBACK ngay khi có exception, không gây treo lock.
2. **Rủi ro hồi quy với các API clients cũ**:
   - *Biện pháp*: Giữ nguyên các endpoints `PUT /regions` và `PUT /settings`, nhưng bên trong chuyển sang gọi `patch_project` an toàn nguyên tử.
3. **Rủi ro UI giật lag do lưu trạng thái**:
   - *Biện pháp*: Debounce 500ms được giữ nguyên, chỉ gộp payload truyền đi 1 request duy nhất.

---

## 4. Kế Hoạch Kiểm Thử & Xác Minh (Red-First & Evidence)
1. **Red-first Unit & Concurrency Test**:
   - Viết `tests/t18/test_atomic_editor_sync.py`:
     - Tái hiện race condition: 2 luồng đồng thời ghi `save_regions` và `save_project_settings`. Xác nhận cả hai trường đều được bảo toàn 100% trong DB.
     - Kiểm thử `PUT /editor-state` gộp.
     - Kiểm thử `retranslate` và `dubbing/run` với dự án 0 cues: xác nhận trả về mã lỗi 400.
2. **Frontend Build & Lint**:
   - Chạy `npm run build` trong `web/`: Exit code 0, 0 lỗi TypeScript.
## 5. Kết Quả Nghiệm Thu & Thẩm Định Độc Lập (Hoàn Tất)
- **Kiểm thử Red-First (`tests/t18/test_atomic_editor_sync.py`)**: 4/4 bài test đạt yêu cầu (concurrent update bảo toàn dữ liệu, endpoint gộp editor-state, chặn 400 khi 0-cues).
- **Kiểm thử Toàn Bộ Kho Mã (`python -m pytest tests/`)**: 389/389 tests passed (Exit Code 0).
- **Frontend Typecheck & Production Build (`npm run build`)**: Thành công 100%, Exit Code 0, 0 lỗi TypeScript.
- **Quét Ký Tự Lỗi UTF-8 / Mojibake**: 0 ký tự lỗi trên toàn bộ các file sửa đổi/tạo mới.
- **Thẩm Định Độc Lập (Independent Reviewer Verdict)**: **APPROVED** ✅.
- **Trạng thái**: `STOPPED_AFTER_TICKET`.

