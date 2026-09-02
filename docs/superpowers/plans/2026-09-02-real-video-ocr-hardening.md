# Real-Video OCR Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Process the approved Chinese sample videos through a trustworthy real-only OCR path and generate evidence-backed Chinese SRT and ASS exports.

**Architecture:** Keep the existing FastAPI/SQLite/React architecture intact. Strengthen the synchronous worker for controlled local batches: use real decoded frames and correct ROI coordinates, reject fake fallback results, persist cues safely per project, and write batch artifacts outside Git. The ticket intentionally does not introduce a queue or a persistent worker process.

**Tech Stack:** Python 3.11, SQLite, OpenCV, RapidOCR ONNX Runtime, FFmpeg/ffprobe, FastAPI, React/Vite.

**Spec:** `docs/superpowers/specs/2026-09-02-real-video-ocr-hardening-design.md`

## Global Constraints

- Preserve all UTF-8 Vietnamese, Chinese, Japanese, and Korean source text exactly.
- Do not commit videos, OCR models, proxies, caches, databases, generated subtitles, reports, or secrets.
- Do not add a framework or replace the existing FastAPI/React architecture.
- Existing public models remain `*-v1`; schema changes require an ordered SQLite migration and migration regression coverage.
- Real production processing must never synthesize `Sample text`, mock OCR metadata, or a copied source string as a successful translation.
- The approved video directory is `C:/Users/PC/.gemini/antigravity/scratch/chinese_short_films`; it is read-only input.
- Batch artifacts go under ignored `outputs/real_video_ocr/` and evidence frames under that same tree.
- End this implementation ticket with test commands, exact exit codes, an independent reviewer verdict, and `STOPPED_AFTER_TICKET`.

## File Structure

- `src/subtitle_localizer/persistence/database.py`: schema version 2 migration and SQLite transaction helper.
- `src/subtitle_localizer/persistence/repository.py`: project-scoped atomic cue replacement.
- `src/subtitle_localizer/detector/sampler.py`: correct crop geometry, real decoded timestamps, and deterministic preprocessing candidates.
- `src/subtitle_localizer/ocr/rapid.py`: strict real-engine behavior with no mock fallback.
- `src/subtitle_localizer/ocr/registry.py`: explicit provider selection that never implicitly returns mock OCR.
- `src/subtitle_localizer/service/worker.py`: no fake frame/cue data, structured failures, provider cleanup, and retained valid empty result behavior.
- `src/subtitle_localizer/service/server.py`: persist a reviewed ROI before processing and return explicit validation failures.
- `scripts/run_real_video_batch.py`: controlled five-video runner, export writer, JSON report, and evidence-frame extraction.
- `tests/t12/test_real_video_hardening.py`: red-first regression tests for persistence, sampling, real-only provider behavior, and worker errors.
- `tests/t12/test_real_video_batch.py`: report/export contract tests using generated local video fixtures rather than external videos.
- `pyproject.toml`: reproducible pinned runtime dependencies and a batch-run entry point if the current packaging convention supports it.
- `.gitignore`: explicitly ignore `tests/fixtures/` media and `outputs/` artifacts.

---

### Task 1: Project-scoped cue identity and atomic replacement

**Files:**
- Modify: `src/subtitle_localizer/persistence/database.py:9-80`
- Modify: `src/subtitle_localizer/persistence/repository.py:124-152`
- Modify: `tests/t01/test_domain_persistence.py`
- Create: `tests/t12/test_real_video_hardening.py`

**Interfaces:**
- Consumes: `ProjectRepository.save_cues(project_id: str, cues: List[SubtitleCueV1]) -> None`.
- Produces: schema version 2 whose `cues` primary key is `(project_id, cue_id)`; failed cue replacement leaves the previous project cue set intact.

- [ ] **Step 1: Write the failing migration and multi-project tests**

```python
def test_two_projects_can_store_the_same_local_cue_id(tmp_path: Path) -> None:
    repo = make_repo(tmp_path / "projects.db")
    save_project(repo, "one")
    save_project(repo, "two")
    repo.save_cues("one", [cue("cue-0001", "字幕一")])
    repo.save_cues("two", [cue("cue-0001", "字幕二")])
    assert repo.get_cues("one")[0].source_text == "字幕一"
    assert repo.get_cues("two")[0].source_text == "字幕二"

def test_failed_cue_replacement_keeps_existing_cues(tmp_path: Path) -> None:
    repo = make_repo(tmp_path / "atomic.db")
    save_project(repo, "one")
    repo.save_cues("one", [cue("stable", "đang giữ")])
    with pytest.raises(sqlite3.IntegrityError):
        repo.save_cues("one", [cue("broken", ""), cue("broken", "trùng")])
    assert [item.cue_id for item in repo.get_cues("one")] == ["stable"]
```

