# Subtitle Localizer Studio — Design Specification

**Status:** Approved for staged implementation  
**Date:** 2026-09-02  
**Scope:** Windows-first, local-first OCR subtitle extraction and localization for vertical or horizontal video.

## Product outcome

Subtitle Localizer Studio imports a video containing hard subtitles, detects and OCRs the subtitle track, reconstructs timing from real presentation timestamps, optionally translates the text to Vietnamese, lets the user review and edit a single subtitle track, masks the original subtitle, and exports SRT, ASS, or a rendered video. OCR-only is a first-class workflow. Dubbing is deferred to Phase 2.

## Locked assumptions

- Windows-first; Python 3.11, Node 20, FFmpeg 8, RTX 3050 Laptop 6 GB.
- Input up to two hours and 1080p; portrait and landscape are supported.
- Offline-first. Cloud providers may be added later only through explicit adapters and keys.
- Personal/internal use; every model and dependency still needs a recorded license.
- GPL code is not vendored or copied into the core. Apache/MIT reuse requires provenance and notices.
- Models, source videos, proxies, caches, and outputs are never committed.
- Automation stops at review. Final rendering occurs only after Export, except for an explicitly confirmed batch preset.
- MVP has one subtitle track and excludes general video editing, multicamera, effects, and lip-sync.
- Dubbing receives a separate design and plan only after T11 approval.

## Runtime architecture

- React, TypeScript, and Vite provide the localhost editor.
- FastAPI binds only to `127.0.0.1`. REST carries commands and snapshots; WebSocket carries ordered events.
- A separate worker process owns OCR, translation models, and FFmpeg children so the API and UI remain responsive.
- SQLite is the source of truth for projects, cues, revisions, jobs, and checkpoints.
- FFmpeg 8 generates proxies and waveforms, renders masks and ASS through libass, and uses NVENC when capability tests pass, with libx264 fallback.
- Only one GPU-heavy stage runs at a time on a 6 GB GPU. Models are unloaded between OCR, translation, and render stages.

## Public contracts

- `ProjectManifestV1`: video fingerprint, media metadata, languages, model selections, active revision, regions, style, output presets.
- `RegionTrackV1`: normalized 0–1 region, validity interval, keyframe overrides.
- `OcrObservationV1`: PTS, boxes, raw and normalized text, confidence, preprocessing and model metadata.
- `SubtitleCueV1`: stable ID, start/end, source/translated text, style, region, quality flags, revision, `auto|reviewed|locked` status.
- `ModelDescriptorV1`: source, version or commit, SHA-256, format, license, languages, runtime and hardware requirements.
- `StageRunV1`: input/output hashes, checkpoint, progress, metrics, errors, cancellation state.
- `CommandEnvelopeV1`: `command_id`, `expected_revision`, command type and payload.
- `BridgeEventV1`: event ID, sequence, project/job ID, type, timestamp and payload.

All persisted contracts are versioned. Changes require migration tests and must preserve unknown fields when safe.

## API v1

- `POST /api/v1/system/pick-video`
- `POST /api/v1/projects`
- `GET /api/v1/projects`
- `GET /api/v1/projects/{id}`
- `PATCH /api/v1/projects/{id}`
- `POST /api/v1/projects/{id}/roi/propose`
- `PUT /api/v1/projects/{id}/regions`
- `GET /api/v1/projects/{id}/cues`
- `PATCH /api/v1/projects/{id}/cues/{cue_id}`
- `POST /api/v1/projects/{id}/cues/actions`
- `POST /api/v1/projects/{id}/commands`
- `GET /api/v1/jobs/{job_id}`
- `WS /api/v1/events?after_sequence=N`

The launcher creates a session token. The API enforces an Origin allowlist, canonicalizes local paths, grants read-only access only to selected input files, and never overwrites source media. Completed outputs use a temporary file followed by atomic rename.

## State machine

`new → probing → roi_review → ready → processing → review → rendering → completed`

