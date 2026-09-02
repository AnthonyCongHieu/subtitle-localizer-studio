# T12 Real-Video OCR Hardening — Design Specification

## Goal

Make the existing Chinese hard-subtitle pipeline produce trustworthy, non-mock
SRT and ASS output for the five approved sample videos under
`C:/Users/PC/.gemini/antigravity/scratch/chinese_short_films`.

The ticket is successful only when real OCR runs against decoded video frames,
fake fallback text cannot enter production results, failures are explicit, and
the generated subtitles can be spot-checked against source frames.

## Approved sample set

The validation set contains five H.264/AAC, 1920x1080 videos:

1. `01_Three_Minutes_TranKhaTan.mp4` — 435.88 seconds, 25 fps.
2. `02_Daughter_ChauTan.mp4` — 500.09 seconds, 25 fps.
3. `03_Escape_From_The_British_Museum_Ep1.mp4` — 163.84 seconds, 30 fps.
4. `04_Escape_From_The_British_Museum_Ep2.mp4` — 279.75 seconds, 30 fps.
5. `05_Escape_From_The_British_Museum_Ep3_KetThuc.mp4` — 578.99 seconds, 30 fps.

The videos remain outside Git. Generated crops, caches, databases, subtitle
files, and reports must also remain outside Git or in ignored output paths.

## Scope

This ticket hardens the existing synchronous pipeline sufficiently for a
controlled local batch run. A separate persistent worker process, cancellation,
restart recovery, UI E2E automation, and MP4 burn-in remain separate tickets.

The ticket includes:

- real Chinese OCR selection and capability validation;
- removal of production mock/sample-text fallbacks;
- correct ROI cropping and persisted ROI use;
- collision-free cue persistence across multiple projects;
- explicit pipeline errors and guaranteed model cleanup;
- reproducible Python runtime dependencies;
- batch processing of the five approved videos;
- UTF-8 SRT and ASS output plus a machine-readable run report;
- visual spot checks linking representative frames to recognized text.

## OCR quality strategy

RapidOCR remains the initial real engine because it is already installed and
uses Apache-2.0 ONNX models. The implementation must expose the engine identity
in every observation and fail if the real engine is unavailable. PaddleOCR may
be benchmarked as a second candidate only if RapidOCR spot checks are visibly
unacceptable; it must not be silently selected or downloaded during normal
application startup.

Frames are sampled from real decoder positions with timestamps obtained from
the decoder or probed PTS rather than fabricated test timestamps. The configured
subtitle ROI is cropped with `(x, y, width, height)` semantics. OCR preprocessing
uses a small deterministic candidate set suitable for subtitle text (original,
contrast/grayscale, and thresholded variants). The best non-empty candidate is
selected by confidence, while temporal consensus suppresses one-frame noise.

Quality is evaluated in two layers:

1. Automated integrity gates: no mock metadata or `Sample text` output, valid
   monotonic timings, non-empty UTF-8 Chinese text, stable cue IDs, and
   reproducible exports.
2. Visual spot checks: at least ten representative cues across the five videos
   are compared with extracted source frames. The report records recognized
   text, timestamp, confidence, engine, and frame path. Without human-authored
   ground truth this ticket does not claim a CER percentage.

## Data and persistence

Cue identity must be project-safe. The preferred minimal migration changes the
SQLite key from global `cue_id` to composite `(project_id, cue_id)` while
preserving existing rows. Repository writes must be atomic and a failed batch
must not delete the previous cue set.

The worker must reject missing/unreadable video files. Empty OCR output is a
valid completed result only when real frames were decoded and the report marks
that no text was found. Provider initialization or inference failures produce a
failed stage with structured errors; they never generate mock cues.

## Batch outputs

Each input video gets a managed output directory containing:

- `<video-stem>.zh.srt` with recognized Chinese text;
- `<video-stem>.zh.ass` with recognized Chinese text;
- `<video-stem>.report.json` with runtime, counts, engine, warnings, and sample
  evidence;
- selected JPEG evidence frames used for visual review.

Translation quality is not mixed into the OCR acceptance decision. Vietnamese
translation may run after OCR succeeds, but any network/provider failure must be
reported explicitly rather than copying Chinese source text and calling it a
translation.

## API and UI behavior

The existing UI remains compatible. ROI changes must be persisted before a run.
Pipeline responses must expose a concrete error when the video, OCR engine, or
translation provider is unavailable. The UI must not report success for a
failed stage or for mock-generated content.

## Testing and verification

Implementation follows red-green TDD. Required regression coverage includes:

- two projects may both store `cue-0001`;
- non-square ROI crops use `rx + rw` for the X endpoint;
- production registry never returns a mock provider implicitly;
- missing video and OCR initialization errors record a failed stage;
- provider unload executes after success and failure;
- real-video smoke test emits observations without mock markers;
- batch outputs are valid UTF-8 and parseable SRT/ASS/JSON;
- existing Python tests and the frontend production build remain green;
- mojibake/replacement-character scan remains clean.

Final evidence records exact commands, exit codes, per-video runtime, cue count,
warnings, and paths to generated artifacts. The reviewer verdict must be
`APPROVED` before the ticket ends with `STOPPED_AFTER_TICKET`.

## Non-goals

- No claim of 95% recall or an OCR CER threshold without ground truth.
- No fake subtitles to make demos appear successful.
- No MP4 masking/burn-in implementation in this ticket.
- No new frontend framework or state-management architecture.
- No commit of videos, models, caches, databases, outputs, or secrets.