- [ ] **Step 2: Run the focused tests and confirm the expected failures**

Run: `python -m pytest -q tests/t12/test_real_video_hardening.py -k "cue_id or cue_replacement"`

Expected: the first test fails with `UNIQUE constraint failed: cues.cue_id`; the second fails because autocommit leaves the old set deleted.

- [ ] **Step 3: Implement the minimal migration and explicit transaction**

```python
CURRENT_SCHEMA_VERSION = 2

MIGRATIONS[2] = """
ALTER TABLE cues RENAME TO cues_v1;
CREATE TABLE cues (..., project_id TEXT NOT NULL, cue_id TEXT NOT NULL, ..., PRIMARY KEY(project_id, cue_id), ...);
INSERT INTO cues (...) SELECT ... FROM cues_v1;
DROP TABLE cues_v1;
CREATE INDEX idx_cues_project_pts ON cues(project_id, start_pts);
"""

def save_cues(self, project_id: str, cues: List[SubtitleCueV1]) -> None:
    conn = self.db.get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM cues WHERE project_id = ?", (project_id,))
        # Insert each cue using the composite key.
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
```

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run: `python -m pytest -q tests/t12/test_real_video_hardening.py -k "cue_id or cue_replacement"`

Expected: PASS.

- [ ] **Step 5: Run adjacent persistence regression coverage**

Run: `python -m pytest -q tests/t01 tests/t05`

Expected: PASS.

- [ ] **Step 6: Commit the self-contained persistence change**

```powershell
git add src/subtitle_localizer/persistence/database.py src/subtitle_localizer/persistence/repository.py tests/t01 tests/t12/test_real_video_hardening.py
git commit -m "fix: scope cue identity to projects"
```

### Task 2: Correct real-frame sampling and OCR preprocessing candidates

**Files:**
- Modify: `src/subtitle_localizer/detector/sampler.py:1-82`
- Modify: `src/subtitle_localizer/ocr/preprocessing.py:1-22`
- Modify: `tests/t03/test_detector_roi.py`
- Modify: `tests/t04/test_ocr_runtime.py`
- Modify: `tests/t12/test_real_video_hardening.py`

**Interfaces:**
- Consumes: `AdaptiveFrameSampler.sample_video_frames(video_path, roi_norm, max_duration_seconds)`.
- Produces: crops whose right edge is computed from `rx + rw`, timestamps sourced from the decoder position, and `build_ocr_candidates(crop: numpy.ndarray) -> list[numpy.ndarray]`.

- [ ] **Step 1: Write failing ROI and preprocessing behavior tests**

```python
def test_non_square_roi_uses_width_for_x_end(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    sampler = AdaptiveFrameSampler(sample_fps=1)
    install_fake_capture(monkeypatch, width=100, height=100, frame=gradient_frame(100, 100))
    crops, _ = sampler.sample_video_frames(tmp_path / "video.mp4", roi_norm=(0.10, 0.70, 0.50, 0.10))
    assert crops[0].shape == (10, 50, 3)

def test_ocr_candidates_keep_original_and_return_images() -> None:
    crop = numpy.full((8, 12, 3), 120, dtype=numpy.uint8)
    candidates = build_ocr_candidates(crop)
    assert candidates[0] is crop
    assert all(item.shape[:2] == crop.shape[:2] for item in candidates)
```

- [ ] **Step 2: Run the focused tests and confirm the ROI test fails**

Run: `python -m pytest -q tests/t12/test_real_video_hardening.py -k "non_square_roi or ocr_candidates"`

Expected: the ROI assertion fails because the current right endpoint uses `rw + rh`; the candidate function is absent.

- [ ] **Step 3: Implement the smallest correct sampler and candidates**

```python
x2 = min(width, int(width * (rx + rw)))

pts = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
if pts < 0:
    pts = curr_frame_idx / fps

def build_ocr_candidates(crop: numpy.ndarray) -> list[numpy.ndarray]:
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    contrast = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)
    _, threshold = cv2.threshold(contrast, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return [crop, contrast, threshold]
```

Use the decoded timestamp only when it is finite and non-negative; retain the frame-index value as a documented CFR fallback.

- [ ] **Step 4: Run focused and adjacent sampling/OCR tests**

Run: `python -m pytest -q tests/t03 tests/t04 tests/t12/test_real_video_hardening.py -k "roi or candidates or sampler"`

