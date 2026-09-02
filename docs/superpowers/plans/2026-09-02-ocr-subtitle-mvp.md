# Subtitle Localizer Studio OCR Subtitle MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Execute one ticket per session and stop at its marker.

**Goal:** Build a Windows-first, local-first application that extracts hard subtitles from portrait or landscape videos, reconstructs SRT timing, optionally translates to Vietnamese, supports review/editing and original-subtitle masking, and exports subtitles or rendered video.

**Architecture:** React/TypeScript/Vite editor over a localhost FastAPI service, with a separate GPU/FFmpeg worker, SQLite state and checkpoints, ordered WebSocket events, and versioned domain contracts. GPU-heavy stages are serialized for a 6 GB RTX 3050.

**Tech Stack:** Python 3.11, FastAPI, SQLite, React, TypeScript, Vite, FFmpeg 8/libass/NVENC, PaddleOCR adapters, pluggable local translation runtimes, pytest, and browser E2E tests.

**Spec:** `docs/superpowers/specs/2026-09-02-subtitle-localizer-studio-design.md`

## Global constraints

- Execute exactly one ticket per session. This session is authorized for T00 only.
- Test executable behavior red-first. Keep configuration and documentation tests focused on meaningful schema/provenance invariants.
- Do not download multi-gigabyte models until compatibility probes, benchmark harnesses, disk checks, and golden data are ready.
- Do not implement future-ticket production modules early.
- Never commit source videos, model weights, proxies, caches, rendered outputs, secrets, or local databases.
- Do not vendor or copy GPL code into core. Record source, license, commit, and hashes for every evaluated third party.
- Preserve UTF-8 and Vietnamese text.
- End each evidence pack with `STOPPED_AFTER_TICKET` and stop.

---

### Task 1: T00 Foundation, Evidence, and Benchmark Harness

**Requirement IDs:** T00-R01 through T00-R12.

**Allowed paths:** `.gitignore`, `AGENTS.md`, `README.md`, `pyproject.toml`, `src/subtitle_localizer_t00/**`, `tests/t00/**`, `scripts/t00/**`, `fixtures/synthetic/**`, `benchmarks/**`, `docs/research/**`, `docs/evidence/T00_EVIDENCE.md`, and the two approved files under `docs/superpowers/**`.

**Forbidden paths:** application API/worker/UI production code, database migrations, `models/**`, `media/**`, `outputs/**`, real golden video bytes, credentials, and all T01–T11 evidence files.

**Requirements:**

- T00-R01: Initialize Git on branch `ticket/t00-foundation`, capture clean/dirty baseline and SHA-256 evidence.
- T00-R02: Record CPU, RAM, GPU/VRAM, OS, Python, Node, FFmpeg, codecs, NVENC, libass, and disk capability in machine-readable JSON.
- T00-R03: Maintain a source/license/model matrix with official URL, evidence type, pinned commit or version, license, languages, runtime, hardware notes, and verification status.
- T00-R04: Pin remote repository HEADs through a reproducible lock command; record failures explicitly and never invent a hash.
- T00-R05: Validate a golden manifest containing 4–8 external clips, hashes, language, orientation, difficulty, ground-truth paths, and PTS/VFR metadata. Reject video paths inside the repository.
- T00-R06: Generate small deterministic synthetic CFR and VFR fixtures with UTF-8 Chinese, Japanese, Korean, English, and Vietnamese text using local FFmpeg; record checksums and ffprobe metadata.
- T00-R07: Define benchmark input/result schemas for detector, OCR, translation runtime/model, timing, memory, disk, and UTF-8 gates.
- T00-R08: Provide dry-run benchmark commands that validate manifests and emit an explicit `not_run` decision when weights or golden clips are absent; do not claim quality metrics without inference.
- T00-R09: Research and document candidates: Video Subtitle Extractor, VideoSubFinder, PaddleOCR v6/v5/VL, TranslateGemma, MADLAD-400, NLLB-200, OPUS-MT, Video Subtitle Remover, ProPainter, pyVideoTrans, and VieNeu-TTS.
- T00-R10: Publish per-language model decisions only when gates have evidence; otherwise mark them `PENDING_GOLDEN_BENCHMARK`.
- T00-R11: Run tests, formatting/static checks if configured, fixture validation, provenance validation, and UTF-8/mojibake scans with exact commands and exit codes.
- T00-R12: Write `docs/evidence/T00_EVIDENCE.md` with baseline, red test, minimal patch summary, test evidence, provenance, blockers, sole reviewer verdict, and final marker `STOPPED_AFTER_TICKET`.

