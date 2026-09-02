# T12: research on video-subtitle OCR optimization

Research date: 2026-09-03. Read-only upstream inspection; no upstream code,
models, binaries, or dependencies were copied into this repository.
This research supplements the approved OCR quality work; it does not close T12.

## Compared repositories

### VideOCR

Inspected commit: `c85e5639763aebf401faea4ff548f0b1cc9eba35`.
GitHub reports MIT for the repository; dependencies require separate review.

The pipeline uses bounded queues between decoding, preprocessing, and writing.
It filters image similarity before detection, then compares tighter detected
text regions. Within a similar group it keeps an image with a high detection
score and preserves the group's starting frame. This separates representative
image selection from timing. Detection grids are optional: the README explicitly
describes disabling stitching as a speed/accuracy tradeoff. Dual crop regions
and a server-model option are relevant to this application.

Sources: [README](https://github.com/timminator/VideOCR/tree/c85e5639763aebf401faea4ff548f0b1cc9eba35),
[pipeline](https://github.com/timminator/VideOCR/blob/c85e5639763aebf401faea4ff548f0b1cc9eba35/CLI/videocr/video.py),
[SSIM grouping and grid mapping](https://github.com/timminator/VideOCR/blob/c85e5639763aebf401faea4ff548f0b1cc9eba35/CLI/videocr/utils.py).

### Video-subtitle-extractor (VSE)

Inspected commit: `85746f7df5bf85978fd05f3ca6ce66e321a87a72`.
GitHub reports Apache-2.0 for the top-level repository.

Fast/Auto modes use VideoSubFinder to find subtitle frames; Auto selects the
larger OCR model on GPU. Precise mode uses more expensive frame-level detection.
The source separates OCR into a process with task and progress queues. Text
similarity controls deduplication. These are architectural references, not
proof of accuracy: README statements about near-perfect results are not a
benchmark on the user's videos. Its Unicode-path warnings are not behavior
to adopt here; UTF-8 and Unicode paths remain requirements.

Sources: [mode table](https://github.com/YaoFANGUK/video-subtitle-extractor/blob/85746f7df5bf85978fd05f3ca6ce66e321a87a72/README_en.md),
[orchestration](https://github.com/YaoFANGUK/video-subtitle-extractor/blob/85746f7df5bf85978fd05f3ca6ce66e321a87a72/backend/main.py).

### RapidVideOCR

Inspected commit: `4df344a8d7f37e11dbe39cbb9bb8f14676da2fc2`.
GitHub reports Apache-2.0.

Its workflow separates subtitle-frame extraction with VideoSubFinder from OCR.
Batch recognition vertically concatenates images with padding, maps detected
boxes back to their source images, and obtains timestamps from extracted-image
filenames. Same-line boxes are grouped before export. This is useful evidence
for separating detection, recognition, and timing; concatenation itself needs
careful scale and coordinate tests before adoption.

Sources: [README](https://github.com/SWHL/RapidVideOCR/tree/4df344a8d7f37e11dbe39cbb9bb8f14676da2fc2),
[OCR processor](https://github.com/SWHL/RapidVideOCR/blob/4df344a8d7f37e11dbe39cbb9bb8f14676da2fc2/rapid_videocr/ocr_processor.py).

### HardSubExtract_2026

Inspected commit: `1a0119418458f451c72ee201e11baa9444656c4a`.
GitHub reports Apache-2.0.

Its documented controls include ROI image-difference gating, resize and
threshold variants, debug images, and decoder-specific hardware acceleration.
Parallel chunks have overlap and a later deduplication pass. The README warns
that more processes duplicate GPU contexts and can exhaust VRAM. Its Windows
native path is substantially more complex than this application's current
OpenCV/ONNX architecture; importing that architecture is not a minimal fix.
Performance descriptions were inspected, not independently reproduced.

Source: [README and pipeline layout](https://github.com/cavalia88/HardSubExtract_2026/tree/1a0119418458f451c72ee201e11baa9444656c4a).

### VideoSubFinder licensing boundary

The [SWHL mirror](https://github.com/SWHL/VideoSubFinder) describes automatic
subtitle-frame detection and background-cleaned text images. GitHub identifies
it as GPL-2.0. Do not vendor its code/binaries into this project. Merely having
an Apache-licensed wrapper does not change this dependency's license. No
integration decision or legal conclusion is made here.

## Findings reproduced locally

Input: `01_Three_Minutes_TranKhaTan.mp4`, frame 23.280 seconds.
The original image visibly says `一般跑六天。`.
Existing bottom ROI: `(0.08, 0.76, 0.84, 0.18)`.

Using the current GPU engine and existing preprocessing candidates:

| Candidate | Recognized text | Confidence |
| --- | --- | --- |
| Original | 般跑六天。 | 0.999 |
| Grayscale/normalized | 般跑六天。 | 0.999 |
| Otsu threshold | 一般跑六天。 | 0.998 |

The original detector box begins at ROI x=756; the threshold candidate begins
at x=734, capturing the thin leading character. The probe completed with exit 0.
The current early-stop threshold prevents the successful candidate from running.
Simply running all three and choosing maximum confidence would still select
the incomplete result. This is evidence of a selection/detection problem, not
proof that a larger model is required.

At 58.320 seconds all three candidates omitted the final punctuation. That
issue is not solved by merely enabling all preprocessing variants.

Original frames at 5, 7, and 9 seconds contain `6x6=36,`, `6x7=42,`, and
`6x8=48...`. The Chinese-language Latin filter mistakes multiplication `x` for
English and removes these valid subtitles. The centered Chinese opening title
is outside the bottom ROI. Ground truth must include these missed items, not
only the ten already-generated cues.

## Application priorities (proposed implementation, not yet completed)

1. Add a reproducible development fixture and character-error measurement,
   including missing subtitles and punctuation. Keep separate held-out samples
   across the other videos; do not advertise development-set scores globally.
2. Fix math filtering. Add a quality mode that does not stop solely on confidence.
   Compare competing detections/recognized text and flag disagreements; never
   inject guessed characters. Test false-positive text expansion explicitly.
3. Preserve real text boxes. Use representative images for recognition while
   retaining first/last timestamps; handle blank frames and short cues explicitly.
4. Benchmark tight-box deduplication conservatively. Scene-wide similarity can
   hide a one-character subtitle change. Keep periodic verification and record
   the number of skipped images and any missed cues.
5. Test a larger recognition model against the same held-out samples before
   replacing the existing engine. Keep a single GPU owner on this 6 GB device;
   use small batches and measure peak VRAM rather than spawning many workers.
6. Handle worker isolation, progress, cancellation, and truthful web export
   states as the separate web-stability ticket.

No CER, recall, or timing score for competing repositories was measured here.
No claim is made that this application has implemented their optimizations.

## Additional community-evidence review (2026-09-03)

Selection distinguishes popularity, first-person feedback, and measured quality.
GitHub stars/forks are interest signals, not user ratings or OCR accuracy.
The following counts were fetched from the public GitHub REST repository API
on the research date; all eight repositories reported `archived=false`.
This is a curated shortlist, not an exhaustive ranking or a user survey.

| Repository | Stars | Forks | Role | API license |
| --- | ---: | ---: | --- | --- |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | 88,695 | 11,284 | OCR models/toolkit, not a subtitle app | Apache-2.0 |
| [Subtitle Edit](https://github.com/SubtitleEdit/subtitleedit) | 14,038 | 1,292 | Subtitle editing and bitmap OCR | MIT |
| [VSE](https://github.com/YaoFANGUK/video-subtitle-extractor) | 9,440 | 952 | Direct hardsub extraction comparator | Apache-2.0 |
| [RapidOCR](https://github.com/RapidAI/RapidOCR) | 7,661 | 713 | Inference toolkit, not a subtitle app | Apache-2.0 |
| [VideOCR](https://github.com/timminator/VideOCR) | 766 | 79 | Direct hardsub extraction comparator | MIT |
| [Original videocr](https://github.com/apm1467/videocr) | 548 | 216 | Historical Tesseract-based baseline | MIT |
| [RapidVideOCR](https://github.com/SWHL/RapidVideOCR) | 506 | 62 | Extracted-frame OCR workflow | Apache-2.0 |
| [VidSubX](https://github.com/voun7/VidSubX) | 84 | 11 | Relevant small project, not highly endorsed | Not identified |

License fields describe the current top-level repository only. They do not
authorize copying dependencies, historical releases, model weights, or data.
VidSubX has no identified license in the API response: do not copy its code.

### New references and practical findings

**Subtitle Edit** — HEAD observed:
`87fa837e9625556127d6292a01b989294a7a5b7f`.
Its [OCR documentation](https://subtitleedit.github.io/subtitleedit/features/ocr.html)
describes an HTML export pairing subtitle images with OCR text, including an
empty-result filter. It also separates persistent correction rules from
temporary skips. These are useful patterns for an auditable review workflow.
The documented bitmap inputs include PGS/VobSub; this is not evidence of an
equivalent raw-video detection pipeline. Its engine-quality descriptions are
maintainer claims, not measurements on our samples. A
[user discussion about French OCR and settings](https://github.com/SubtitleEdit/subtitleedit/discussions/10263)
also shows why automatic correction needs language-specific regression tests.
Proposed application: image/text evidence and explicit, reversible corrections;
do not apply an English dictionary or automatic Chinese normalization globally.

**RapidOCR** — HEAD observed:
`0e629c8be05635035c01a829d10a91bbcd56a27a`.
In [discussion 449](https://github.com/RapidAI/RapidOCR/discussions/449), one user
reports better uncommon-character recognition with v5; the maintainer confirms
training-data emphasis on that area. This is useful qualitative feedback, not
a measured gain. In [discussion 703](https://github.com/RapidAI/RapidOCR/discussions/703),
a user reports differing v6 output between pipelines; the maintainer recommends
matching detection settings, specifically `limit_side_len` and `use_dilation`.
No successful user retest was visible in that thread. Proposed application:
benchmark compatible model/preprocessing pairs behind our provider boundary,
recording model hashes, resize rules and runtime versions. Do not copy current
RapidOCR configuration into our older installed API without compatibility tests.

**PaddleOCR** — HEAD observed:
`2661c7c0ef5c613e8f93c6e93b2e052399f0f854`.
The [official pipeline documentation](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html)
is the model/configuration reference. Community reports include
[clipped first/last characters](https://github.com/PaddlePaddle/PaddleOCR/discussions/14787)
and [Chinese punctuation/character coverage problems](https://github.com/PaddlePaddle/PaddleOCR/discussions/14507).
These corroborate relevant failure classes, not the precise cause of our bug.
Do not treat every discussion reply as a validated fix: changing a character
dictionary alone is not a safe model upgrade. Proposed application: evaluate
detector crop coverage separately from recognizer errors before switching models.

**Original videocr** — HEAD observed:
`9b97c996570897b5a45d1f8b4f046aebcbcca300`.
The [README](https://github.com/apm1467/videocr) exposes confidence/similarity
thresholds and reports a historical CPU runtime of three minutes for twenty
seconds of video on the author's dual-core laptop. The API reports the last
push as 2024-01-30. Its history is useful, but neither that hardware-specific
figure nor its stars support replacing our working CUDA backend with Tesseract.

**VidSubX** — HEAD observed:
`744bbda1071c6f616b2b28214040b18253936292`.
Its [preferences documentation](https://github.com/voun7/VidSubX/blob/744bbda1071c6f616b2b28214040b18253936292/docs/Preferences.md)
separates ROI sampling, padding, extraction frequency, text-drop threshold,
model size and subtitle merging. It warns that high text thresholds skip text,
low similarity thresholds merge different text, and excess GPU processes hurt
performance. Proposed application: test these controls independently and count
missed cues. Only 84 stars and no identified license: technical reference only,
not a claim of strong user endorsement or permission to reuse code.

### Direct user feedback on the previously reviewed VideOCR

The [first-person community thread](https://www.reddit.com/r/selfhosted/comments/1k9cr55/videocr_extract_hardcoded_subtitles_out_of_videos/)
contains a user reporting roughly one-third of VSE's expected processing time,
another reporting successful Hebrew extraction using Paddle plus Google Lens,
and complaints about speed and Vietnamese diacritics. These are anecdotes from
different versions, languages and machines, not controlled comparisons. Cloud
OCR feedback does not establish offline quality and is not authorization to
upload the user's videos. No satisfaction percentage can be derived here.

### Updated recommendation

Keep VSE and VideOCR as direct end-to-end comparators. Add Subtitle Edit as the
review/evidence reference and RapidOCR/PaddleOCR as model/configuration references.
Prioritize crop coverage, candidate disagreement, missing-cue measurement and
image-backed review. Then compare the existing model with compatible stronger
models on held-out Chinese samples using CER, missed-cue rate, timing error,
runtime and peak VRAM. Keep punctuation-sensitive and normalized scores separate.
This recommendation is an engineering inference from the sources and our local
probe; it is not a benchmark result or an implemented change.

Only this research document was edited during the additional review. No package,
model, production source, video or runtime setting was changed.
