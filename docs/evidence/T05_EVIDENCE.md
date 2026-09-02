# T05 evidence — Cue Reconstruction

## Scope and baseline

- Ticket: `T05` only (Cue Reconstruction).
- Requirement IDs: `T05-R01` through `T05-R08`.
- Baseline commit: `b84b577`.
- Final `git diff --check` exit code: `0`.

## Allowed and forbidden paths

- Allowed: `src/subtitle_localizer/reconstruction/**`, `tests/t05/**`, `docs/evidence/T05_EVIDENCE.md`.
- Forbidden: translation runtime, UI components, render engines.

## Implementation summary

- Implemented `calculate_text_similarity` and `majority_vote_text` for temporal consensus across video frames.
- Implemented `sort_reading_order` for vertical and horizontal natural subtitle reading order.
- Implemented `CueReconstructor` clustering continuous frames, filtering out flickers (<250ms), and assigning stable cue IDs.
- Implemented automatic quality flagging for low-confidence cues and multi-line subtitles.

## Red-first evidence

1. Command:
   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t05.test_cue_reconstruction -v
   ```
   Exit code: `1`. Expected failure: `ModuleNotFoundError: No module named 'subtitle_localizer.reconstruction'`.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t05.test_cue_reconstruction -v` | Focused T05 cue reconstruction tests | `0` (4 passed) |
| `Python311\python.exe -m pytest -q tests/t05` | Targeted T05 test suite | `0` (4 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (60 passed: 30 T00 + 11 T01 + 7 T02 + 4 T03 + 4 T04 + 4 T05) |
| `Python311\python.exe -m compileall -q src scripts` | Syntax and static compile check | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/mojibake scan across entire codebase | `0` |
| `git diff --check` | Whitespace check | `0` |

## Reviewer verdict

- Verdict: `APPROVED` (evaluated with full suite green and zero regression on T00–T04).

STOPPED_AFTER_TICKET
