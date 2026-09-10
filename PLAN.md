# Kế Hoạch Triển Khai: Ticket T24 — Tái Cấu Trúc Toàn Diện Giao Diện Admin (Operations Control Center)

## 1. Bối Cảnh & Yêu Cầu Đã Thống Nhất (/grill-me)
Dựa trên phản ánh của người dùng:
> *"tôi cần làm lại toàn bộ giao diện admin. /grill-me"*
> *"A1: nơi kiểm tra kết nối / trạng thái job và thông số phần cứng các worker / tiến độ job / setting chi tiết về cách làm egine cụ thể của các worker ( sẽ đồng bộ với setting tổng ) . cho phép xem từng job video cụ thể và đưa video xong của worker vào editor như video thật trên dự án . cho phép mock trước để xem cách hoạt động . no AI Slop . và các mục bổ sung đi kèm"*

### 6 Trụ Cột Tính Năng Chính
1. **Kiểm tra kết nối & Trạng thái phần cứng các Worker**:
   - Realtime WebSocket status, Ping/Latency (ms), nhịp tim heartbeat.
   - Hiển thị trực quan: Tên GPU, Thước đo VRAM sử dụng (GB / Max GB với mã màu xanh -> vàng -> đỏ), CPU model, Platform, Queue depth.
2. **Theo dõi Tiến độ Job Thời Gian Thực**:
   - Thống kê stage (OCR, Translate, Dubbing, Downloader), % tiến độ chạy thời gian thực, attempt, lease expiration, metrics JSON.
3. **Cấu hình Engine Chi Tiết Từng Worker (Đồng bộ Setting Tổng)**:
   - Chế độ kép (Hybrid): Mặc định kế thừa từ Thiết lập Tổng (`GlobalPipelineSettings`).
   - Tùy biến Override riêng cho từng worker: Gán vai trò (Chuyên OCR GPU, Whisper, Dịch, Download), gán CUDA Device ID, điều chỉnh batch size.
   - Nút *"Đồng bộ lại từ Setting Tổng"* để reset về cấu hình chuẩn chung bất cứ lúc nào.
4. **Xem Video Từng Job & Đưa Vào Studio Editor**:
   - Modal/Drawer Quick Preview phát video kết quả kèm phụ đề/cues bóc tách.
   - Nút 1-click *"Mở trong Studio Editor"*: Tự động nạp video và cues lên Timeline Studio (`viewMode = 'studio'`), cho phép cắt ghép, biên tập trực tiếp như dự án thật.
5. **Chế Độ Giả Lập Thử Nghiệm (Interactive Sandbox Mock Mode)**:
   - Công tắc Bật/Tắt Mock trên Header.
   - Khi BẬT: Sinh cụm worker giả lập đa cấu hình (RTX 4090, Apple Silicon, CPU Node), job chạy live progress ticker tăng dần, job hoàn thành có video mẫu xem thử và nạp vào Studio, các nút Drain/Retry/Duyệt tải đều phản hồi tức thì.
   - Khi TẮT: Quay trở về 100% dữ liệu backend coordinator thật mà không để lại dữ liệu rác.
6. **No AI Slop - Giao Diện Pro Studio Thực Dụng**:
   - Bố cục 4 Tabs chuyên sâu: `[1. Tổng quan & Cụm Bento]` - `[2. Trạm Worker & Cấu hình Engine]` - `[3. Giám sát Jobs & Đưa vào Editor]` - `[4. Duyệt Tải Media]`.
   - Drawer trượt xem chi tiết thông số/log, bộ lọc nhanh, thao tác hàng loạt (Hủy/Retry job lỗi).

---

## 2. Thay Đổi Cấu Trúc Dữ Liệu & Tệp Mã Nguồn

### 2.1. Tệp Dữ Liệu Mới & Định Nghĩa Kiểu Dữ Liệu
- `web/src/components/admin/types.ts`:
  - `WorkerEngineOverride`: Định nghĩa thông số tùy biến engine riêng cho worker (roles, device_id, batch_size, custom_model).
  - `AdminTabType`: `'overview' | 'workers' | 'jobs' | 'downloads'`.
  - `MockJobSimulator`: Cấu trúc mô phỏng tiến độ live ticker.
- `web/src/components/admin/mockData.ts`:
  - Dữ liệu giả lập 3 Workers (RTX 4090, Apple M2, CPU Node), 4 Jobs (running, completed, failed, queued), 2 Download requests.
  - Ticker giả lập cập nhật tiến trình 0% -> 100% kèm stage transition.

