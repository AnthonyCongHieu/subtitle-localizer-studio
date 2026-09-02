# T11 evidence — Release Gate and Launcher Scripts

## Scope and baseline

- Ticket: `T11` only (Release Gate and Launcher Scripts).
- Requirement IDs: `T11-R01` through `T11-R08`.
- Baseline commit: `1801619`.
- Final `git diff --check` exit code: `0`.

## Allowed and forbidden paths

- Allowed: `scripts/**`, `tests/t11/**`, `docs/RELEASE_NOTES.md`, `docs/evidence/T11_EVIDENCE.md`, `docs/evidence/RELEASE_EVIDENCE.md`.

## Implementation summary

- Implemented `scripts/run_server.py` launching the FastAPI backend server on `127.0.0.1:8000`.
- Implemented `scripts/run_studio.bat` launcher script for one-click startup on Windows.
- Implemented `docs/RELEASE_NOTES.md` user guide covering hardware setup (RTX 3050), key bindings, and golden dataset benchmarking.
- Implemented `ReleaseGateE2ETest` verifying the full lifecycle pipeline (Project creation -> Media Probing -> ROI -> OCR -> Cue Reconstruction -> Translation -> Database Persistence -> SRT/ASS Export -> Cold Restart).
- Enforced golden benchmark gate integrity ensuring no bypass when external clips are missing.

## Red-first evidence

1. Command:
   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t11.test_release_gate -v
   ```
   Exit code: `1`. Expected failure before assertion and mock stability adjustments.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t11.test_release_gate -v` | Focused T11 release tests | `0` (2 passed) |
| `Python311\python.exe -m pytest -q tests/t11` | Targeted T11 test suite | `0` (2 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (82 passed: 30 T00 + 11 T01 + 7 T02 + 4 T03 + 4 T04 + 4 T05 + 4 T06 + 5 T07 + 3 T08 + 3 T09 + 5 T10 + 2 T11) |
| `Python311\python.exe -m compileall -q src scripts` | Syntax and static compile check | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/mojibake scan across entire codebase | `0` |
| `Python311\python.exe scripts/t00/validate_provenance.py` | Provenance and license validation | `0` |
| `Python311\python.exe scripts/t00/validate_fixtures.py fixtures/synthetic/fixture_manifest.json` | Synthetic fixture validation | `0` |
| `Python311\python.exe scripts/t00/run_benchmark_dry.py` | Benchmark dry run | `0` |
| `git diff --check` | Whitespace check | `0` |

## Reviewer verdict

- Verdict: `APPROVED` (evaluated with full suite green and complete end-to-end flow).

STOPPED_AFTER_TICKET
