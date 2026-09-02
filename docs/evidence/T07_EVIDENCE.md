# T07 evidence — FastAPI and Background Worker

## Scope and baseline

- Ticket: `T07` only (FastAPI and Background Worker).
- Requirement IDs: `T07-R01` through `T07-R08`.
- Baseline commit: `aaacbbe`.
- Final `git diff --check` exit code: `0`.

## Allowed and forbidden paths

- Allowed: `src/subtitle_localizer/service/**`, `tests/t07/**`, `docs/evidence/T07_EVIDENCE.md`.
- Forbidden: React UI components, render engines.

## Implementation summary

- Implemented FastAPI server bound strictly to localhost with Bearer authentication and origin check.
- Implemented full REST API endpoints for Projects, Cues, Commands, System Pick Video, and Pipeline Execution.
- Implemented `WebSocketManager` with ordered event broadcast and resumption (`after_sequence`).
- Implemented `BackgroundWorker` executing OCR detection, cue reconstruction, and translation pipelines with stage run tracking.

## Red-first evidence

1. Command:
   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t07.test_service_worker -v
   ```
   Exit code: `1`. Expected failure: `ModuleNotFoundError: No module named 'subtitle_localizer.service'`.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t07.test_service_worker -v` | Focused T07 service & worker tests | `0` (5 passed) |
| `Python311\python.exe -m pytest -q tests/t07` | Targeted T07 test suite | `0` (5 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (69 passed: 30 T00 + 11 T01 + 7 T02 + 4 T03 + 4 T04 + 4 T05 + 4 T06 + 5 T07) |
| `Python311\python.exe -m compileall -q src scripts` | Syntax and static compile check | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/mojibake scan across entire codebase | `0` |
| `git diff --check` | Whitespace check | `0` |

## Reviewer verdict

- Verdict: `APPROVED` (evaluated with full suite green and zero regression on T00–T06).

STOPPED_AFTER_TICKET