### 2.2. Các Thành Phần Giao Diện Mới & Tái Cấu Trúc
- `web/src/components/admin/LanUi.tsx`:
  - Thước đo `VramBar` phân đoạn kèm chỉ số GB.
  - Huy hiệu `HardwareBadge`, `LatencyPill`, `MetricCard` phong cách Bento pro studio.
- `web/src/components/admin/AdminOverviewTab.tsx`:
  - Tab 1: Bento grid tổng quan tài nguyên cụm, telemetry, phân bổ tải worker, thông báo chú ý.
- `web/src/components/admin/AdminWorkersTab.tsx`:
  - Tab 2: Danh sách thẻ/bảng Worker chi tiết, thước đo VRAM trực quan, nút Drain/Bật/Xóa và nút mở Drawer Cấu hình Engine.
- `web/src/components/admin/WorkerConfigDrawer.tsx`:
  - Slide-over Drawer cấu hình Engine từng worker: phân vai chuyên môn, gán CUDA GPU ID, số luồng, nút Đồng bộ từ Setting Tổng.
- `web/src/components/admin/AdminJobsTab.tsx`:
  - Tab 3: Danh sách Job với thanh progress live %, bộ lọc stage & trạng thái, nút Cancel/Retry/Delete, nút mở Quick Preview Video.
- `web/src/components/admin/JobVideoPreviewModal.tsx`:
  - Modal xem trước video kết quả của Job kèm phụ đề, và nút 1-click "Mở trong Studio Editor".
- `web/src/components/admin/AdminDownloadsTab.tsx`:
  - Tab 4: Thẻ duyệt tải video, xem thông tin dung lượng/thời lượng, nút Duyệt hoặc Từ chối.
- `web/src/components/admin/useLanOverview.ts`:
  - Tích hợp công tắc `isMockMode`, ticker giả lập, đo ping latency ms, lưu trữ override cấu hình worker.
- `web/src/components/admin/AdminLanView.tsx`:
  - Container chính: Header công cụ (Ping, Sandbox Switch, Nút Đồng bộ Settings, Về Dashboard) + 4 Tabs chuyên sâu + Kết nối callback Studio.
- `web/src/App.tsx`:
  - Bổ sung prop `onOpenInStudio` cho `<AdminLanView />` để kích hoạt nạp video/cues vào Studio Timeline khi bấm từ Job.

---

## 3. Rủi Ro & Biện Pháp Kiểm Soát (Risks & Mitigation)
1. **Rủi ro rò rỉ dữ liệu Mock sang môi trường Thật**:
   - *Biện pháp*: Dữ liệu mock được cô lập hoàn toàn trong state frontend của Sandbox Mode. Khi gạt công tắc Tắt Mock, hệ thống tự động hủy toàn bộ timers và gọi refresh lại 100% từ Coordinator API thật.
2. **Rủi ro lệch phiên bản cấu hình khi Đồng bộ Setting Tổng**:
   - *Biện pháp*: Lấy trực tiếp `GlobalPipelineSettings` từ API `apiClient.getPipelineSettings()`, khi người dùng bấm "Đồng bộ lại", toàn bộ thông số override của worker sẽ được reset về chính xác các giá trị của Setting Tổng.
3. **Rủi ro khi nạp video của Job chưa có trong dự án**:
   - *Biện pháp*: Kiểm tra nếu `job.project_id` đã tồn tại trong danh sách projects thì nạp dự án đó; nếu là job độc lập/mock thì tạo đối tượng Project tạm thời (`mock-project`) kèm cues để Studio Timeline mở lên mượt mà mà không gây crash.

---

## 4. Kế Hoạch Nghiệm Thu (Verification Steps)
1. **Frontend Build & Typecheck**: Chạy `npm --prefix web run build` đảm bảo 0 lỗi TypeScript, 0 cảnh báo cú pháp.
2. **Kiểm tra Mock Sandbox**: Bật toggle Mock, quan sát job chạy tăng % tiến độ, bấm thử các nút Drain, Retry, Duyệt tải.
3. **Kiểm tra Nạp Video vào Editor**: Bấm "Xem video & Editor" trên Job hoàn thành -> bấm "Mở trong Studio Editor" -> xác nhận chuyển sang Studio Timeline với video và cues hiển thị chính xác.
4. **Kiểm tra Cấu hình Worker**: Đổi vai trò và GPU ID trên Drawer cấu hình -> bấm "Đồng bộ Setting Tổng" -> xác nhận giá trị cập nhật chuẩn xác.
5. **Kiểm tra Hồi quy**: Chạy bộ test backend hiện có (`pytest tests/`) để đảm bảo không ảnh hưởng đến bất kỳ API nào.

