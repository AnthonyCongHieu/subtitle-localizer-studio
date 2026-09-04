# Project: Subtitle Localizer Studio — Advanced Downloader System

## Architecture
The Subtitle Localizer Studio Advanced Downloader System enhances the application with custom disk output storage, visual episode selection grid with local disk status detection, dedicated multi-drama queue management, and a sequential FIFO queue scheduler engine.

### System Boundaries & Data Flow
1. **Frontend (`web/src/`)**:
   - `App.tsx`: Expands top-level view state `viewMode` to `'dashboard' | 'studio' | 'queue'`.
   - `EpisodeSelectorGrid.tsx`: Visual 1..81 grid with 3 status badges (green: completed >100KB, red: error/corrupt, gray: missing), individual episode toggles, and 3 one-touch buttons.
   - `DownloadQueueHub.tsx`: Dedicated multi-drama download queue management view with drama cards, progress bars, live transfer speed, queue control buttons (pause/resume, reorder up/down, delete), and quick switch to Dashboard.
   - `UrlDownloadModal.tsx`: Incorporates custom output directory input with real-time validation, `EpisodeSelectorGrid`, and actions to start immediately or add to queue.
   - `api/client.ts`: TypeScript contracts for queue APIs, path validation, and episode disk scanning.
2. **Backend Services (`src/subtitle_localizer/service/`)**:
   - `downloader.py`: `DownloadManager` refactored with a thread-safe `DownloadTask` model, sequential FIFO background worker loop with `threading.Condition`, pause/resume, task reordering, auto-start next drama on completion or error, cross-drama device rotation and jitter delay, custom directory support per task, and disk episode scanning.
   - `server.py`: Consolidated downloader route group eliminating previous duplicate route handlers, exposing:
     - `POST /api/v1/downloader/directory/validate`: Real-time path validation & auto-creation.
     - `POST /api/v1/downloader/scan-episodes`: Real disk scanning of downloaded episode files.
     - `POST /api/v1/downloader/queue/add`: Add drama task to FIFO queue.
     - `GET /api/v1/downloader/queue/list`: Fetch all queued, running, paused, and completed tasks.
     - `POST /api/v1/downloader/queue/pause` & `resume`: Pause/resume queue processing.
     - `DELETE /api/v1/downloader/queue/{task_id}`: Remove or cancel queued task.
     - `POST /api/v1/downloader/queue/reorder`: Change task execution priority.
     - Preserves legacy endpoints `/downloader/parse`, `/start`, `/status`, `/cancel`.
3. **Testing Suite (`tests/t14/`)**:
   - `tests/t14/test_download_queue.py`: Unit and integration tests for R4 verifying FIFO, auto-start next drama, error recovery, pause/resume, delete, reorder, cross-drama device rotation, and jitter delay. Verifiable with `pytest tests/ -k queue`.
   - `tests/t14/test_downloader_custom_dir_and_grid.py`: Path validation, auto directory creation, episode disk scanning (green/red/gray), and selective episode downloading.
   - `tests/t14/test_queue_ui_contracts.py`: UI contract assertions ensuring frontend contracts and regression safety.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1.1 Custom Output Path UI | Input field in UI with real path display and default `uploads/` | M2 | ORIGINAL_REQUEST §R1 |
