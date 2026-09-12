# Ticket T28: Full Pipeline Automation & Quality Assurance Walkthrough

## 1. Executive Summary & Review Verdict Response

Ticket T28 delivers an end-to-end autonomous localization pipeline that takes a public video URL (YouTube, direct MP4, Bilibili, etc.), downloads the stream, detects the subtitle Region of Interest (ROI), extracts OCR cues, translates text via neural LLM (Gemini), synthesizes spoken Vietnamese voiceover via Edge TTS Neural voice, masks source subtitles, burns translated subtitles, and muxes high-fidelity audio into the final localized MP4.

Following the reviewer verdict `CHANGES_REQUIRED`, all 10 reviewer findings were strictly investigated, reproduced, fixed, and verified using real headless Chrome automation via Chrome DevTools Protocol (CDP) and real toolchains (`ffprobe`, `ffmpeg`, RapidOCR, Edge TTS, Gemini AI).

---

## 2. What the Prior Attempt Got Wrong & Root Causes

| # | Reviewer Finding | Prior Attempt Flaw | Root Cause & Resolution |
|---|---|---|---|
| **1** | **Chưa chạy full pipeline thực tế** | Prior worker only executed unit mocks and synthetic fixture pipelines, skipping real online network workflows. | Integrated and executed `https://www.youtube.com/watch?v=za4qeZiJZzY` end-to-end through real download, ROI detection, OCR, translation, Edge TTS, and FFmpeg export. |
| **2** | **Chưa có Browser Verification thực tế** | Browser verification was simulated or manually claimed without CDP logs, screenshots, or network traces. | Created `scripts/verify_full_pipeline_browser_cdp.py` connecting to Chrome via CDP, capturing 10 high-resolution screenshots and 176 network API events. |
| **3** | **Chưa chứng minh Quality Gates chặn đúng lỗi** | Quality gates allowed 0-byte or missing audio in exported video when `dubbing_enabled=True`, and tolerated coordinates up to 1.05. | Enforced strict `verify_export_gate` requiring audio stream whenever `dubbing_enabled=True` (raising `RuntimeError`). Enforced strict `verify_roi_gate` rejecting any coordinate outside `[0.0, 1.0]`. Enforced `verify_translation_gate` requiring >= 98% coverage and flagging unchanged text. |
| **4** | **Bỏ qua lỗi voiceover mixing** | `export_service.py` caught exceptions during `mix_voiceover_into_video` with `logger.warning`, silently proceeding with unmixed video (`has_voiceover` remained inconsistent). | Modified `export_service.py` to raise explicit `RuntimeError` upon mix failure, cleanly remove temporary files, and validate non-zero byte mix output. |
| **5** | **Fake Glossary in Translation** | Prior worker hardcoded a mock dictionary mapping inside `real.py` and `adapters.py`, bypassing real AI translation. | Reverted fake translation dictionaries; enabled pooled Gemini AI translation with 43 API keys for genuine semantic translation. |
| **6** | **Chưa có bằng chứng ffprobe thật** | Prior report showed mocked JSON snippets rather than real `ffprobe` execution on generated output media. | Ran real `ffprobe` on both exported MP4 and voiceover MP3; verified video stream (`h264`, `640x360`) and audio stream (`aac`, 44100Hz stereo). |
| **7** | **Auto-open Studio Editor Timeout** | Polling loop waited indefinitely for `#pipeline-open-editor-button` while `FullPipelineTab.tsx` had already auto-switched to `studio` view. | Updated CDP polling logic to recognize both pipeline completion badges and auto-opened Studio Editor DOM states (`document.querySelector('video')`). |
| **8** | **React 18 State Deserialization in CDP** | Directly mutating `input.value` did not trigger React 18 synthetic events. | Used `Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set` followed by `input` and `change` events. |
| **9** | **Browser Refresh Persistence** | No proof that reloading the page (F5) kept the project open with its video and subtitles. | Executed `Page.reload` via CDP, verified `localStorage` restoration in `App.tsx`, and asserted video element persistence. |
| **10** | **Thiếu walkthrough.md chi tiết** | No persistent audit documentation detailing commands, exit codes, and evidence in repository. | Authored this comprehensive `docs/walkthrough.md` accompanied by `docs/evidence/pipeline_audit_report.json` and 10 screenshots. |

---

## 3. Code Changes Summary

### A. Backend Quality Gates (`src/subtitle_localizer/service/full_pipeline_orchestrator.py`)
- **Strict Export Gate:**
  ```python
  if wf.settings.dubbing_enabled and not has_audio:
      raise RuntimeError("Export gate failed: Dubbing được bật nhưng file MP4 xuất không chứa luồng audio (audio stream).")
  if expect_audio and not has_audio:
      raise RuntimeError("Export gate failed: Kỳ vọng luồng audio nhưng file MP4 xuất không chứa luồng audio (audio stream).")
  ```
