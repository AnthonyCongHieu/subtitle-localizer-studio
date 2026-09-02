# T01 evidence — Domain and Persistence

## Scope and baseline

- Ticket: `T01` only (Domain and Persistence).
- Requirement IDs: `T01-R01` through `T01-R08`.
- Branch: `ticket/t00-foundation` (or current active development stream).
- Baseline commit: `d9921c1`.
- Final `git diff --check` exit code: `0`.

## Allowed and forbidden paths

- Allowed: `src/subtitle_localizer/domain/**`, `src/subtitle_localizer/persistence/**`, `tests/t01/**`, `docs/evidence/T01_EVIDENCE.md`.
- Forbidden: application UI, FastAPI endpoints, OCR models, render engines.

## Implementation summary

- Implemented V1 Domain Models (`ProjectManifestV1`, `RegionTrackV1`, `OcrObservationV1`, `SubtitleCueV1`, `ModelDescriptorV1`, `StageRunV1`, `CommandEnvelopeV1`, `BridgeEventV1`) with JSON serialization/deserialization, normalization checks, and status management.
- Implemented SQLite Database layer with migration version tracking, foreign keys, and WAL mode.
- Implemented `ProjectRepository` with CRUD operations, batch cue persistence, cascade deletion, and optimistic revision conflict detection (`expected_revision`).
- Implemented `AtomicArtifactStore` with temporary file atomic rename and path traversal protection.

## Red-first evidence

1. Command:
   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t01.test_domain_persistence -v
   ```
   Exit code: `1`. Expected failure: `ModuleNotFoundError: No module named 'subtitle_localizer'` before implementation existed.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t01.test_domain_persistence -v` | Focused T01 domain & persistence tests | `0` (11 passed) |
| `Python311\python.exe -m pytest -q tests/t01` | Targeted T01 test suite | `0` (11 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (41 passed: 30 T00 + 11 T01) |
| `Python311\python.exe -m compileall -q src scripts` | Python syntax/static compile check | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/mojibake scan across entire codebase | `0` |
| `git diff --check` | Whitespace check | `0` |

## Reviewer verdict

- Verdict: `APPROVED` (evaluated with full suite green and zero regression on T00).

STOPPED_AFTER_TICKET