| 2 | R1.2 Path Validation & Auto-Create | API validates path, checks writability, auto-creates directory tree | M2 | ORIGINAL_REQUEST §R1 |
| 3 | R1.3 Path Persistence | Persistent storage of output path in localStorage and task requests | M2 | ORIGINAL_REQUEST §R1 |
| 4 | R2.1 Visual Episode Grid (1..81) | Visual grid of episode buttons (1..N) iQIYI/Netflix style | M3 | ORIGINAL_REQUEST §R2 |
| 5 | R2.2 Disk Status Detection | Scan disk for episodes: 🟢 complete (>100KB), 🔴 corrupt/error, ⚪ missing | M3 | ORIGINAL_REQUEST §R2 |
| 6 | R2.3 One-Touch & Individual Select | Click toggle per episode + [Chọn tất cả], [Chỉ chọn tập thiếu/lỗi], [Bỏ chọn] | M3 | ORIGINAL_REQUEST §R2 |
| 7 | R2.4 Selective Episode Download | Downloader executes download for only user-selected discrete episodes | M3 | ORIGINAL_REQUEST §R2 |
| 8 | R3.1 Dedicated Queue Page / Tab | "Hàng Đợi Tải Phim" hub view and navigation button | M4 | ORIGINAL_REQUEST §R3 |
| 9 | R3.2 Drama Queue Card Display | Cover, Chinese+pinyin title, Series ID, episode counts, path, speed, progress | M4 | ORIGINAL_REQUEST §R3 |
| 10 | R3.3 Queue Interactive Controls | Pause/Resume, Delete/Cancel, Reorder Up/Down | M4 | ORIGINAL_REQUEST §R3 |
| 11 | R3.4 Dashboard Quick Switch | One-click transition between Dashboard Batch Hub and Queue Hub | M4 | ORIGINAL_REQUEST §R3 |
| 12 | R4.1 FIFO Queue Scheduler Loop | DownloadManager thread-safe FIFO queue with condition variable | M1 | ORIGINAL_REQUEST §R4 |
| 13 | R4.2 Auto-Start Next Drama | On completion or failure, automatically start the next pending drama | M1 | ORIGINAL_REQUEST §R4 |
| 14 | R4.3 Device Rotation & Jitter Delay | Cross-drama device rotation and jitter delay between queue tasks | M1 | ORIGINAL_REQUEST §R4 |
| 15 | R4.4 Queue REST API Endpoints | `/queue/add`, `/queue/list`, `/queue/pause`, `/queue/resume`, `/{task_id}`, `/reorder` | M1 | ORIGINAL_REQUEST §R4 |
| 16 | R4.5 Legacy Endpoint Compatibility | `/parse`, `/start`, `/status`, `/cancel` maintained seamlessly | M1 | ORIGINAL_REQUEST §R4 |
| 17 | T1.1 Automated Queue Test Suite | `pytest tests/ -k queue` passes with comprehensive test cases | E2E/M1 | ORIGINAL_REQUEST Acceptance |
| 18 | T1.2 100% Existing Test Passing | All 172 existing tests pass without regression | All | ORIGINAL_REQUEST Acceptance |
| 19 | T1.3 TypeScript Compilation | `npm run build` in `web/` completes cleanly with 0 errors | All | ORIGINAL_REQUEST Acceptance |
| 20 | T1.4 Text & Character Integrity | UTF-8, Vietnamese, Chinese text preserved without mojibake | All | AGENTS.md & ORIGINAL_REQUEST |
| 21 | R5.1 Auto Download Cover Image | Backend auto downloads & saves cover image as `cover.jpg` into output folder | M1 | ORIGINAL_REQUEST §R5 |
| 22 | R5.2 1-Touch Download Cover UI | 1-touch button "Tải ảnh bìa" in UrlDownloadModal and DownloadQueueHub | M4 | ORIGINAL_REQUEST §R5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Test Suite Creation | Opaque-box test suite in `tests/t14/` covering Tiers 1-4, publish `TEST_READY.md` | none | DONE |
| M1 | Backend Queue Scheduler Engine (R4) & Cover Download (R5) | `DownloadTask`, FIFO scheduler loop, auto-advance, device rotation, jitter delay, Queue REST APIs, auto cover download | none | DONE |
| M2 | Custom Output Directory (R1) | Backend path validation/creation API, frontend path input, persistence, per-task output_dir | M1 | IN_PROGRESS |
| M3 | Episode Selector Grid & Selective Download (R2) | Backend episode disk scan endpoint, selective download logic, frontend `<EpisodeSelectorGrid />` | M1 | PLANNED |
| M4 | Dedicated Multi-Drama Queue UI & Hub (R3) & Cover UI (R5) | `<DownloadQueueHub />`, drama queue cards, live progress/speed, queue controls, viewMode switch, 1-touch cover download | M1, M2, M3 | PLANNED |
| Final | 100% E2E Test Verification & Hardening | Run all E2E tests, Phase 2 adversarial coverage hardening with Challenger, Forensic Audit | E2E, M1-M4 | PLANNED |

