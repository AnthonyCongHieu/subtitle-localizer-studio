# BÁO CÁO TRIỂN KHAI HỆ THỐNG ĐIỀU PHỐI LAN WORKER ORCHESTRATION & ADMIN MVP
**Subtitle Localizer Studio - Distributed Multi-Machine LAN Pipeline**  
*Ngày cập nhật: 09/09/2026*

---

## 1. TỔNG QUAN HỆ THỐNG (SYSTEM OVERVIEW)

Hệ thống **LAN Worker Orchestration** cho phép **Subtitle Localizer Studio** mở rộng khả năng xử lý từ 1 máy đơn lẻ thành một cụm nhiều máy tính trong mạng nội bộ (LAN):
- **Máy Chủ Điều Phối (Admin / Coordinator)**: Tiếp nhận dự án, quản lý hàng đợi Job, phê duyệt danh sách video tải về, điều phối công việc dựa trên cấu hình phần cứng của từng máy trạm và theo dõi tiến độ thời gian thực qua WebSocket.
- **Máy Trạm Xử Lý (Worker Node)**: Được đóng gói độc lập trong thư mục `worker/`, có thể copy sang bất kỳ máy tính nào trong mạng LAN, tự động khởi động (1-click BAT), tự cấu hình phụ thuộc, tự nhận job từ Coordinator và có giao diện web giám sát riêng.
- **Quy Trình Tự Động Toàn Trình (Full E2E Pipeline)**: Hỗ trợ tự động hóa toàn bộ các công đoạn: `Download` $\rightarrow$ `Prepare Project` $\rightarrow$ `OCR Subtitle` $\rightarrow$ `Translate VI` $\rightarrow$ `Dubbing (TTS)` $\rightarrow$ `Export Video Final`.

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                        ADMIN COORDINATOR (Máy Chủ Quản Trị)                       │
│  • Web Admin UI: WorkersPanel | JobsPanel | DownloadsPanel                       │
│  • Control Plane: Lease Fencing, Capability Scheduling, Artifact Storage          │
└─────────────────────────┬───────────────────────────────┬─────────────────────────┘
                          │ HTTP REST / WebSocket         │ HTTP REST / WebSocket
                          ▼                               ▼
       ┌─────────────────────────────────────┐ ┌─────────────────────────────────────┐
       │      WORKER NODE 01 (GPU CUDA)      │ │        WORKER NODE 02 (CPU)         │
       │  • Capabilities: OCR, TTS, Export   │ │  • Capabilities: Translate, DL      │
       │  • Web UI: worker.html (:8001)      │ │  • Web UI: worker.html (:8001)      │
       │  • Auto Claim & Artifact Exchange   │ │  • Auto Claim & Artifact Exchange   │
       └─────────────────────────────────────┘ └─────────────────────────────────────┘