Recovery or terminal branches are `failed`, `cancelled`, and `recovering`.

## OCR and cue reconstruction

- Adopt the useful workflow concepts from Video Subtitle Extractor—fast/auto/accurate modes, watermark filtering, and typo maps—without copying GPL-incompatible code or using frame/FPS-derived timing and incomplete caches.
- Keep VideoSubFinder behind an optional adapter and implement a native detector using text boxes, ROI frame difference, and temporal tracking.
- Evaluate PP-OCRv6 medium for Chinese, Japanese, and English; PP-OCRv5 server/mobile as controls; Korean PP-OCRv5 for Korean.
- Use PaddleOCR-VL only as a rescue pass when confidence is low or temporal observations conflict.
- Use real PTS, adaptive sampling, and boundary refinement. Combine observations with temporal consensus or median stacking.
- Calibrate thresholds per language on golden clips at a minimum 95% recall target.

## Translation

T00 performs a reproducible bake-off among TranslateGemma 4B, MADLAD-400 3B, NLLB-200 distilled 600M, and suitable OPUS-MT pairs. TranslateGemma must pass a compatibility gate comparing pinned llama.cpp and Transformers quantization. Promotion requires repeated-run stability, valid UTF-8, deterministic output, memory compliance, and no more than a two-point quality loss versus the reference runtime. Selection is per language pair. A cue may use one neighboring cue on each side as context, while persisted outputs and revisions remain per cue.

## Masking and rendering

- Stable defaults: blur, solid or semitransparent band, and crop.
- Experimental STTN and LAMA adapters are benchmarked; ProPainter is optional and non-commercial, never default on 6 GB VRAM.
- AI inpainting runs in overlapping chunks with seam/flicker checks. Failure follows the user-selected fallback and is never silent.
- New subtitles render through ASS/libass with pinned, license-checked fonts. Preview and export share one style contract.

## Phase 2 dubbing boundary

Phase 2 may use orchestration ideas from pyVideoTrans without copying GPL code. VieNeu-TTS stable is the first Vietnamese TTS candidate; early-access variants are not default. The future contract covers voice catalog, synthesis, duration fitting, optional vocal separation, ducking/mix, and audio review. Lip-sync is excluded by default.

## Quality and acceptance

- Golden set: 4–8 user-provided real clips covering Chinese, Japanese, Korean, English, portrait, and landscape. Videos stay outside Git; only hashes, manifests, and ground truth are stored.
- Cue recall for cues at least 500 ms: ≥95%; no unflagged continuous miss longer than two seconds.
- Timing median error ≤150 ms and p95 ≤300 ms.
- OCR CER: clean clips ≤8%; difficult clips ≤15%, reported separately per language.
- Translation: 50 cues per language scored for meaning, names, numbers, negation, and fluency. Meaning reversal or lost negation must be flagged.
- VFR PTS survives proxy, editor, and export.
- Render preserves resolution/orientation, A/V drift ≤100 ms, passes ffprobe, and leaves source unchanged.
- Worker restart resumes checkpoints without duplicate cues or artifacts; cancellation leaves no orphan child process.
- E2E covers import through export plus missing models, disk shortage, stale revisions, crash/retry, and unsupported codecs.
- UTF-8 round-trips Chinese, Japanese, Korean, and Vietnamese; scans reject replacement characters and mojibake indicators.
- Performance is reported, not gated in V1: wall time, FPS, peak RAM/VRAM, disk/cache, and per-stage duration.

## Ticket governance

Each ticket runs in its own session and declares requirement IDs, an exact path allowlist, forbidden paths, baseline Git state and SHA-256, a red test with expected failure, minimal patch, targeted/adjacent/regression commands with exit codes, third-party provenance, UTF-8 scan, evidence pack, and one reviewer verdict: `APPROVED`, `CHANGES_REQUIRED`, or `BLOCKED`. Every evidence pack ends with `STOPPED_AFTER_TICKET`.