**TDD sequence:**

1. Add focused tests for capability parsing, repository-path rejection and hash verification, schema validation, deterministic fixture manifests, provenance completeness, and UTF-8 scanning.
2. Run the exact targeted command and capture the expected missing-module/function assertion failure.
3. Implement the smallest T00-only modules and scripts that satisfy the tests.
4. Run targeted tests, all T00 tests, adjacent command-level smoke tests, and the full configured regression suite; record exit codes.
5. Generate the evidence pack, obtain an independent reviewer verdict, apply only scoped review fixes through the implementer, and stop.

**Acceptance:** All executable T00 harness behavior is tested and reproducible. Real quality gates remain blocked until 4–8 user clips and ground truth exist; this blocker must not be disguised as a pass.

---

### Task 2: T01 Domain and Persistence

Implement versioned domain types, project manifest, SQLite migrations, optimistic revisions, atomic artifact store, and repository tests. Depends on T00.

### Task 3: T02 Media Import and PTS

Implement ffprobe media contracts, native picker/import, proxy, thumbnails, waveform, and CFR/VFR PTS mapping. Depends on T01.

### Task 4: T03 ROI and Temporal Detection

Implement ROI proposals, multiple region tracks, adaptive frame sampling, native temporal detector, and optional VideoSubFinder adapter. Depends on T02.

### Task 5: T04 OCR Runtime

Implement OCR registry, Paddle v6/v5 adapters, preprocessing variants, batched inference, cache/checkpoints, and OCR-VL rescue routing. Depends on T03.

### Task 6: T05 Cue Reconstruction

Implement temporal consensus, refined boundaries, two-line ordering, duplicate/flicker filtering, cue reconstruction, and quality flags. Depends on T04.

### Task 7: T06 Translation Runtime

Implement TranslateGemma, MADLAD, NLLB and OPUS providers, runtime lifecycle, contextual batching, glossary and entity preservation, and selective retranslation. Depends on T05.

### Task 8: T07 API and Worker

Implement FastAPI, worker queue, idempotent commands, ordered/resumable WebSocket events, cancellation, recovery, and structured errors. Depends on T01–T06.

### Task 9: T08 Project and Processing UI

Implement import, ROI review, progress, model download state, retry, and recovery UI. Depends on T07.

### Task 10: T09 Subtitle Editor

Implement a CapCut-like single subtitle track with proxy playback, waveform/timeline, cue table, seek/trim/split/merge, text editing, locks, confidence filters, and undo/redo. Depends on T08.

### Task 11: T10 Styling, Masking, and Export

Implement shared ASS styling, blur/box/crop, experimental STTN/LAMA adapters, SRT/ASS/MP4 export, NVENC capability selection, and CPU fallback. Depends on T07–T09.

### Task 12: T11 Release Gate

Run golden, integration and UI E2E benchmarks, two-hour recovery, UTF-8 scan, bootstrap/installer validation, download documentation, and final release review. Depends on T00–T10.

## MVP acceptance suite

- 4–8 external real clips cover Chinese, Japanese, Korean, English, portrait, landscape, CFR, and VFR.
- Cue recall ≥95% for cues ≥500 ms; timing median ≤150 ms and p95 ≤300 ms.
- OCR CER ≤8% on clean clips and ≤15% on difficult clips, reported separately by language.
- Translation is human-scored on 50 cues per language; meaning reversal or lost negation cannot pass unflagged.
- Render preserves geometry, remains ffprobe-readable, keeps A/V drift ≤100 ms, and never changes the source.
- Restart/cancel behavior is checkpoint-safe and leaves no duplicates or orphan processes.
- UI E2E covers import → ROI → OCR → optional translation → review/edit → SRT/video export and all named error states.