Expected: PASS.

- [ ] **Step 5: Commit the self-contained sampler change**

```powershell
git add src/subtitle_localizer/detector/sampler.py src/subtitle_localizer/ocr/preprocessing.py tests/t03 tests/t04 tests/t12/test_real_video_hardening.py
git commit -m "fix: crop and preprocess real subtitle frames"
```

### Task 3: Make production OCR and worker failures explicit

**Files:**
- Modify: `src/subtitle_localizer/ocr/rapid.py:20-108`
- Modify: `src/subtitle_localizer/ocr/paddle.py:27-83`
- Modify: `src/subtitle_localizer/ocr/registry.py:10-35`
- Modify: `src/subtitle_localizer/service/worker.py:26-123`
- Modify: `src/subtitle_localizer/translation/real.py:36-78`
- Modify: `tests/t04/test_ocr_runtime.py`
- Modify: `tests/t07/test_service_worker.py`
- Modify: `tests/t12/test_real_video_hardening.py`

**Interfaces:**
- Consumes: `OcrProvider.load()`, `OcrProvider.recognize(crops, pts_list, language)`, and `BackgroundWorker.run_pipeline_synchronous(project_id)`.
- Produces: real providers raise descriptive `RuntimeError` on unavailable engines; worker saves a failed `StageRunV1(errors=[...])` and always unloads loaded providers.

- [ ] **Step 1: Write failing real-only and failure-recording tests**

```python
def test_rapid_ocr_rejects_invalid_encoded_bytes_instead_of_mocking(monkeypatch: pytest.MonkeyPatch) -> None:
    provider = RapidOcrProvider()
    provider.is_loaded = True
    provider.engine = object()
    with pytest.raises(RuntimeError, match="valid image"):
        provider.recognize([b"not-an-image"], [1.0], "zh")

def test_worker_records_provider_failure_and_unloads(monkeypatch: pytest.MonkeyPatch, repo: ProjectRepository) -> None:
    save_real_video_project(repo)
    failing = FailingProvider()
    monkeypatch.setattr(worker.ocr_registry, "get_provider_for_language", lambda _: failing)
    assert worker.run_pipeline_synchronous("real-project") is False
    assert failing.unloaded is True
    assert repo.get_stage_runs("real-project")[-1].errors == ["OCR unavailable"]
```

- [ ] **Step 2: Run the focused tests and confirm the expected failures**

Run: `python -m pytest -q tests/t12/test_real_video_hardening.py -k "invalid_encoded_bytes or provider_failure"`

Expected: current RapidOCR returns mock output or silently continues; worker raises `TypeError` for `error_message`.

- [ ] **Step 3: Implement strict provider/worker behavior**

```python
if image is None or image.size == 0:
    raise RuntimeError("RapidOCR received an invalid decoded image")

def get_provider_for_language(self, language: str) -> OcrProvider:
    provider = self._providers.get("rapidocr")
    if provider is None:
        raise RuntimeError("No production OCR provider is registered")
    return provider

try:
    provider.load()
    observations = provider.recognize(...)
finally:
    provider.unload()

stage_err = StageRunV1(
    stage_name="pipeline", status="failed", progress=0.0,
    errors=[str(error)], end_time=time.time(),
)
```

Require a readable video before sampling. Remove every mock timeline/crop fallback. Keep a completed empty cue list only when decoding and real OCR actually run. Make translation errors explicit and leave `translated_text` empty rather than copying source text.

- [ ] **Step 4: Run the worker/OCR tests**

Run: `python -m pytest -q tests/t04 tests/t07 tests/t12/test_real_video_hardening.py`

Expected: PASS.

- [ ] **Step 5: Commit the self-contained real-only behavior change**

```powershell
git add src/subtitle_localizer/ocr src/subtitle_localizer/service/worker.py src/subtitle_localizer/translation/real.py tests/t04 tests/t07 tests/t12/test_real_video_hardening.py
git commit -m "fix: reject mock OCR output in production pipeline"
```

### Task 4: Persist reviewed ROI and declare runtime dependencies

**Files:**
- Modify: `src/subtitle_localizer/service/server.py:113-156`
- Modify: `web/src/api/client.ts:63-98`
- Modify: `web/src/components/editor/EditorView.tsx:20-235`
- Modify: `pyproject.toml`
- Modify: `tests/t07/test_service_worker.py`
- Modify: `tests/t12/test_real_video_hardening.py`

**Interfaces:**
- Consumes: `PUT /api/v1/projects/{project_id}/regions` with a `RegionTrackV1` list and `StudioApiClient.saveRegions(projectId, regions)`.
- Produces: persisted regions used by the next worker run; project Python dependencies specified with minimum supported versions.