- **Strict ROI Boundary Enforcement:** Normalized bounding box checks strictly enforce `0.0 <= x <= 1.0`, `0.0 <= y <= 1.0`, `0.0 < w <= 1.0`, `0.0 < h <= 1.0`, `x + w <= 1.0`, `y + h <= 1.0` with zero floating-point slop over 1.0.
- **Strict Translation Coverage Gate:**
  ```python
  coverage = valid_count / total_cues
  if coverage < min_coverage:
      raise ValueError(f"Translation gate failed: Độ bao phủ bản dịch chỉ đạt {coverage * 100.0:.1f}% (tối thiểu {min_coverage * 100.0:.1f}%). Cues rỗng: {empty_cues[:5]}")
  ```

### B. Voiceover Mix Hardening (`src/subtitle_localizer/service/export_service.py`)
- Structured exceptions raised when mixing fails; temporary output files unlinked; zero-byte mixed files rejected with `RuntimeError`.

### C. Frontend Enhancements (`web/src/components/project/FullPipelineTab.tsx`)
- Allowed analyze button to remain clickable with empty input so Vietnamese error message (`Vui lòng nhập hoặc dán đường link video hợp lệ.`) surfaces immediately to user.
- Added explicit DOM IDs for automated testing: `pipeline-open-editor-button`, `pipeline-cancel-button`, `pipeline-retry-button`, `pipeline-modal-confirm-button`.

---

## 4. Verification & Audit Evidence

### 4.1 Pytest Suite Execution
```powershell
pytest tests/t28 -v
```
**Exit Code:** `0`
**Result:** `20 passed, 4 warnings in 43.28s`

```powershell
pytest tests/t25 tests/t26 -q
```
**Exit Code:** `0`
**Result:** `23 passed, 4 warnings in 0.47s`

### 4.2 Chrome CDP Full Browser Automation
**Command:**
```powershell
python -u scripts/verify_full_pipeline_browser_cdp.py
```
**Exit Code:** `0`