```

---

## 2. KẾ HOẠCH TRIỂN KHAI TỔNG THỂ & TIẾN ĐỘ (MASTER ROADMAP)

| Giai đoạn | Nhiệm vụ trọng tâm | Trạng thái | Tiến độ | Kết quả đạt được |
| :--- | :--- | :---: | :---: | :--- |
| **Giai đoạn 1** | **Backend Admin LAN MVP** | ✅ Hoàn thành | 100% | Bổ sung API `/api/v1/admin/...`, SQLite migration, cơ chế Lease Fencing chống xung đột job, WebSocket realtime. |
| **Giai đoạn 2** | **Frontend Admin LAN MVP** | ✅ Hoàn thành | 100% | Tách module UI (`WorkersPanel`, `JobsPanel`, `DownloadsPanel`, `LanUi`), hook `useLanOverview` với cơ chế auto-reconnect & fallback. |
| **Giai đoạn 3** | **Xác minh & Tích hợp Control Plane** | ✅ Hoàn thành | 100% | Gộp nhánh làm việc, chạy thành công toàn bộ bài test `pytest tests/test_lan_control_plane.py` và `npm run build`. |
| **Giai đoạn 4** | **Worker Portable & Worker UI** | 🔄 Đang hoàn thiện | 95% | Đóng gói thư mục `worker/` độc lập, file `start-worker.bat`, `diagnose-worker.bat`, giao diện web `worker.html`, giao thức truyền nhận Artifact. |
| **Giai đoạn 5** | **Kiểm thử E2E Toàn Trình** | ⏳ Chờ thực thi | 0% | Kiểm thử tự động 1 chu trình khép kín: Tải video $\rightarrow$ OCR $\rightarrow$ Dịch tiếng Việt $\rightarrow$ Lồng tiếng $\rightarrow$ Xuất MP4 trên máy trạm Worker. |

> **Tổng tiến độ hoàn thành toàn dự án: ~85%**

---

## 3. CHI TIẾT KỸ THUẬT & CÁC THAY ĐỔI MÃ NGUỒN (TECHNICAL IMPLEMENTATION)

### 3.1. Phía Coordinator / Backend Admin LAN
1. **Cơ chế Lease Fencing & Tránh Tranh Chấp Job (`src/subtitle_localizer/service/lan.py`)**:
   - Khi Worker nhận job qua `/api/v1/admin/workers/{worker_id}/claim`, Coordinator cấp một `lease_id` cùng thời hạn `lease_expires_at`.
   - Worker phải gửi heartbeat định kỳ để gia hạn lease. Nếu Worker bị mất kết nối hoặc sập nguồn, job sẽ tự động hết hạn lease và được đưa lại vào hàng đợi (Re-queue) an toàn, không bị treo vĩnh viễn.
   - Thêm xử lý lỗi chuẩn: `LanLeaseError (409)`, `LanStateError (409)`, `ValueError (422)`.
2. **Điều phối theo Năng Lực Phần Cứng (Capability-based Scheduling)**:
   - Coordinator kiểm tra bảng `capabilities` của từng máy trạm (hỗ trợ `cuda`, `directml`, `ffmpeg`, `tts`, `ocr`) trước khi giao job phù hợp.
3. **Database Migration (`src/subtitle_localizer/persistence/database.py`)**:
   - Tự động bổ sung các trường: `attempt`, `max_attempts`, `lease_id`, `lease_expires_at`, `heartbeat_at`, `started_at`, `finished_at`, `current_stage`, `result`, `artifacts`, `protocol_version`.
4. **Bộ API Quản Trị Mới (`src/subtitle_localizer/service/server.py`)**:
   - `GET /api/v1/admin/overview`: Lấy tổng quan trạng thái máy trạm, số job đang chạy, hàng đợi tải.
   - `GET/POST /api/v1/admin/workers`: Danh sách và đăng ký máy trạm.
   - `GET/POST/PATCH /api/v1/admin/jobs`: Quản lý, giao việc, cập nhật tiến độ, hủy/thử lại (`cancel`/`retry`).
   - `GET/POST /api/v1/admin/downloads`: Duyệt và điều phối các yêu cầu tải video.

---

### 3.2. Phía Giao Diện Admin LAN (Frontend)
Đã tái cấu trúc file nguyên khối `AdminLanView.tsx` thành cấu trúc module sạch, dễ bảo trì tại `web/src/components/admin/`:
- **`WorkersPanel.tsx`**: Bảng quản lý máy trạm trực quan (trạng thái Online/Offline, tài nguyên CPU/GPU, nhãn nhận diện, nút Enable/Disable máy).
- **`JobsPanel.tsx`**: Bảng theo dõi tiến độ Job thời gian thực (hiển thị Stage hiện tại, tiến độ %, Lease time, nút Cancel / Retry kèm hộp thoại xác nhận an toàn).
- **`DownloadsPanel.tsx`**: Quản lý hàng đợi video cần tải, xem trước metadata, duyệt/từ chối tải.
- **`useLanOverview.ts`**: Custom React Hook quản lý luồng dữ liệu WebSocket hai chiều, tự động gộp các cập nhật liên tiếp (single-flight/coalesced) và tự động fallback sang cơ chế Polling nếu mạng LAN chập chờn.
- **`LanUi.tsx`**: Hệ thống UI components đồng bộ chuẩn Dark Theme (Badge, Status Indicator, Metrics Card).

---

### 3.3. Phía Worker Portable & Giao Diện Máy Trạm (Worker Package)
1. **Cấu trúc thư mục Portable `worker/`**:
   - `start-worker.bat`: Script 1-click khởi động Worker Node (tự động kích hoạt venv, mở Web UI Worker).
   - `stop-worker.bat`: Dừng tiến trình Worker an toàn.
   - `diagnose-worker.bat`: Tự động chẩn đoán máy trạm (kiểm tra Python version >= 3.10, PyTorch CUDA GPU, binary FFmpeg/FFprobe, kết nối mạng tới Coordinator).
   - `bootstrap_worker.py`: Script tự động cài đặt dependency và kiểm tra tính toàn vẹn khi copy sang máy mới.
   - `config.example.json`: File mẫu cấu hình địa chỉ IP máy Coordinator và định danh Worker.
2. **Giao diện Web Worker độc lập (`web/worker.html` & `web/src/worker-main.tsx`)**:
   - Giao diện nhẹ cho máy trạm, hiển thị trạng thái kết nối tới Coordinator, Job hiện tại đang xử lý, % tiến độ, log thời gian thực và cấu hình phần cứng.
3. **Giao thức Truyền Nhận Artifact (`src/subtitle_localizer/service/lan_protocol.py` & `lan_artifacts.py`)**:
   - Quản lý đóng gói, băm checksum SHA256 và truyền tải file video gốc, file audio, file subtitle `.srt`/`.json` giữa Coordinator và Worker qua giao thức HTTP an toàn.

---

## 4. HƯỚNG DẪN VẬN HÀNH & TRIỂN KHAI (OPERATION GUIDE)

### 4.1. Khởi động Máy Chủ Quản Trị (Admin Coordinator)
Trên máy chủ chính:
```bash
# Khởi động Coordinator API & Admin Web
python scripts/run_studio.py --host 0.0.0.0 --port 8000
```
Truy cập trang quản trị LAN tại trình duyệt: `http://localhost:8000/admin` (hoặc `http://<IP_MAY_CHU>:8000/admin`).

