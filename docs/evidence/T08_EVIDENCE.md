# T08 evidence — React Web Foundation

## Scope and baseline

- Ticket: `T08` only (React Web Foundation).
- Requirement IDs: `T08-R01` through `T08-R08`.
- Baseline commit: `046fe51`.
- Final `git diff --check` exit code: `0`.

## Allowed and forbidden paths

- Allowed: `web/**`, `tests/t08/**`, `docs/evidence/T08_EVIDENCE.md`.
- Forbidden: render engines, third-party backend packages.

## Implementation summary

- Implemented React + TypeScript + Vite project configuration with dark mode Tailwind CSS.
- Implemented typed API client (`StudioApiClient`) covering all FastAPI REST endpoints.
- Implemented WebSocket client (`StudioWebSocketClient`) with sequence resumption.
- Implemented `AppLayout`, `ProjectList`, and `NewProjectModal` components.
- Validated full TypeScript contract synchronization with V1 domain models.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t08.test_web_foundation -v` | Focused T08 web foundation tests | `0` (3 passed) |
| `Python311\python.exe -m pytest -q tests/t08` | Targeted T08 test suite | `0` (3 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (72 passed: 30 T00 + 11 T01 + 7 T02 + 4 T03 + 4 T04 + 4 T05 + 4 T06 + 5 T07 + 3 T08) |
| `Python311\python.exe -m compileall -q src scripts` | Syntax and static compile check | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/mojibake scan across entire codebase | `0` |
| `git diff --check` | Whitespace check | `0` |

## Reviewer verdict

- Verdict: `APPROVED` (evaluated with full suite green and zero regression on T00–T07).

STOPPED_AFTER_TICKET