- [ ] **Step 1: Write failing API persistence and manifest tests**

```python
def test_saved_roi_is_used_by_next_pipeline_run(client: TestClient, repo: ProjectRepository) -> None:
    project_id = create_project(client, readable_video_path)
    region = {"region_id": "reviewed", "x": 0.1, "y": 0.72, "width": 0.8, "height": 0.2}
    assert client.put(f"/api/v1/projects/{project_id}/regions", json=[region], headers=AUTH).status_code == 200
    assert repo.get_project(project_id).regions[0].region_id == "reviewed"

def test_pyproject_declares_server_and_real_ocr_dependencies() -> None:
    dependencies = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))["project"]["dependencies"]
    assert {"fastapi", "uvicorn", "opencv-python", "rapidocr-onnxruntime", "python-multipart"} <= {item.split(">=")[0] for item in dependencies}
```

- [ ] **Step 2: Run the focused tests and confirm expected failures**

Run: `python -m pytest -q tests/t12/test_real_video_hardening.py -k "saved_roi or pyproject"`

Expected: API returns 404 and dependencies key is absent.

- [ ] **Step 3: Implement the small region API/UI bridge and dependencies**

```python
@app.put("/api/v1/projects/{project_id}/regions")
async def save_regions(project_id: str, regions: List[Dict[str, Any]], ...):
    manifest = require_project(project_id)
    manifest.regions = [RegionTrackV1.from_dict(region) for region in regions]
    repository.save_project(manifest)
    return [region.to_dict() for region in manifest.regions]
```

Save the changed editor ROI before `runPipeline`; show the request failure in the existing status message and do not start a run if the save fails. Add only runtime dependencies already imported by production code, with minimum versions verified in the current environment.

- [ ] **Step 4: Run API/UI-contract tests and build**

Run: `python -m pytest -q tests/t07 tests/t12/test_real_video_hardening.py`

Run: `npm run build` from `web`

Expected: both commands PASS.

- [ ] **Step 5: Commit the API/UI/dependency change**

```powershell
git add src/subtitle_localizer/service/server.py web/src/api/client.ts web/src/components/editor/EditorView.tsx pyproject.toml tests/t07 tests/t12/test_real_video_hardening.py
git commit -m "fix: persist OCR region and declare runtime dependencies"
```

### Task 5: Add controlled batch runner and artifact contracts

**Files:**
- Create: `scripts/run_real_video_batch.py`
- Create: `tests/t12/test_real_video_batch.py`
- Modify: `.gitignore`
- Modify: `pyproject.toml`

**Interfaces:**
- Consumes: `python scripts/run_real_video_batch.py --input-dir PATH --output-dir PATH --language zh --no-translate`.
- Produces: `<stem>.zh.srt`, `<stem>.zh.ass`, `<stem>.report.json`, and selected JPEG evidence frames for each readable MP4.

- [ ] **Step 1: Write failing batch artifact tests using a generated tiny video**

```python
def test_batch_runner_writes_parseable_report_and_utf8_exports(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    input_dir = create_tiny_mp4(tmp_path / "input")
    output_dir = tmp_path / "out"
    monkeypatch.setattr(batch, "run_project_ocr", deterministic_real_ocr)
    exit_code = batch.main(["--input-dir", str(input_dir), "--output-dir", str(output_dir), "--language", "zh", "--no-translate"])
    report = json.loads((output_dir / "clip" / "clip.report.json").read_text(encoding="utf-8"))
    assert exit_code == 0
    assert report["ocr_engine"] == "rapidocr-onnx"
    assert "Sample text" not in (output_dir / "clip" / "clip.zh.srt").read_text(encoding="utf-8")
    assert (output_dir / "clip" / "clip.zh.ass").exists()
```

- [ ] **Step 2: Run the focused test and confirm it fails because the runner is missing**

Run: `python -m pytest -q tests/t12/test_real_video_batch.py`

Expected: FAIL with import or module-not-found error for `run_real_video_batch`.

- [ ] **Step 3: Implement deterministic batch orchestration**

```python
def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    inputs = sorted(args.input_dir.glob("*.mp4"))
    if not inputs:
        raise SystemExit("No .mp4 files found")
    results = [run_one_video(path, args) for path in inputs]
    return 0 if all(item["status"] == "completed" for item in results) else 1
```

