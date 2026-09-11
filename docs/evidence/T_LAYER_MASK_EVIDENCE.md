# T-LAYER-MASK Evidence

## Ticket
**T-LAYER-MASK** — Persistent text layer separation + cue-follow timed masking

## Goal
Fortify OCR/export against:
1. Watermark + fixed branding junk mixed with dialogue
2. Clean shorts where blur should follow subtitle boxes over time

## Changes
- `src/subtitle_localizer/detector/persistent_text.py` — branding patterns, persistent box classifier, observation filter, ROI-aware region mapping
- `src/subtitle_localizer/detector/temporal.py` — shared IoU/persistent classifier
- `src/subtitle_localizer/ocr/rapid.py` — branding rejected in `is_trash_sub` + OCR line loop
- `src/subtitle_localizer/domain/models.py` — `RegionTrackV1.role` (`dialogue` | `ignore` | `always_mask`)
- `src/subtitle_localizer/render/mask.py` — `TimedMaskSegment`, timed FFmpeg `enable='between(t\,...)'` chains
- `src/subtitle_localizer/service/worker.py` — OCR scans dialogue ROIs only; persistent filter before reconstruction; auto `always_mask` with crop+ROI mapping
- `src/subtitle_localizer/service/server.py` — export timed cue masks + always_mask; batch-create preserves role; follow mask OR-gated
- `src/subtitle_localizer/service/pipeline_settings.py` + `pipeline_settings.json` — feature flags
- UI: `web/src/types/api.ts`, `web/src/components/inspector/RightInspectorPanel.tsx` — ROI role selector
- Tests: `tests/t27/test_persistent_text_and_cue_follow_mask.py`

## Reviewer loop
Independent review: **REQUEST_CHANGES** then fixed:
1. Absolute OCR boxes no longer mapped with fake 1x1 frame; require real crop size + `roi_norm`
2. Mixed watermark+dialogue frames always strip persistent boxes
3. Branding matcher fullmatch-only (no false positive on `我爱看红果短剧`)
4. Batch-create keeps `role`
5. `enable_cue_follow_mask` OR across ocr/render

## Verification
```
python -m pytest tests/t27/test_persistent_text_and_cue_follow_mask.py tests/t03/test_detector_roi.py tests/t10/test_render_export.py -q --tb=short
```
Result: **25 passed**

```
python -m pytest tests/t27 tests/t03 tests/t10 tests/unit/test_anti_noise_funnel.py tests/t06/test_translation.py -q --tb=line
```
Result: **41 passed**

Live FFmpeg smoke: timed blur graph with `enable='between(t\,...)'` rendered successfully (exit 0).

## Residual risks
- Very long cue lists → long FFmpeg filtergraphs
- Generative inpaint (`sttn_lama`) still drawbox fallback
- Recommend visual QA on dirty 红果 clips after reprocess/export