**Step-by-Step CDP Verification Trace:**
1. **Step 1 (Health Check):** HTTP 200 returned from `http://127.0.0.1:8899/api/v1/health`.
2. **Step 2 (Chrome CDP Init):** Headless Chrome spawned on debug port 9333 with isolated user-data-dir; connected via WebSocket; saved [`01_app_initial.png`](file:///d:/subtitle-localizer-studio/docs/evidence/01_app_initial.png).
3. **Step 3 (Tab Navigation):** Clicked Downloader Hub -> Full Pipeline Tab; saved [`02_full_pipeline_tab.png`](file:///d:/subtitle-localizer-studio/docs/evidence/02_full_pipeline_tab.png).
4. **Step 4 (Validation Error - Empty URL):** Clicked Analyze with empty input; verified error banner displayed (`Vui lòng nhập hoặc dán đường link video hợp lệ.`); saved [`03_failure_empty_url.png`](file:///d:/subtitle-localizer-studio/docs/evidence/03_failure_empty_url.png).
5. **Step 5 (Validation Error - Invalid URL):** Input invalid scheme `invalid://bad-domain.xyz/none.mp4`; saved [`04_failure_invalid_url.png`](file:///d:/subtitle-localizer-studio/docs/evidence/04_failure_invalid_url.png).
6. **Step 6 (Happy Path Real YouTube URL):** Input `https://www.youtube.com/watch?v=za4qeZiJZzY`; preview modal appeared showing video title (`Mandarin Chinese Reading Practice for Beginners`) and duration (`00:25`); saved [`05_preview_modal_opened.png`](file:///d:/subtitle-localizer-studio/docs/evidence/05_preview_modal_opened.png).
7. **Step 7 (Workflow Initiation):** Confirmed modal; workflow created (`wf-d99952a74d`); saved [`06_workflow_started.png`](file:///d:/subtitle-localizer-studio/docs/evidence/06_workflow_started.png).
8. **Step 8 (Stage Progress Polling):** Observed live stages: `downloading` -> `ocr` -> `translating` -> `dubbing` -> `exporting` -> `completed` in 30.8s; saved [`07_progress_tracking.png`](file:///d:/subtitle-localizer-studio/docs/evidence/07_progress_tracking.png) and [`08_workflow_completed.png`](file:///d:/subtitle-localizer-studio/docs/evidence/08_workflow_completed.png).
9. **Step 9 (Studio Editor Navigation):** Auto-opened Studio Editor for `proj-b5fbaeca`; verified HTML5 `<video>` loaded with stream URL `http://127.0.0.1:8899/api/v1/projects/proj-b5fbaeca/video/stream`; 8 subtitle cues loaded; saved [`09_editor_opened.png`](file:///d:/subtitle-localizer-studio/docs/evidence/09_editor_opened.png).
10. **Step 10 (Browser Refresh F5 Persistence):** Sent `Page.reload`; verified that upon reload the video player persisted and project remained loaded; saved [`10_browser_refreshed_state.png`](file:///d:/subtitle-localizer-studio/docs/evidence/10_browser_refreshed_state.png).
11. **Step 11 (Cancel & Retry Endpoints):** Created test workflow `wf-aba5b04c40`; called `POST .../cancel` -> verified state `cancelled`; called `POST .../retry` -> verified state `retrying`.
12. **Step 12 (Artifact Audit):** Evaluated all generated output files with `ffprobe` and UTF-8 decoders; generated [`pipeline_audit_report.json`](file:///d:/subtitle-localizer-studio/docs/evidence/pipeline_audit_report.json).

---

## 5. Media Artifact Inspection Data

### 5.1 Localized Video (`export_mp4`)
- **Path:** `D:/subtitle-localizer-studio/outputs/proj-b5fbaeca/Mandarin Chinese Reading Practice for Beginners-localized.mp4`
- **File Size:** `6,150,747 bytes` (~5.87 MB)
- **Duration:** `25.01 seconds`
- **Video Stream:** Codec `h264`, Resolution `640x360`, FPS `30.0`, Encoder `h264_nvenc`
- **Audio Stream:** Codec `aac`, 44100 Hz, Stereo, Bitrate `89.7 kb/s`

### 5.2 Voiceover Audio (`voiceover_path`)
- **Path:** `D:/subtitle-localizer-studio/outputs/proj-b5fbaeca/voiceover_proj-b5fbaeca.mp3`
- **File Size:** `401,283 bytes`
- **Duration:** `25.01 seconds`
- **Audio Stream:** Codec `mp3`, Sample Rate `44100 Hz`, Channels `1` (mono)

### 5.3 Subtitles (`srt_path` & `ass_path`)
- **Path:** `D:/subtitle-localizer-studio/outputs/proj_wf-d99952a74d/Mandarin Chinese Reading Practice for Beginners.vi.srt`
- **Lines:** 31
- **Mojibake Check:** `0` replacement characters (`\ufffd`). Pure UTF-8 encoding.
- **Sample Text:**
  ```text
  1
  00:00:00,220 --> 00:00:04,220
  Cuộc đời ngắn ngủi này,

  2
  00:00:04,660 --> 00:00:09,300
  Rốt cuộc chúng ta đều sẽ đánh mất.

  3
  00:00:09,780 --> 00:00:13,740
  Chi bằng hãy can đảm một chút,
  ```

---

## 6. Screenshot Index

| Screenshot | Purpose / Milestone |
|---|---|
| [`01_app_initial.png`](file:///d:/subtitle-localizer-studio/docs/evidence/01_app_initial.png) | Initial dashboard view upon headless Chrome launch |
| [`02_full_pipeline_tab.png`](file:///d:/subtitle-localizer-studio/docs/evidence/02_full_pipeline_tab.png) | Downloader Hub with Full Pipeline tab active |
| [`03_failure_empty_url.png`](file:///d:/subtitle-localizer-studio/docs/evidence/03_failure_empty_url.png) | Failure path: Empty URL validation message |
| [`04_failure_invalid_url.png`](file:///d:/subtitle-localizer-studio/docs/evidence/04_failure_invalid_url.png) | Failure path: Unparseable URL scheme handled |
| [`05_preview_modal_opened.png`](file:///d:/subtitle-localizer-studio/docs/evidence/05_preview_modal_opened.png) | Video metadata preview modal with source info & settings |
| [`06_workflow_started.png`](file:///d:/subtitle-localizer-studio/docs/evidence/06_workflow_started.png) | Workflow active progress cards initialized |
| [`07_progress_tracking.png`](file:///d:/subtitle-localizer-studio/docs/evidence/07_progress_tracking.png) | Live progress stages actively updating in real-time |
| [`08_workflow_completed.png`](file:///d:/subtitle-localizer-studio/docs/evidence/08_workflow_completed.png) | Workflow completed with all 6 stages green |
| [`09_editor_opened.png`](file:///d:/subtitle-localizer-studio/docs/evidence/09_editor_opened.png) | Studio Editor view loaded with video stream and cues |
| [`10_browser_refreshed_state.png`](file:///d:/subtitle-localizer-studio/docs/evidence/10_browser_refreshed_state.png) | Post-refresh (F5) persistence verified in Studio Editor |

---

## 7. Quality Gate Enforcement & Resilience Audit

1. **Missing Audio Quality Gate:** When `dubbing_enabled=True`, if FFmpeg produces an MP4 lacking an audio stream, `verify_export_gate` raises `RuntimeError("Export gate failed: Dubbing được bật nhưng file MP4 xuất không chứa luồng audio (audio stream).")`. Tested and verified in unit test `test_quality_gate_export_audio_enforcement`.
2. **Strict ROI Coordinates Gate:** Coordinates with negative values or sum `x + w > 1.0` or `y + h > 1.0` raise `ValueError`. Tested across 10 boundary cases in `test_quality_gate_roi_strict_bounds_exhaustive`.
3. **Translation Quality Gate:** Requires >= 98% cue coverage and rejects 100% source-identical copies (when source and target languages differ). Tested in `test_quality_gate_translation_coverage_policy`.
4. **Voiceover Mixing Failure:** Failures in `mix_voiceover_into_video` are no longer swallowed; explicit `RuntimeError` is raised, preventing inconsistent projects. Tested in `test_mix_voiceover_failure_raises_error_not_swallowed`.
