# TEST_READY: Subtitle Localizer Studio — Advanced Downloader System

## Executive Summary
Comprehensive, opaque-box E2E test suites for the Advanced Downloader System (Requirements R1, R2, R3, R4, R5) have been created in `tests/t14/`. All test suites are structured to support Test-Driven Development (TDD) with executable red-first verification. The existing baseline test suite (172 tests across `tests/t00` to `tests/t13`) continues to execute and pass 100% with zero regressions.

---

## Test Inventory & Coverage Map

### 1. `tests/t14/test_download_queue.py`
Targeted by: `pytest tests/ -k queue`  
Covers: **R4 Queue Scheduler Engine**

| Tier | Test Method | Feature Covered | Expected Observable Behavior |
|---|---|---|---|
| **Tier 1: FIFO Operations** | `test_queue_add_task_fifo_order` | R4.1 FIFO Scheduling | Tasks added sequentially receive positions 1, 2, 3 and are queued in strict FIFO order. |
| | `test_queue_list_endpoint_and_state` | R4.4 Queue REST API | `GET /api/v1/downloader/queue/list` returns schema with `tasks`, `is_paused`, `active_task_id`, progress, and transfer speed. |
| | `test_queue_pause_and_resume_scheduler` | R4.1 Queue Control | `POST /queue/pause` halts task dispatch (`is_paused=True`); `POST /queue/resume` continues processing. |
| | `test_queue_delete_pending_task` | R4.4 Queue REST API | `DELETE /queue/{task_id}` cleanly removes a pending task from the queue. |
| | `test_queue_reorder_up_down_top_bottom` | R4.4 Priority Reorder | `POST /queue/reorder` updates task priority sequence according to `direction` ("up", "down", "top", "bottom"). |
| **Tier 2: Boundary & Edge** | `test_queue_empty_operations` | Boundary Safety | Pause, resume, and list on an empty queue return 200 without throwing unhandled 500 exceptions. |
| | `test_queue_delete_non_existent_task` | Boundary Safety | Deleting an invalid or missing `task_id` returns 404 or `{"success": false}` gracefully. |
| | `test_queue_reorder_boundary_limits` | Boundary Safety | Reordering top item "up"/"top" or bottom item "down"/"bottom" maintains list stability without index errors. |
| | `test_queue_cancel_active_downloading_task` | Lifecycle Transitions | Cancelling or deleting an actively downloading task transitions it to `cancelled` and terminates worker thread. |
| | `test_queue_add_with_invalid_payload` | Validation & Security | Empty body or missing `target_info` triggers 400/422 validation response. |
| **Tier 3: Cross-Feature** | `test_queue_auto_advance_on_drama_completion` | R4.2 Auto-Advance | When drama 1 finishes all episodes, queue engine automatically starts drama 2 without user intervention. |
| | `test_queue_auto_advance_on_drama_failure` | R4.2 Error Recovery | If drama 1 fails due to network or decryption error, status becomes `failed` and drama 2 starts automatically without stalling. |
| | `test_queue_cross_drama_device_rotation` | R4.3 Device Rotation | Switching between distinct drama tasks triggers `parser.rotate_device()` to acquire fresh device identity. |
| | `test_queue_jitter_delay_applied_between_dramas` | R4.3 Jitter Delay | Jitter delay is applied across queue boundaries to protect IP from rate limiting. |
| **Tier 4: Scenario** | `test_queue_three_drama_sequential_workload` | Real-World Workload | Sequential execution of 3 distinct HongGuo dramas (2 eps + 2 eps + 1 ep), creating respective project manifests. |

---

### 2. `tests/t14/test_downloader_custom_dir_and_grid.py`
Targeted by: `pytest tests/t14/test_downloader_custom_dir_and_grid.py`  
Covers: **R1 Custom Directory**, **R2 Episode Grid & Selective Download**, **R5 Cover Download**

