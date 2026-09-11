# Ticket T26 — Dubbing 100% Polish (Spoken Adapt + Speaker Editor)

## Goal
Finish residual quality after T25:
1. Duration-budget `spoken_text` adaptation (VI longer than ZH)
2. Per-cue speaker editor (gender / speaker_id / role) + timing badge
3. Same-gender multi accuracy via turn-taking speaker_id continuity
4. Persist adapted cue styles after dubbing
5. Tests + live UI verify

## Locked algorithms
### A. Spoken duration budget (text-first, stretch-second)
```
spoken = translated (or existing spoken_text)
est = estimate_speech_seconds(spoken, base_rate)
slot = available_voiceover_slot(cue, next, mode_budget)
if est > slot * soft(1.20): deterministic VI compression
if still > slot * hard(1.45): aggressiveness++ + timing_warning=hard
else if adapted: timing_warning=soft|none
TTS uses spoken_text; on-screen keeps translated_text
```

### B. Same-gender casting without labels
- Prefer explicit `style.speaker_id` / translation tags
- Else adjacency turn-taking:
  - same gender + short gap → reuse id (continuity)
  - gender flip → restore last id of that gender (A-B-A) or allocate
  - same gender + long gap → new id in gender pool
- Crowd/extra still skip TTS

### C. UI
- LeftMediaSidebar + CueTable: gender/role/speaker_id/spoken_text controls
- Badge when `timing_warning` present
- Adapt-spoken API for batch/one-click shorten

## Path allowlist
- src/subtitle_localizer/dubbing/tts.py
- src/subtitle_localizer/service/server.py
- web/src/components/sidebar/LeftMediaSidebar.tsx
- web/src/components/editor/CueTable.tsx
- web/src/api/client.ts
- tests/t26/*
- docs/research/T26_LOCKED_PLAN.md
- docs/evidence/T26_*
- PLAN.md

## Forbidden
No GPL vendor, no video/model/db/secrets commits.
