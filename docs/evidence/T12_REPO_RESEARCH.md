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

## Community experience and newer pipeline references (2026-09-03)

This pass focuses on problems reproduced in videos 2 and 5: scene-text false
positives, outlined Chinese text over motion, and unstable temporal merging.
Counts below are GitHub interest signals observed on the research date, not
ratings or accuracy measurements.

### Subtitle Edit Video OCR

Repository: [SubtitleEdit/subtitleedit](https://github.com/SubtitleEdit/subtitleedit),
14,038 stars, 1,292 forks, MIT reported by GitHub API. Inspected commit:
`87fa837e9625556127d6292a01b989294a7a5b7f`.

Its current [Video OCR documentation](https://github.com/SubtitleEdit/subtitleedit/blob/87fa837e9625556127d6292a01b989294a7a5b7f/docs/features/video-ocr.md)
now covers burned-in video frames directly. On Windows/Linux it recommends
PaddleOCR and also exposes GLM-OCR, DeepSeek-OCR-2, PP-OCRv6 and other local
vision backends. The most relevant implementation choices are:

- [Frame grouping](https://github.com/SubtitleEdit/subtitleedit/blob/87fa837e9625556127d6292a01b989294a7a5b7f/src/ui/Features/Video/VideoOcr/VideoOcrFrameGrouper.cs)
  thresholds bright pixels at a working width near 360 pixels, then max-pools
  the mask to 96 pixels so thin glyph strokes survive. It uses Jaccard overlap
  of masks rather than ordinary whole-scene SSIM when brightness filtering is
  active, classifies near-empty masks as blank, and picks the middle group frame
  to avoid subtitle fade-in/fade-out edges.
- The same code masks darker pixels before PaddleOCR and dilates the retained
  bright-pixel mask. Its comments report that this helped Paddle but harmed a
  vision OCR path, so preprocessing must remain engine-specific.
- [Observation filtering](https://github.com/SubtitleEdit/subtitleedit/blob/87fa837e9625556127d6292a01b989294a7a5b7f/src/ui/Features/Video/VideoOcr/VideoOcrObservationFilter.cs)
  requires a minimum bright-pixel fraction inside each returned box. This is
  directly relevant to our scene-text false positives, but it assumes bright
  subtitles and must be disabled or adapted for dark/color text.
- [Line building](https://github.com/SubtitleEdit/subtitleedit/blob/87fa837e9625556127d6292a01b989294a7a5b7f/src/ui/Features/Video/VideoOcr/VideoOcrLineBuilder.cs)
  weights text variants by on-screen duration and OCR confidence, drops short
  blips, and can bridge one brief junk observation. This is stronger evidence
  than choosing a single frame solely by confidence.
- [Timing refinement](https://github.com/SubtitleEdit/subtitleedit/blob/87fa837e9625556127d6292a01b989294a7a5b7f/src/ui/Features/Video/VideoOcr/VideoOcrTimingRefiner.cs)
  revisits only coarse start/end windows at source-frame resolution using real
  ffmpeg timestamps; it does not rerun OCR for that refinement.

These ideas are newly inspected upstream behavior; they have not been ported.
Do not copy implementation code. Reproduce only the independently tested
algorithmic behavior suitable for this project's Python contracts.

### PaddleOCR model tiers

Repository: [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR),
88,699 stars, 11,284 forks, Apache-2.0 reported by GitHub API. Inspected commit:
`2661c7c0ef5c613e8f93c6e93b2e052399f0f854`.

The [official model table](https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html)
reports PP-OCRv5 server detection Hmean 83.8 versus 79.0 for mobile, and Chinese
recognition average 86.38 versus 81.29 for mobile. The server detector and
recognizer are 84.3 MB and 81 MB respectively. These figures are Paddle's
general evaluation sets, not subtitle-video measurements. The same page warns
that v6 and v5 results use different evaluation sets and are not directly
comparable. Therefore the correct choice is an on-device A/B test, not selecting
the largest version number.

Community reports show model choice alone is insufficient:

- [RapidOCR discussion 702](https://github.com/RapidAI/RapidOCR/discussions/702)
  reports missed Chinese characters with both v4-det/v5-rec and v5-det/v5-rec;
  the maintainer suggests testing v6. No result establishes a universal winner.
- [PaddleOCR issue 15455](https://github.com/PaddlePaddle/PaddleOCR/issues/15455)
  reports slow behavior on no-text images and local/demo output differences.
  This reinforces measuring blank-frame handling and pinning the full runtime
  configuration, not only model names.

Practical conclusion for the RTX 3050 6 GB machine: benchmark a server detector
and recognizer one at a time with a single GPU owner. Record model hashes, peak
VRAM, blank-image latency and the exact resize/unclip/dilation configuration.

### GLM-OCR and VLM fallback

Repository: [zai-org/GLM-OCR](https://github.com/zai-org/GLM-OCR), 7,383 stars,
667 forks, Apache-2.0 reported by GitHub API. Inspected commit:
`cef4d0ea120d1741f5cefe8985eee45f6c8eff1d`.

The project describes a 0.9B model and supports local vLLM, SGLang and Ollama.
Subtitle Edit lists GLM-OCR first among its llama.cpp subtitle models. That is
maintainer selection evidence, not a benchmark on our videos. Open community
issues include [repeated output](https://github.com/zai-org/GLM-OCR/issues/225),
poor results on some cropped regions, and local deployment/version problems.
VLM output also needs strict cleaning because blank images can trigger prompt
echoes or invented text; Subtitle Edit documents this explicitly in its line
builder.

Use GLM-OCR only as an offline second opinion for low-confidence or disagreeing
representative crops initially. Do not run it on every sampled frame, trust its
prose output without temporal evidence, or send user frames to a cloud API.
Its value must be measured by character error reduction versus hallucination
and runtime on this 6 GB device.

The similarly named [Benson-mk/VideOCR-GLM](https://github.com/Benson-mk/VideOCR-GLM)
had zero stars and zero forks at inspection time. It is relevant as an emerging
integration experiment but does not meet the user's request for highly rated
community evidence and should not drive architecture decisions.

### Direct hardsub user experience

- A [VideOCR community thread](https://www.reddit.com/r/selfhosted/comments/1k9cr55/videocr_extract_hardcoded_subtitles_out_of_videos/)
  contains positive GPU reports and Chinese-language usage, but also a detailed
  case where lowering max merge gap corrected one failure while causing duplicate
  lines; later versions fixed one merge bug and reportedly introduced missed
  lines for another user. The maintainer asked users to compare the same video
  and crop. This supports per-video regression clips and warns against a single
  global similarity threshold.
- [VSE issue 296](https://github.com/YaoFANGUK/video-subtitle-extractor/issues/296)
  reports low recall for short, right-aligned subtitles while centered subtitles
  work well. Detection geometry is therefore an independent quality axis.
- [VSE discussion 435](https://github.com/YaoFANGUK/video-subtitle-extractor/discussions/435)
  reports Accurate mode taking roughly ten minutes for one minute of video and
  long jobs appearing stuck near 94 percent. The report is anecdotal but shows
  why progress, bounded batches and representative-frame OCR matter.
- A [video-engineering user workflow](https://www.reddit.com/r/VIDEOENGINEERING/comments/1g20itg)
  reports EasyOCR less accurate than Google Vision for Chinese and still relies
  on manual comparison/correction. It is not a controlled benchmark and cloud
  OCR is outside the local-only recommendation.

### Revised implementation recommendation

1. Implement bright-mask blank detection and mask-overlap grouping as an
   optional bright-subtitle path. Validate it first on videos 1, 3, 4 and 5;
   preserve an unmasked path for dark or colored subtitles.
2. Select the middle/clearest frame from a stable group and vote text variants
   by observed duration plus confidence. Treat similarity and max gap as a
   tested profile, not global truth.
3. Benchmark PP-OCR server/medium detector-recognizer combinations against the
   current model on transcribed crops from all five videos, including blank
   frames. This is the best first model upgrade for the existing ONNX pipeline.
4. Evaluate local GLM-OCR only as a second pass for disputed representative
   crops. Reject output that lacks temporal or detector support.
5. Add image-backed review in the web UI after OCR quality is measurable. Human
   correction remains necessary; no credible community source supports a
   universal 100-percent hardsub OCR claim.

This section records research only. No model, package, production code or user
video was changed or uploaded during this pass.
