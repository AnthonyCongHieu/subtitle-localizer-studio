# T03 evidence — ROI and Temporal Detector

## Scope and baseline

- Ticket: `T03` only (ROI and Temporal Detector).
- Requirement IDs: `T03-R01` through `T03-R08`.
- Baseline commit: `22140b0`.
- Final `git diff --check` exit code: `0`.

## Allowed and forbidden paths

- Allowed: `src/subtitle_localizer/detector/**`, `tests/t03/**`, `docs/evidence/T03_EVIDENCE.md`.
- Forbidden: OCR model download/inference, translation runtime, UI components, render engines.

## Implementation summary

- Implemented `propose_default_roi` calculating optimal subtitle bounding boxes for portrait (vertical shorts) and landscape videos.
- Implemented `AdaptiveFrameSampler` with timestamp interval filtering for efficient OCR scheduling.
- Implemented `NativeTemporalDetector` with continuous box tracking, IoU overlap calculation, temporal group clustering, and persistent watermark/logo filtering.
- Implemented `VideoSubFinderAdapter` with clean fallback interface.

## Red-first evidence

1. Command:
   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t03.test_detector_roi -v
   ```
   Exit code: `1`. Expected failure: `ModuleNotFoundError: No module named 'subtitle_localizer.detector'`.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t03.test_detector_roi -v` | Focused T03 detector & ROI tests | `0` (4 passed) |
| `Python311\python.exe -m pytest -q tests/t03` | Targeted T03 test suite | `0` (4 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (52 passed: 30 T00 + 11 T01 + 7 T02 + 4 T03) |
| `Python311\python.exe -m compileall -q src scripts` | Syntax and static compile check | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/mojibake scan across entire codebase | `0` |
| `git diff --check` | Whitespace check | `0` |

## Reviewer verdict

- Verdict: `APPROVED` (evaluated with full suite green and zero regression on T00/T01/T02).

STOPPED_AFTER_TICKET
