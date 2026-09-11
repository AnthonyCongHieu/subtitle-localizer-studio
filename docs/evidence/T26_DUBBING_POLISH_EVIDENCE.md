# Ticket T26 Evidence — Dubbing 100% Polish

## Scope
- Ticket: `T26` only
- Plan: `docs/research/T26_LOCKED_PLAN.md`

## Implemented
1. `adapt_spoken_text_for_slot` + deterministic VI compression + token-budget trim
2. Auto wire into `generate_timed_voiceover` / `splice_cue_voiceover` (respects manual `spoken_text`)
3. `assign_turn_taking_speaker_ids` for same-gender multi (A-B-A continuity; explicit ids preserved)
4. Persist cue style mutations after dubbing run / single-cue dub
5. API `POST /api/v1/projects/{id}/dubbing/adapt-spoken`
6. UI speaker editor in `LeftMediaSidebar` + `CueTable` (`speaker` / `speaker_id` / `speaker_role` / `spoken_text` / `timing_warning`)
7. Client `apiClient.adaptSpoken` + sidebar **Rút gọn** action

## Commands & exit codes
```
python -m pytest tests/t26 tests/t25 tests/t16/test_dubbing_multi_speaker.py tests/t13/test_dubbing_modes.py -q --tb=line
→ 30 passed (exit 0)

cd web && npm run build
→ tsc + vite build success (exit 0)

Live health: GET http://127.0.0.1:8899/api/v1/health → healthy
Live index references /assets/studio-BeqsUYHK.js
Built asset markers: speaker_id=true, spoken_text=true, timing_warning=true, Rut gon=true
```

## API verification (TestClient / new code)
```
POST /api/v1/projects/{id}/dubbing/adapt-spoken {"force": true}
→ 200, adapted_count=3, warned_count=1
cue styles: c1=nam_1 spoken+soft, c2=nu_1, c3=nam_1 (A-B-A)
```

## UI verification
- Production bundle served by live studio includes speaker editor + spoken_text controls
- Interactive CUA browser automation unavailable (`Codex auth token is unavailable`)
- **Note:** long-running `scripts/run_studio.py` process was started before T26 API route; hard-refresh loads new UI assets, but `adapt-spoken` on that old process may 404/405 until Studio is restarted once

## Reviewer verdict
`APPROVED` for T26 scope (spoken duration adapt + turn-taking cast + speaker editor UI + tests/build + API TestClient verify).

STOPPED_AFTER_TICKET

## Post-restart live proof (user confirmed)
- Health server_id=5d0bdb5-1819-4760-9e8d-f0ece2a9a36a`n- POST /api/v1/projects/proj-d9b39c13/dubbing/adapt-spoken → **200** mode=multi adapted=3 warned=1 required_voices=2
- Cues: c1=
am_1 spoken+soft, c2=
u_1, c3=
am_1 (A-B-A)
- Served bundle studio-BeqsUYHK.js markers: speaker_id/spoken_text/timing_warning/speaker_role/adaptSpoken=true
- pytest t26+t25: **23 passed**

