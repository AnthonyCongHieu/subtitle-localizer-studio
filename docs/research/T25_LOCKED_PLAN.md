# Ticket T25 — Professional Single-Video Dubbing + Editor Volume Consistency

## Mục tiêu
Tổng hợp nghiên cứu dubbing và triển khai hướng sửa triệt để cho:
1. Lồng tiếng đơn video đúng mode single/multi
2. Đúng giới tính / nhân vật đoạn thoại, đủ số giọng cần thiết (L1.5: gender + speaker_id pool)
3. Tốc độ đọc thật + fit-to-slot tách bạch hơn
4. VI dài hơn ZH: chống đè giả, stretch/no-spill đúng chuẩn
5. Bỏ TTS quần chúng (`crowd/extra`)
6. Editor: âm lượng gốc/lồng tiếng đồng nhất, chỉnh được ổn định
7. Test backend + verify UI

## Locked decisions
- Mode alias: `gender_multi` → runtime `multi`
- Overlap mix chỉ khi true temporal overlap + khác speaker
- Crowd/extra: `skip_tts`
- Unknown speaker: fallback `unknown` → dùng `voice` (không âm thầm male) khi auto_detect off; khi on vẫn heuristic nhưng không ép male nếu có `speaker_id`
- Volume keys thống nhất: `studio_original_audio_volume`, `studio_voiceover_volume`
- Rate: hỗ trợ continuous; UI settings dùng slider thật
- Character same-gender: `speaker_id` map vào voice pool theo gender

## Path allowlist
- `src/subtitle_localizer/dubbing/tts.py`
- `src/subtitle_localizer/service/server.py`
- `src/subtitle_localizer/service/project_runtime.py`
- `src/subtitle_localizer/service/pipeline_settings.py`
- `src/subtitle_localizer/translation/real.py` (prompt + parse speaker_id/role)
- `web/src/App.tsx`
- `web/src/components/timeline/BottomTimeline.tsx`
- `web/src/components/project/GlobalSettingsView.tsx`
- `web/src/api/client.ts`
- `web/src/utils/audioVolume.ts` (new)
- `tests/t25/*`
- `docs/research/*`, `docs/evidence/T25_*`, `PLAN.md`

## Forbidden
- Không vendor GPL, không commit video/model/db/secrets/outputs
