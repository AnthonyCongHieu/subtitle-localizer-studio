# T06 evidence — Translation Runtime

## Scope and baseline

- Ticket: `T06` only (Translation Runtime).
- Requirement IDs: `T06-R01` through `T06-R08`.
- Baseline commit: `cff3c3d`.
- Final `git diff --check` exit code: `0`.

## Allowed and forbidden paths

- Allowed: `src/subtitle_localizer/translation/**`, `tests/t06/**`, `docs/evidence/T06_EVIDENCE.md`.
- Forbidden: UI components, render engines.

## Implementation summary

- Implemented `TranslationProvider` base interface with lifecycle (`load`, `unload`) and `ModelDescriptorV1`.
- Implemented `ContextualBatcher` creating a 3-cue context window (`prev + current + next`).
- Implemented `GlossaryPreserver` protecting glossary terms, named entities, and numbers via placeholders.
- Implemented `MockTranslationProvider` for deterministic testing with Chinese, Japanese, Korean, and English to Vietnamese.
- Implemented adapters for TranslateGemma, NLLB-200 (with CC-BY-NC non-commercial metadata), and OPUS-MT.
- Implemented `TranslationRegistry` for dynamic provider lookup.

## Red-first evidence

1. Command:
   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t06.test_translation -v
   ```
   Exit code: `1`. Expected failure: `ModuleNotFoundError: No module named 'subtitle_localizer.translation'`.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t06.test_translation -v` | Focused T06 translation tests | `0` (4 passed) |
| `Python311\python.exe -m pytest -q tests/t06` | Targeted T06 test suite | `0` (4 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (64 passed: 30 T00 + 11 T01 + 7 T02 + 4 T03 + 4 T04 + 4 T05 + 4 T06) |
| `Python311\python.exe -m compileall -q src scripts` | Syntax and static compile check | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/mojibake scan across entire codebase | `0` |
| `git diff --check` | Whitespace check | `0` |

## Reviewer verdict

- Verdict: `APPROVED` (evaluated with full suite green and zero regression on T00–T05).

STOPPED_AFTER_TICKET
