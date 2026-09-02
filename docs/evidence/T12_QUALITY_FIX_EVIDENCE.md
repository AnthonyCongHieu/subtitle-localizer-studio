# T12 OCR quality-fix evidence

Date: 2026-09-03. Generated media and reports remain under ignored `outputs/`.

## Implemented

- Preserve Chinese arithmetic containing `x`, `X`, `×`, or `*` while continuing
  to reject Latin-only subtitle lines.
- Run every deterministic preprocessing candidate instead of stopping on the
  first high confidence result.
- Re-read detected lines from padded original pixels; accept only constrained
  boundary extensions and never rewrite or delete interior text.
- Prefer a one-Han boundary extension only when its original-pixel reread score
  is at least 0.90. A low-confidence detector-only extension cannot override a
  higher-confidence result.
- Preserve actual detection rectangles and propagate candidate disagreements
  to cue quality flags.

## Red-first regressions

Initial quality test run: 5 failed, 11 passed, exit 1. It reproduced filtered
math, confidence early-stop, lost boundary characters/punctuation, and fake
observation boxes. The reviewer later identified an unguarded low-confidence
Han-edge override; its regression failed with 1 failed, exit 1 before the fix.

Final verification:

- `python -m pytest -q`: 127 passed, exit 0.
- `python -m compileall -q src scripts`: exit 0.
- `python scripts/t00/utf8_scan.py .`: exit 0.
- `npm run build` in `web`: exit 0, 43 modules transformed.
- `git diff --check`: exit 0; Git emitted only LF-to-CRLF working-copy warnings.
- Independent re-review: approved, no Critical or Important findings. Minor:
  candidate disagreement currently describes accepted non-empty candidates,
  not empty/error outcomes.

## Real GPU smoke

Command:

`python scripts/run_real_video_batch.py --input-dir C:/Users/PC/.gemini/antigravity/scratch/chinese_short_films --output-dir outputs/real_video_ocr/quality-smoke-v2 --language zh --no-translate --max-duration 60 --limit 1`

Exit 0; 13 cues; 127.655 seconds. The resulting SRT includes `6x6=36,`,
`6x7=42,`, `6x8=48...`, `一般跑六天。`, and `前几天我妹突然跟我说，`.
The earlier GPU smoke had 10 cues and lost these math cues, the leading `一`,
and the last comma. This is direct sample improvement, not a global accuracy
percentage.

## Five-video 60-second run

Command:

`python scripts/run_real_video_batch.py --input-dir C:/Users/PC/.gemini/antigravity/scratch/chinese_short_films --output-dir outputs/real_video_ocr/quality-five-60s --language zh --no-translate --max-duration 60`

Exit 0. All reports completed without runtime warnings or errors.

| Video | Cues | Seconds | Report SHA-256 |
| --- | ---: | ---: | --- |
| 01 Three Minutes | 13 | 139.141 | `9084a6d72c9ea5827ba08c1709f8965e0457db7733aefa989264956d15f540d8` |
| 02 Daughter | 7 | 130.586 | `df5b686df5c81760acca16aa4def6048e5aee5a5a896ce6e17956ae642dd6e80` |
| 03 Escape Ep1 | 16 | 160.824 | `321cfd44672836be08d0885ee08d4cbb65685b19d0f537e55377854b89989a65` |
| 04 Escape Ep2 | 20 | 162.798 | `0719c90f7e0a30bee049514ba41c602d990dce046d11ddee8110ea2dbfba1370` |
| 05 Escape Ep3 | 10 | 142.267 | `b2b27d573647db6c8b1022b763d2df66e0921ab89de37b651dac32b5f19f3c3d` |

Visual/result inspection shows heterogeneous quality. Video 1's known lines are
improved. Videos 3 and 4 contain many plausible lines but still visible character
errors. Video 2 produces numeric/scene-text false positives during frames without
subtitles. Video 5 has real outlined Chinese subtitles but recognition is poor on
several moving frames. Therefore no CER or quality percentage is claimed, and a
full-duration five-video run would not yet be an appropriate release gate.

## Bright-subtitle and ROI quality pass

The difficult white-on-outline samples from video 05 exposed two independent
issues: scene text survived the general preprocessing candidates, and the
landscape ROI ended at 94% of frame height, clipping lower glyph strokes.
Adding a luminance >= 200 candidate and moving the landscape ROI from 76--94%
to 78--96% produced 70/71 correct ground-truth characters (98.6%) across seven
manually checked lines. Six lines were exact; the remaining long line had one
similar-Han-character error.

Exact end-to-end runs used the same `run_project_ocr` entry point as the batch
runner with `max_duration_seconds=60` and CUDA RapidOCR:

- Video 05: 16 cues in 113.128 seconds. All seven audited subtitle lines were
  recovered; the only audited recognition error was `蜿` -> `豌`.
- Video 02: false detections fell from seven cues to one low-confidence mixed
  token (`开A`, 0.675) before the final confidence gate was added.

Chinese quality mode now also rejects isolated numeric scene tokens and OCR
lines below 0.75 confidence. Arithmetic subtitles such as `6x6=36` remain
explicitly supported.

Post-change regression verification:

- `python -m pytest -q`: exit 0, 133 passed.
- `python -m compileall -q src scripts tests`: exit 0.
- `python scripts/t00/utf8_scan.py .`: exit 0.
- `npm run build` in `web`: exit 0, 43 modules transformed.

## Remaining quality work

Measure missed cues and false positives against transcribed evidence, add
subtitle-presence filtering that does not discard valid numeric dialogue, and
benchmark a compatible stronger detector/recognizer on held-out frames from
videos 2 and 5. Keep ROI/model decisions per video rather than hiding these
failures behind the average confidence.
