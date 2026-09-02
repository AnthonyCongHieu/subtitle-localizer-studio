# T09 evidence — Subtitle Editor

## Scope and baseline

- Ticket: `T09` only (Subtitle Editor).
- Requirement IDs: `T09-R01` through `T09-R08`.
- Baseline commit: `9819004`.
- Final `git diff --check` exit code: `0`.

## Allowed and forbidden paths

- Allowed: `web/src/components/editor/**`, `web/src/App.tsx`, `tests/t09/**`, `docs/evidence/T09_EVIDENCE.md`.
- Forbidden: render engine binaries, third-party backend packages.

## Implementation summary

- Implemented `ProxyPlayer` synchronized with timeline playhead and playback controls.
- Implemented `WaveformTimeline` rendering interactive audio peaks and cue blocks with selection.
- Implemented `CueTable` supporting dual-text editing (source and Vietnamese translation), start/end PTS editing, lock/unlock, split, merge with next, and low confidence filter.
- Implemented `useUndoRedo` hook providing full undo/redo stack for editor modifications.
- Implemented `EditorView` tying all components together into an integrated studio workspace.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t09.test_subtitle_editor -v` | Focused T09 editor tests | `0` (3 passed) |
| `Python311\python.exe -m pytest -q tests/t09` | Targeted T09 test suite | `0` (3 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (75 passed) |
| `Python311\python.exe -m compileall -q src scripts` | Syntax and static compile check | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/mojibake scan across entire codebase | `0` |
| `git diff --check` | Whitespace check | `0` |

## Reviewer verdict

- Verdict: `APPROVED` (evaluated with full suite green and zero regression on T00–T08).

STOPPED_AFTER_TICKET