## Interface Contracts

### Backend Queue API (`src/subtitle_localizer/service/server.py`)
- `POST /api/v1/downloader/directory/validate`:
  - Request: `{"path": "string", "auto_create": bool}`
  - Response: `{"valid": bool, "path": "string", "exists": bool, "writable": bool, "error": Optional[str]}`
- `POST /api/v1/downloader/scan-episodes`:
  - Request: `{"title": "string", "total_episodes": int, "output_dir": Optional[str]}`
  - Response: `{"episodes": [{"episode": int, "status": "completed"|"corrupted"|"missing", "size_bytes": int, "filename": str}]}`
- `POST /api/v1/downloader/queue/add`:
  - Request: `{"target_info": dict, "episodes": Optional[List[int]], "start_ep": int, "end_ep": Optional[int], "output_dir": Optional[str], "auto_create_project": bool, "source_language": str, "target_language": str, "proxy": Optional[str], "rate_limit_delay": float, "rotate_device_each_ep": bool, "rotation_interval": int}`
  - Response: `{"success": bool, "task_id": str, "message": str, "position": int}`
- `GET /api/v1/downloader/queue/list`:
  - Response: `{"tasks": [DownloadTaskDict], "is_paused": bool, "active_task_id": Optional[str]}`
- `POST /api/v1/downloader/queue/pause`:
  - Response: `{"success": bool, "is_paused": bool}`
- `POST /api/v1/downloader/queue/resume`:
  - Response: `{"success": bool, "is_paused": bool}`
- `DELETE /api/v1/downloader/queue/{task_id}`:
  - Response: `{"success": bool, "message": str}`
- `POST /api/v1/downloader/queue/reorder`:
  - Request: `{"task_id": str, "direction": "up"|"down"|"top"|"bottom"}`
  - Response: `{"success": bool, "tasks": List[str]}`
- `POST /api/v1/downloader/download-cover`:
  - Request: `{"cover_url": "string", "output_dir": "string", "filename": Optional[str]}`
  - Response: `{"success": bool, "file_path": str, "message": str}`

### Frontend Component Contracts (`web/src/`)
- `EpisodeSelectorGrid`:
  - Props: `totalEpisodes: number`, `episodesStatus: Record<number, 'completed' | 'corrupted' | 'missing'>`, `selectedEpisodes: number[]`, `onToggleEpisode: (ep: number) => void`, `onSelectAll: () => void`, `onSelectMissingOrError: () => void`, `onDeselectAll: () => void`.
- `DownloadQueueHub`:
  - Props: `onSwitchToDashboard: () => void`.
  - State: polls `/api/v1/downloader/queue/list` every 1-2s when active.

## Code Layout
- `src/subtitle_localizer/service/downloader.py`: `DownloadTask`, `DownloadManager` queue scheduler engine, episode disk scanner.
- `src/subtitle_localizer/service/server.py`: REST routes for queue management, directory validation, episode disk scan.
- `web/src/components/project/EpisodeSelectorGrid.tsx`: Visual episode grid component.
- `web/src/components/project/DownloadQueueHub.tsx`: Dedicated multi-drama download queue hub view.
- `web/src/components/project/UrlDownloadModal.tsx`: Enhanced modal with custom output path and episode grid.
- `web/src/App.tsx`: View routing extension for `'queue'`.
- `web/src/api/client.ts`: TypeScript API client methods and response interfaces.
- `tests/t14/test_download_queue.py`: Dedicated queue logic test suite.
- `tests/t14/test_downloader_custom_dir_and_grid.py`: Path validation & episode grid tests.
- `tests/t14/test_queue_ui_contracts.py`: UI contracts and regression checks.