### 4.2. Triển khai sang Máy Trạm (Worker Node)
1. Copy toàn bộ thư mục `worker/` (kèm mã nguồn cần thiết) sang máy trạm trong cùng mạng LAN.
2. Tạo file `worker/config.json` từ file mẫu `config.example.json`:
   ```json
   {
     "protocol_version": "lan-worker-v1",
     "coordinator_url": "http://192.168.1.100:8000",
     "worker_id": "worker-gpu-01",
     "poll_interval_seconds": 3.0,
     "capabilities": {
       "cuda": true,
       "ocr": true,
       "tts": true,
       "translate": true,
       "export": true
     }
   }
   ```
3. Chạy kiểm tra môi trường:
   - Double-click `diagnose-worker.bat` để đảm bảo Python, GPU và kết nối mạng đều sẵn sàng.
4. Bắt đầu làm việc:
   - Double-click `start-worker.bat`. Worker sẽ tự động kết nối và nhận việc từ Coordinator.
   - Xem giao diện trạng thái Worker tại: `http://localhost:8001`.

---

## 5. KẾ HOẠCH BƯỚC TIẾP THEO (NEXT STEPS - GIAI ĐOẠN 5)

Sau khi hoàn tất đóng gói và tích hợp mã nguồn của Giai đoạn 4, hệ thống sẽ tiến hành chạy kịch bản nghiệm thu **E2E Full Pipeline Test**:
1. **Input**: Đưa vào 1 video thử nghiệm tại máy Coordinator.
2. **Download & Prepare**: Coordinator giao việc tải hoặc chuẩn bị project cho Worker.
3. **OCR Processing**: Worker dùng mô hình OCR (PP-OCRv5 / Anti-noise) bóc tách phụ đề.
4. **Translation**: Worker dịch phụ đề sang tiếng Việt.
5. **Dubbing (TTS)**: Worker tạo giọng đọc AI lồng tiếng khớp mốc thời gian.
6. **Video Export**: Worker render video MP4 hoàn chỉnh có sub + audio lồng tiếng.
7. **Artifact Sync**: Worker đẩy kết quả hoàn chỉnh về Coordinator để lưu trữ và hiển thị trên Admin.
