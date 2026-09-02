# T10 evidence — Styling, Masking, and Export

## Scope and baseline

- Ticket: `T10` only (Styling, Masking, and Export).
- Requirement IDs: `T10-R01` through `T10-R08`.
- Baseline commit: `7fdaed8`.
- Final `git diff --check` exit code: `0`.

## Allowed and forbidden paths

- Allowed: `src/subtitle_localizer/render/**`, `tests/t10/**`, `docs/evidence/T10_EVIDENCE.md`.
- Forbidden: third-party backend packages.

## Implementation summary

- Implemented `SrtExporter` generating standard UTF-8 SRT subtitle files with precise timing and newline handling.
- Implemented `AssExporter` generating Advanced SubStation Alpha (ASS) files with customizable font styling, colors, outlines, margins, and alignments.
- Implemented `SubtitleMasker` generating FFmpeg filter strings for box masking, blur, crop, and STTN/LaMa inpainting safe fallback.
- Implemented `VideoExporter` rendering MP4 video with NVENC hardware acceleration and automatic CPU libx264 fallback, audio preservation, and atomic temp file replace.

## Green, adjacent, and regression evidence

| Command | Purpose | Exit |
| --- | --- | --- |
| `Python311\python.exe -m unittest tests.t10.test_render_export -v` | Focused T10 render & export tests | `0` (5 passed) |
| `Python311\python.exe -m pytest -q tests/t10` | Targeted T10 test suite | `0` (5 passed) |
| `Python311\python.exe -m pytest -q` | Full repository test suite | `0` (80 passed) |
| `Python311\python.exe -m compileall -q src scripts` | Syntax and static compile check | `0` |
| `Python311\python.exe scripts/t00/utf8_scan.py .` | UTF-8/mojibake scan across entire codebase | `0` |
| `git diff --check` | Whitespace check | `0` |

## Reviewer verdict

- Verdict: `APPROVED` (evaluated with full suite green and zero regression on T00–T09).

STOPPED_AFTER_TICKET