For each file, create a unique SQLite database beneath the managed output directory, create a project with the absolute input path, run the real-only worker, write source-language SRT/ASS, save up to two cue evidence frames, and serialize a report with engine, duration, cue count, timestamps, confidence values, elapsed seconds, warning list, and status. Use atomic writes to temp files followed by `Path.replace`. Never invoke translation unless the operator omits `--no-translate`.

- [ ] **Step 4: Run batch unit tests**

Run: `python -m pytest -q tests/t12/test_real_video_batch.py`

Expected: PASS.

- [ ] **Step 5: Extend ignore rules and validate generated artifacts are ignored**

```gitignore
/outputs/
/tests/fixtures/*
!/tests/fixtures/.gitkeep
```

Run: `git check-ignore -v outputs/real_video_ocr/example/example.zh.srt tests/fixtures/real_test_video.mp4`

Expected: both paths are ignored.

- [ ] **Step 6: Commit the batch runner**

```powershell
git add scripts/run_real_video_batch.py tests/t12/test_real_video_batch.py .gitignore pyproject.toml
git commit -m "feat: batch real-video OCR evidence runner"
```

### Task 6: Run the approved sample set and assemble evidence

**Files:**
- Create: `docs/evidence/T12_EVIDENCE.md`
- Modify: `docs/evidence/RELEASE_EVIDENCE.md`

**Interfaces:**
- Consumes: `scripts/run_real_video_batch.py` and the approved external input directory.
- Produces: ignored artifacts under `outputs/real_video_ocr/` and committed evidence containing only relative artifact paths, SHA-256 values, counts, commands, and exit codes.

- [ ] **Step 1: Run a 60-second real-engine smoke test on the shortest video**

Run: `python scripts/run_real_video_batch.py --input-dir "C:/Users/PC/.gemini/antigravity/scratch/chinese_short_films" --output-dir outputs/real_video_ocr/smoke --language zh --no-translate --max-duration 60 --limit 1`

Expected: exit `0`, no report uses `mock`, no subtitle contains `Sample text`, and report includes at least one evidence-frame path when text is found.

- [ ] **Step 2: Visually inspect the smoke evidence frames and cue text**

Open the JPEG evidence frames and compare their hard subtitles with each report `sample_cues[].source_text`. Record exact timestamps and whether the text is correct, partially correct, or incorrect. If fewer than two non-empty cues are available, record the engine/ROI diagnostic instead of asserting success.

- [ ] **Step 3: Run all five approved videos without translation**

Run: `python scripts/run_real_video_batch.py --input-dir "C:/Users/PC/.gemini/antigravity/scratch/chinese_short_films" --output-dir outputs/real_video_ocr/chinese --language zh --no-translate`

Expected: exit `0`; five reports plus source-language SRT/ASS outputs; each report lists elapsed seconds and an explicit result state.

- [ ] **Step 4: Perform ten visual cue spot checks across the reports**

For every video, inspect at least two evidence frames. Mark each cue as correct, partial, or incorrect in `T12_EVIDENCE.md`. Do not compute CER or claim a quality percentage without transcribed ground truth.

- [ ] **Step 5: Run the full regression and quality commands**

Run: `python -m pytest -q`

Run: `python -m compileall -q src scripts`

Run: `python scripts/t00/utf8_scan.py .`

Run: `npm run build` from `web`

Run: `git diff --check`

Expected: each command exits `0`.

- [ ] **Step 6: Write evidence without committing generated artifacts**

Record the exact commands, exit codes, relevant software versions, per-video runtime/cue count, report SHA-256 values, spot-check table, any errors, and known scope exclusions in `docs/evidence/T12_EVIDENCE.md`. Update the overall release evidence status to `NOT_RELEASE_READY` until the worker-process, security, render, and real-ground-truth gates are completed.

- [ ] **Step 7: Commit evidence only**

```powershell
git add docs/evidence/T12_EVIDENCE.md docs/evidence/RELEASE_EVIDENCE.md
git commit -m "docs: record real-video OCR hardening evidence"
```

## Plan Self-Review

- Spec coverage: Tasks 1–4 implement project-safe persistence, ROI, strict providers, errors, cleanup, dependencies, and UI-region persistence. Task 5 provides managed batch outputs. Task 6 executes all five videos, performs spot checks, and records evidence. Separate-process execution, cancellation, MP4 burn-in, and CER claims are excluded by the approved spec.
- Placeholder scan: plan steps name exact files, interfaces, commands, tests, and expected outcomes; no deferred implementation marker remains.
- Type consistency: `save_cues`, `sample_video_frames`, `get_provider_for_language`, `run_pipeline_synchronous`, `saveRegions`, and the batch CLI are defined once and used consistently by later tasks.
