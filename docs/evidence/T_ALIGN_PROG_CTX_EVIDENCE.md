# Evidence: T-ALIGN + T-PROG + T-CTX

## Scope
Sequential fix for context-poor translation, progressive half-line subtitles, and untranslated cues.

## Changes
- `src/subtitle_localizer/reconstruction/consensus.py`: typewriter prefix (>=2), stricter suffix, boundary continuation
- `src/subtitle_localizer/reconstruction/builder.py`: stitch continuation; `normalize_sequential_cues(max_merge_gap=1.2)`
- `src/subtitle_localizer/translation/real.py`: CJK/leak guards, `list_untranslated_indices`, `retry_untranslated_cues`, rolling prior context, honest batch prompt labels
- `src/subtitle_localizer/service/worker.py`: translate → normalize → retry → normalize → untranslated check → save
- Tests: `tests/t24/test_translation_align_prog_ctx.py` (+ updates in `test_progressive_half_full_fix.py`)

## Commands
```
python -m pytest tests/t24/test_translation_align_prog_ctx.py tests/t24/test_progressive_half_full_fix.py tests/t06/test_translation.py -q --tb=short
```
Exit code: 0 — 32 passed

Adjacent:
```
python -m pytest tests/t24 tests/t06 tests/unit/test_translation_routing.py -q --tb=line
```
Exit code: 0 — 54 passed

## Independent review
Reviewer verdict after REQUEST_CHANGES fixes: **APPROVE**