| Feature | Test Method | Description |
|---|---|---|
| **R1. Custom Output Directory** | `test_directory_validate_existing_valid_path` | `POST /api/v1/downloader/directory/validate` with valid path returns `valid: True, exists: True, writable: True`. |
| | `test_directory_validate_empty_path_defaults_to_uploads` | Empty path resolves to standard `uploads/` directory with `valid: True`. |
| | `test_directory_validate_auto_create_new_folder` | Non-existent directory path with `auto_create: True` creates directory tree on disk. |
| | `test_directory_validate_auto_create_false_reports_non_existent` | Non-existent path with `auto_create: False` reports `exists: False` without creating directory. |
| | `test_directory_validate_invalid_path_characters` | Windows invalid characters (`*?"<>|`) report `valid: False` with error details. |
| | `test_custom_output_dir_used_by_downloader_task` | Download task configured with `output_dir` places files in `{output_dir}/{Title}/`, not default `uploads/`. |
| **R2. Episode Status & Selective Download** | `test_scan_episodes_disk_status_green_completed` | File > 100,000 bytes (>100KB) detected as `completed` (🟢 Green). |
| | `test_scan_episodes_disk_status_red_corrupted` | File <= 100,000 bytes (e.g. 1KB) detected as `corrupted` (🔴 Red). |
| | `test_scan_episodes_disk_status_gray_missing` | Missing file detected as `missing` (⚪ Gray). |
| | `test_scan_episodes_81_episodes_batch_summary` | Full 81-episode scan correctly reports counts: 30 completed, 1 corrupted, 50 missing. |
| | `test_selective_episodes_download_only_selected` | Task with `episodes=[15, 32]` downloads ONLY episode 15 and 32, skipping all other episodes. |
| **R5. Cover / Thumbnail Download** | `test_standalone_download_cover_success` | `POST /api/v1/downloader/download-cover` saves `cover.jpg` in target directory. |
| | `test_standalone_download_cover_invalid_url` | Unreachable cover URL returns error status without crashing server. |
| | `test_automatic_cover_download_during_drama_task` | When drama task runs with `cover_url`, `cover.jpg` is automatically downloaded into drama folder. |

---

### 3. `tests/t14/test_queue_ui_contracts.py`
Targeted by: `pytest tests/t14/test_queue_ui_contracts.py`  
Covers: **Frontend Component Contracts, Navigation, API Client, Text Encoding**

| Component / File | Test Method | Checked Contracts |
|---|---|---|
| `web/src/components/project/EpisodeSelectorGrid.tsx` | `test_episode_selector_grid_component_contract` | Verifies file existence, props (`totalEpisodes`, `episodesStatus`, `selectedEpisodes`, callbacks), 1-touch buttons ("Chọn tất cả", "Chỉ chọn các tập còn thiếu / lỗi", "Bỏ chọn tất cả"), status colors. |
| `web/src/components/project/DownloadQueueHub.tsx` | `test_download_queue_hub_component_contract` | Verifies file existence, props (`onSwitchToDashboard`), controls (pause/resume, reorder, delete), cards, speed (MB/s), progress bar. |
| `web/src/App.tsx` | `test_app_view_mode_routing_contract` | Verifies `viewMode` supports `'queue'`, navigation tab/button for "Hàng Đợi", and rendering `DownloadQueueHub`. |
| `web/src/components/project/UrlDownloadModal.tsx` | `test_url_download_modal_custom_dir_and_grid_contracts` | Verifies custom directory input, `EpisodeSelectorGrid` integration, queue button, and R5 1-touch cover download button. |
| `web/src/api/client.ts` | `test_api_client_downloader_queue_methods` | Verifies API client methods: `validateDirectory`, `scanEpisodes`, `addToQueue`, `getQueueList`, `pauseQueue`, `resumeQueue`, `deleteQueueTask`, `reorderQueue`, `downloadCover`. |
| System Wide | `test_vietnamese_text_integrity_no_mojibake` | Scans for unicode replacement characters (`\ufffd`) and UTF-8 mojibake patterns in test and web source files. |

---

## Verification Commands

1. **Run R4 Queue Test Suite:**
   ```bash
   pytest tests/ -k queue
   ```

2. **Run All T14 Downloader & Queue Test Suites:**
   ```bash
   pytest tests/t14/
   ```

3. **Run Full Project Test Suite (Regression Baseline):**
   ```bash
   pytest tests/t00 tests/t01 tests/t02 tests/t03 tests/t04 tests/t05 tests/t06 tests/t07 tests/t08 tests/t09 tests/t10 tests/t11 tests/t12 tests/t13
   # Result: 172 passed in ~7.3s
   ```

4. **Frontend TypeScript Compilation Check:**
   ```bash
   cd web && npm run build
   ```

---

## Current Status (Red-First TDD Baseline)

As of test suite publication:
- **Baseline tests (t00..t13):** 172 passed, 0 failed (100% pass rate).
- **T14 test suites:** Correctly demonstrating red-first failures against planned M1–M4 functionality (missing routes, `add_to_queue` method on `DownloadManager`, and planned TSX components).
- **Text integrity:** 100% clean UTF-8; zero mojibake.
- **Isolation:** Network calls and device keys are cleanly mocked; temporary sandboxes used for all disk operations.
