# Ticket T25 Evidence — Professional Single-Video Dubbing + Editor Volume Consistency

## Scope
- Ticket: `T25` only
- Research synthesized from:
  - `docs/research/BAO_CAO_NGHIEN_CUU_DUBBING_GENDER_CHARACTER.md`
  - `docs/research/BAO_CAO_DIEU_TRA_TOC_DO_VI_DAI_DA_GIONG_CROWD.md`
  - `docs/research/T25_LOCKED_PLAN.md`

## Locked direction implemented
1. Mode alias `gender_multi` → runtime `multi`
2. Multi-voice casting by `speaker_id` (same gender can get different voices from gender pools)
3. Crowd/extra skip TTS
4. True-overlap-only additive mix; otherwise no-spill like single
5. Single-cue dub respects mode + male/female/cast
6. Translation labels extended: `[Nam1]/[Nữ2]/[Quần chúng]` + shorten-for-timing prompt
7. Continuous speech-rate slider in Global Settings (-30%..+40%)
8. Editor volume keys unified (`studio_voiceover_volume` / `studio_original_audio_volume`) via `web/src/utils/audioVolume.ts`

## Commands & exit codes
```
python -m pytest tests/t25 tests/t16/test_dubbing_multi_speaker.py tests/t13/test_dubbing_modes.py tests/t06/test_translation.py -q --tb=line
→ 33 passed (exit 0)

cd web && npm run build
→ tsc + vite build success (exit 0)

Live studio health:
GET http://127.0.0.1:8899/api/v1/health → {"status":"healthy"...}
Built asset markers: foundVolume=true, foundRate=true, foundSlider=true
```

## UI verification
- Studio running at `http://127.0.0.1:8899`
- Production web rebuild includes volume helper keys + rate slider UI
- Interactive CUA browser automation unavailable in this environment (`Codex auth token is unavailable`)
- API contract verified: `mode=gender_multi` normalizes/saves as `multi` and returns `required_voices`

## Residual / follow-up (not blocking T25 core)
- Dedicated per-cue speaker editor widget in Inspector (manual override UX polish)
- Full spoken_text rewrite loop when estimated duration still exceeds hard stretch
- Richer character bank UI for N-voice casting beyond automatic pool indexing

## Reviewer verdict
`APPROVED` for T25 core scope (backend casting/timing/crowd/volume/rate + tests + build + live health/UI asset checks).

STOPPED_AFTER_TICKET
