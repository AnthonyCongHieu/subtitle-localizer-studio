# OCR speed optimization: evidence and scoped plan

## Findings

The local pipeline samples 117 crops in the first 60 seconds of
`01_Three_Minutes_TranKhaTan.mp4` (2.5 FPS, diff threshold 2.5). Before this
change, `BackgroundWorker` unconditionally passed `include_advanced=True` to
RapidOCR. That expands each crop to six preprocessing candidates, so the
detector/recognizer can be invoked up to six times per crop (plus the existing
line reread). The setting was not user-configurable.

The minimal fix makes advanced preprocessing opt-in and keeps the existing
four basic candidates and early-exit behavior. The production preset is named
`ocr.performance_profile=full_speed_quality`; difficult sources can opt into
`maximum_recall`. The legacy boolean
`ocr.include_advanced_preprocessing=true` remains supported for custom/unknown
profiles; no OCR model or public API contract is changed.

## Reproducible measurement

Command:

```text
python scripts/run_real_video_batch.py --input-dir C:\Users\PC\.gemini\antigravity\scratch\chinese_short_films --output-dir outputs/real_video_ocr/speed-fix-smoke --language zh --no-translate --max-duration 60 --limit 1
```

Observed after the fix: exit 0, 15 cues, 58.625 seconds, RapidOCR ONNX CUDA.
The five-video comparison (each limited to the first 60 seconds) was:

| Video | Advanced on | Full speed + quality | Cue count on/off |
| --- | ---: | ---: | ---: |
| 01 | 84.060s | 58.625s | 15 / 15 |
| 02 | 158.091s | 106.171s | 6 / 6 |
| 03 | 116.652s | 82.695s | 23 / 23 |
| 04 | 72.267s | 52.469s | 23 / 23 |
| 05 | 100.570s | 72.782s | 21 / 20 |
| **Total** | **531.640s** | **372.742s** | **88 / 87** |

This is a measured 29.9% total speed reduction. Four SRT files were byte-for-
byte identical; video 05 dropped one short noisy cue and retained the other
cue texts. These are workload timings, not a claim of universal speed or
accuracy. Reports and SRTs are ignored artifacts under `outputs/`.

The `reveal-export` endpoint also creates the per-project output directory
before launching Explorer and passes Windows paths as argument lists. Its test
mock prevents a temporary test directory from leaving a stale Explorer window
after teardown.

The production profile also bounds gap-rescue OCR to 20 frames per suspicious
interval (the previous hard limit was 50). `maximum_recall` can raise this
setting when a difficult source justifies the extra work.

An additional full-pipeline test on
`03_Escape_From_The_British_Museum_Ep1.mp4` (first 60 seconds) measured
89.399 seconds with rescue enabled versus 63.358 seconds with rescue disabled.
Both runs produced 23 cues and their SRT files had the same SHA-256 hash.
This supports disabling rescue in the default speed profile for this workload,
while retaining it as an explicit maximum-recall option. It is not proof that
rescue is unnecessary for every source; short-cue recall still requires a
ground-truth evaluation.

## Sources reviewed

- [RapidOCR](https://github.com/RapidAI/RapidOCR) (Apache-2.0): ONNX Runtime
  inference configuration and CPU/GPU provider behavior.
- [PaddleOCR official OCR pipeline](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html):
  detector/recognizer model tiers and measured model trade-offs. A model swap
  is not made without a held-out benchmark.
- [VideOCR](https://github.com/timminator/VideOCR): representative-frame
  grouping and similarity filtering before OCR.
- [video-subtitle-extractor](https://github.com/YaoFANGUK/video-subtitle-extractor):
  fast/auto/precise modes and bounded OCR orchestration.
- [RapidVideOCR](https://github.com/SWHL/RapidVideOCR): separating frame
  extraction, recognition, and timestamp mapping.
- [Subtitle Edit Video OCR](https://subtitleedit.github.io/subtitleedit/features/ocr.html):
  frame grouping, observation filtering, and timing refinement without rerunning
  OCR.

## Follow-up plan (not silently implemented)

1. Record per-stage timings and OCR call counts in a benchmark harness.
2. Compare representative-frame grouping against the current sampler on a
   held-out set; verify cue recall and CER before changing sampling policy.
3. Benchmark PP-OCR mobile/server (or another compatible backend) on the same
   frames and record model hashes, provider, VRAM, latency, recall, and CER.
4. Consider a low-confidence rescue pass only after step 2/3 show a measurable
   quality benefit; keep it bounded and single-GPU to avoid duplicated contexts.

## Model migration plan (PP-OCRv5)

This is the approved conversion plan; it must not be reported as implemented
until the runtime and measurements below exist.

1. **Runtime gate**: install a supported PaddlePaddle GPU build for the target
   Windows/Python/CUDA combination, then verify that Paddle reports the GPU.
   A CPU-only Paddle install is not an acceptable comparison for this ticket.
2. **Provider adapter**: add a `PaddleOcrProvider` implementing the existing
   `OcrProvider` contract. Keep RapidOCR selectable as `legacy_rapidocr` so the
   old/new runs use identical sampler, ROI, cue reconstruction and exports.
3. **Video algorithm**: share ROI crop, frame grouping and timestamp mapping;
   run detector on representative frames, batch recognizer crops where the
   Paddle API supports it, then temporal-consensus text across the group.
   Rescue only low-confidence/disagreeing groups, with one GPU owner.
4. **Quality gate**: compare cue recall, character CER, precision, duplicate
   rate and missing-short-cue count on the same five videos and a labelled
   held-out frame set. Confidence alone is not an accuracy metric.
5. **Performance gate**: record wall time, OCR calls, frames sampled, GPU
   utilization, peak VRAM and warm-up separately for each backend. Select the
   new default only if it is no worse on the quality gate and faster on the
   performance gate; otherwise retain RapidOCR.

### Current conversion status

The runtime gate was probed in an isolated environment. PaddlePaddle GPU
2.6.2 on Windows/Python 3.11 did report `gpu:0`, but PaddleOCR/PaddleX 3.7
failed at initialization because Paddle 2.6.2 lacks
`AnalysisConfig.set_optimization_level`. PaddlePaddle 3.3.1 has the required
API but the available Windows wheel is CPU-only. Therefore no PP-OCRv5 GPU
result is claimed and no Paddle dependency has been added speculatively. The
provider adapter now accepts PaddleOCR 3.x `predict()` result objects and
retains a legacy `.ocr()` path. Registry/worker selection supports explicit
primary/fallback backends and preserves the old `engine=paddle` setting. The
production default remains RapidOCR until a compatible PP-OCRv5 GPU runtime
passes the benchmark gates; no PP-OCRv5 quality result is claimed.
