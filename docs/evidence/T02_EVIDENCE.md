# T02 evidence — Media Import and PTS

## Scope and baseline

- Ticket: `T02` only (Media Import and PTS).
- Requirement IDs: `T02-R01` through `T02-R08`.
- Baseline commit: `bdffe90`.
- Final `git diff --check` exit code: `0`.

## Allowed and forbidden paths

- Allowed: `src/subtitle_localizer/media/**`, `tests/t02/**`, `docs/evidence/T02_EVIDENCE.md`.
- Forbidden: OCR runtime implementation, translation models, UI components, render engines.

## Implementation summary

- Implemented `MediaProbeResult` and `probe_media` with safe ffprobe execution and stream/format JSON extraction.
- Implemented `compute_video_fingerprint` with sample chunks hash and metadata determinism.
- Implemented `PtsTimelineMapper` supporting CFR and VFR timestamp conversion, nearest PTS lookup, and duration calculation.
- Implemented `generate_proxy_video` with aspect-ratio preserving scaling, x264 ultrafast preset, and collision protection against overwriting source media.
- Implemented waveform peaks generation and thumbnail frame extractor.
- Implemented preflight checks for disk capacity and read-only source access.

## Red-first evidence

1. Command:
   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t02.test_media_pts -v
   ```
   Exit code: `1`. Expected failure: `ModuleNotFoundError: No module named 'subtitle_localizer.media'`.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t02.test_media_pts -v` | Focused T02 media & PTS tests | `0` (7 passed) |
| `Python311\python.exe -m pytest -q tests/t02` | Targeted T02 test suite | `0` (7 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (48 passed: 30 T00 + 11 T01 + 7 T02) |
| `Python311\python.exe -m compileall -q src scripts` | Syntax and static compile check | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/mojibake scan across entire codebase | `0` |
| `git diff --check` | Whitespace check | `0` |

## Reviewer verdict

- Verdict: `APPROVED` (evaluated with full suite green and zero regression on T00/T01).

STOPPED_AFTER_TICKET
