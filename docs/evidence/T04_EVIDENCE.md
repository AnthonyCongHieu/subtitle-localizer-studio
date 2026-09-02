# T04 evidence — OCR Runtime

## Scope and baseline

- Ticket: `T04` only (OCR Runtime).
- Requirement IDs: `T04-R01` through `T04-R08`.
- Baseline commit: `f1c4212`.
- Final `git diff --check` exit code: `0`.

## Allowed and forbidden paths

- Allowed: `src/subtitle_localizer/ocr/**`, `tests/t04/**`, `docs/evidence/T04_EVIDENCE.md`.
- Forbidden: translation runtime, UI components, render engines.

## Implementation summary

- Implemented `OcrProvider` base interface with model lifecycle (`load`, `unload`) and `ModelDescriptorV1` metadata.
- Implemented `MockOcrProvider` for deterministic offline testing with Chinese, Japanese, Korean, and English.
- Implemented `PaddleOcrAdapter` integrating PaddleOCR v6/v5 with lazy loading and safety against missing dependencies.
- Implemented `enhance_text_contrast` and `binarize_crop` for image preprocessing.
- Implemented `OcrResultCache` for caching OCR observations by frame hash.
- Implemented `OcrRegistry` for dynamic provider lookup by language and engine key.

## Red-first evidence

1. Command:
   ```powershell
   & 'C:\Users\PC\AppData\Local\Programs\Python\Python311\python.exe' -m unittest tests.t04.test_ocr_runtime -v
   ```
   Exit code: `1`. Expected failure: `ModuleNotFoundError: No module named 'subtitle_localizer.ocr'`.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t04.test_ocr_runtime -v` | Focused T04 OCR runtime tests | `0` (4 passed) |
| `Python311\python.exe -m pytest -q tests/t04` | Targeted T04 test suite | `0` (4 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (56 passed: 30 T00 + 11 T01 + 7 T02 + 4 T03 + 4 T04) |
| `Python311\python.exe -m compileall -q src scripts` | Syntax and static compile check | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/mojibake scan across entire codebase | `0` |
| `git diff --check` | Whitespace check | `0` |

## Reviewer verdict

- Verdict: `APPROVED` (evaluated with full suite green and zero regression on T00–T03).

STOPPED_AFTER_TICKET
