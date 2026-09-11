# Báo cáo nghiên cứu: Lồng tiếng đơn video + phân vai giới tính / nhân vật (chuẩn chuyên nghiệp)

**Ngày:** 2026-09-11  
**Phạm vi:** Nghiên cứu phương pháp tối ưu thế giới + audit pipeline hiện tại của Subtitle Localizer Studio.  
**Ràng buộc:** Báo cáo trước; **chưa sửa code / chưa test UI** trong phiên này.  
**Mục tiêu sản phẩm:** Lồng tiếng 1 video đúng chuẩn giới tính nhân vật, đúng đoạn nhân vật nói, và đủ số lượng giọng cần thiết.

---

## 1. Kết luận điều hành (TL;DR)

### Phương pháp tối ưu thế giới đang dùng
1. **Cast theo nhân vật (character casting)**, không chỉ theo binary Nam/Nữ.
2. **Một giọng ổn định cho mỗi `speaker_id` / character** xuyên suốt tập/phim.
3. **Gán vai theo đoạn thoại** (cue/segment), có thể override thủ công.
4. **Số giọng cần thiết = số nhân vật nói có thoại**, không phải cố định 1 hoặc 2.
5. **Timing chuyên nghiệp:** khớp slot phụ đề, tránh spill sang câu kế, ducking nhạc nền, review nghe từng câu.

### Với niche hiện tại của Studio (phim ngắn / drama CN→VI, CapCut/Edge/Gemini TTS)
- **Chuẩn chuyên nghiệp đầy đủ** = Character Voice Bank (`speaker_id → voice_id`).
- **Chuẩn khả thi tối ưu giai 1 (khuyến nghị ticket sắp tới)** = **Gender-correct multi (Nam/Nữ) + speaker label bền vững theo cue + UI đơn video đồng bộ settings**, vì catalog TTS hiện tại và UX đang thiết kế quanh 2 pool giọng.
- Hệ thống hiện tại **đã có xương sống** (`mode=single|multi`, `style.speaker`, dịch kèm `[Nam]/[Nữ]`), nhưng **chưa đạt chuẩn** vì còn lệch mode naming, bias mặc định male, `auto_detect_speakers` chết, single-cue dub bỏ qua giới tính, thiếu UI sửa speaker theo câu, và **không đếm/cast đúng số nhân vật**.

---

## 2. Chuẩn ngành: studio truyền thống vs AI dubbing hiện đại

### 2.1. Studio lồng tiếng truyền thống (film/TV)
Pipeline chuẩn:
1. **Script adaptation** (dịch thoại khớp khẩu hình / độ dài).
2. **Casting** theo nhân vật: tuổi, giới tính, tính cách, giai xã hội.
3. **1 VA / character** (voice actor) để giữ identity.
4. **Cueing & takes** theo đoạn nói, có director.
5. **Sync + mix**: lip-sync / timing, room tone, ducking OST.

Nguyên tắc bất biến:
- Giọng theo **nhân vật**, không theo “câu đang nghe hay”.
- Giới tính/độ tuổi phải khớp hình ảnh trừ khi đạo diễn chủ đích.
- Không đổi giọng giữa các cảnh của cùng một nhân vật.

### 2.2. AI dubbing platforms (ElevenLabs Dubbing, Rask, Dubverse, HeyGen-class)
Các hệ thống chuyên nghiệp hội tụ về kiến trúc:
1. **Speaker separation / diarization** (hoặc speaker labels từ phụ đề).
2. **Speaker tracks** tách theo người nói.
3. **Voice assignment / cloning** per speaker.
4. **Timed synthesis** khớp timeline gốc.
5. **Manual correction UI**: đổi speaker của đoạn, đổi voice cast, nghe lại từng đoạn.

ElevenLabs và các nền tảng tương tự nhấn mạnh:
- Tách speaker tracks.
- Giữ **voice consistency** theo speaker.
- Cho phép chỉnh thủ công khi auto sai.

### 2.3. Hierarchy chất lượng (từ thấp → cao)
| Cấp | Mô hình | Số giọng | Độ chân thực | Phù hợp Studio |
|---|---|---|---|---|
| L0 | Single narrator | 1 | Thuyết minh/review | Đã có (`mode=single`) |
| L1 | Binary gender pool | 2 (M/F) | Drama ngắn chấp nhận được | Đang có nhưng chưa đúng chuẩn vận hành |
| L2 | Character casting N voices | N = #characters speaking | Chuẩn chuyên nghiệp | **Mục tiêu tối ưu** |
| L3 | Diarization + clone/timbre match | N + timbre match | Gần studio | Phase sau (nặng GPU/API) |

**Khuyến nghị chiến lược:** khóa L1 cho ticket sửa triệt để trước, thiết kế contract sẵn cho L2.

---

## 3. Số lượng giọng nhân vật cần thiết (quy tắc chuyên nghiệp)

### Quy tắc đúng
```
required_voices = số nhân vật có ít nhất 1 câu thoại
```
Không phải:
- luôn 1 giọng
- luôn 2 giọng Nam/Nữ
- số câu thoại

### Heuristic thực dụng cho drama ngắn
- 1 người dẫn chuyện / review → **1 giọng**
- Hội thoại đôi Nam–Nữ → **tối thiểu 2 giọng**
- Tam giác nhân vật / phụ lục nói nhiều → **3+ giọng**
- Narrator + cast → narrator nên có giọng riêng (thường male hoặc soft female tùy format)

### Mapping khuyến nghị cho Studio
1. **single**: `voices_needed = 1` (`voice`)
2. **multi (gender)**: `voices_needed = 2` (`voice_male`, `voice_female`) — *xấp xỉ L1*
3. **character (tương lai)**: `voices_needed = unique(style.speaker_id)` + fallback gender

---

## 4. Audit kiến trúc hiện tại trong repo

### 4.1. Những gì đã đúng hướng
- `DubbingSettings.mode`: `single | multi`
- `voice` / `voice_male` / `voice_female`
- Dịch AI bắt buộc nhãn `[Nam]/[Nữ]`, parse vào `cue.style["speaker"]`
- `detect_cue_speaker()` ưu tiên `style.speaker` → tag → đại từ xưng hô
- `generate_timed_voiceover(... mode="multi")` chọn giọng theo speaker
- Batch UI có `gender_multi` và map sang `multi`
- Timeline có lane multi khi `dubbingMode === 'multi'`
- Single-video `handleDubAll` gọi `/dubbing/run` với settings project

### 4.2. Lỗ hổng gốc (root causes) khiến chưa “đúng chuẩn”

#### A. Chỉ có binary gender, chưa có character identity
- `detect_cue_speaker` chỉ trả `"male"|"female"`.
- Không có `speaker_id` / character registry / voice map N nhân vật.
- Hệ quả: 2 nhân vật nam sẽ **cùng 1 giọng**, mất tính nhân vật.

#### B. Bias mặc định `male` khi không nhận diện được
```python
# tts.py detect_cue_speaker
return "male"
```
- Với drama nghiêng nữ hoặc narrator nữ, lỗi hàng loạt nếu thiếu `style.speaker`.

#### C. `auto_detect_speakers` là setting “chết”
- Có trong `pipeline_settings`, Global Settings UI, API type.
- **Không được đọc** trong `generate_timed_voiceover` / server run.
- Bật/tắt checkbox hiện không đổi hành vi runtime.

#### D. Single-cue dub bỏ qua giới tính / mode
- `POST /cues/{cue_id}/dub` → `splice_cue_voiceover(...)` chỉ nhận 1 `voice`.
- Không gọi `detect_cue_speaker`, không dùng `voice_male/female`.
- Nghe/vá 1 câu trong mode multi có thể **sai giọng** so với full-run.

#### E. Lệch hợp đồng tên mode UI ↔ backend
- Backend/runtime: `multi`
- Batch storage UI: `gender_multi` (được map khi chạy batch)
- Nếu chỗ nào lưu/pass thẳng `gender_multi` vào backend `mode`, sẽ **không** vào nhánh phân vai (`mode == "multi"`).

#### F. Default project/global đang `mode: "single"`
- `pipeline_settings.json` mặc định `dubbing.mode = single` dù đã có `voice_male/female`.
- User bấm “Lồng tiếng” đơn video dễ ra 1 giọng nếu project chưa copy đúng custom settings `multi`.

#### G. Thiếu UI editor để sửa speaker theo câu
- Có lưu `style.speaker` từ bản dịch.
- Không thấy control editor để user đổi Nam/Nữ từng cue trước khi dub.
- Không có panel “số giọng cần thiết / bảng phân vai”.

#### H. Heuristic đại từ tiếng Việt mỏng + dễ nhiễu
- Chỉ vài pattern `anh ơi`, `em ơi`, ...
- Không có continuity (câu xen kẽ giữ identity).
- Không dùng audio diarization.

#### I. `clean_subtitle_text` xóa mọi `[...]`
- Tốt để khỏi đọc tag ra loa.
- Phụ thuộc nặng vào việc translation đã ghi `style.speaker` trước khi clean.
- Nếu tag chỉ còn trong text và style trống, độ bền detection kém hơn kỳ vọng.

---

## 5. Phương pháp tối ưu nên áp dụng cho Studio (đề xuất chuẩn)

### 5.1. Target architecture (chuẩn nghề, phased)

```
OCR/Import cues
   → Translate + Speaker Labeling (LLM: gender + optional character_id)
   → Speaker Review UI (user override per cue)
   → Voice Casting
        - single: 1 voice
        - gender_multi: male/female voices
        - character (phase 2): map speaker_id → voice_id
   → TTS per cue bằng voice đã cast
   → Slot time-stretch + fade + master mix + ducking
   → Timeline listen / single-cue resynth đúng voice cast
```

### 5.2. Contract dữ liệu khuyến nghị
Trên mỗi cue:
```json
{
  "style": {
    "speaker": "female",              // gender enum: male|female|unknown
    "speaker_id": "char_heroine",     // phase 2
    "speaker_name": "Nữ chính",       // phase 2
    "voice_id": "vi-VN-HoaiMyNeural"  // optional override
  }
}
```

### 5.3. Quy tắc chọn giọng runtime
1. Nếu có `style.voice_id` → dùng override.
2. Else nếu mode=`character` và có `speaker_id` trong cast map → voice map.
3. Else nếu mode=`multi`/`gender_multi`:
   - ưu tiên `style.speaker`
   - nếu thiếu và `auto_detect_speakers=true` → heuristic/LLM detect
   - nếu vẫn `unknown` → **không mặc định male**; dùng policy rõ ràng (ví dụ `voice` fallback hoặc flag review)
4. Else mode=`single` → `voice`.

### 5.4. Số giọng cần thiết (UI phải hiện)
- `single`: 1
- `multi`: 2 (và cảnh báo nếu thiếu male/female voice)
- `character`: count unique speaker_id có thoại > 0; highlight nhân vật chưa gán giọng

---

## 6. Gap matrix: Hiện trạng vs Chuẩn cần đạt

| Hạng mục | Chuẩn chuyên nghiệp | Hiện trạng | Mức độ | Fix ticket đề xuất |
|---|---|---|---|---|
| Đơn video dùng đúng settings mode/voice | Bắt buộc | Có đường đi nhưng default/single dễ lệch | Cao | T24a |
| Phân đúng giới tính theo đoạn | Bắt buộc với multi | Có, nhưng bias male + detect flag chết | Cao | T24a |
| Đủ số giọng cần thiết | = #characters (hoặc 2 ở L1) | Hard-coded 1 hoặc 2; không báo cáo | Cao | T24a (L1) / T24b (L2) |
| Single-cue resynth đúng giọng cast | Bắt buộc | Sai (1 voice) | Cao | T24a |
| UI sửa speaker theo cue | Bắt buộc ở studio | Thiếu | Cao | T24a |
| Character-level casting | Chuẩn nghề | Chưa có | Trung (phase 2) | T24b |
| Audio diarization | Tốt nhất khi không có label | Chưa có | Thấp-trung | T25+ |

---

## 7. Đề xuất ticket triển khai (chưa làm trong phiên nghiên cứu)

### Ticket T24a — Gender-correct single-video dubbing (L1 triệt để)
**Mục tiêu:** Lồng tiếng 1 video đúng mode, đúng giới tính đoạn thoại, đúng 1/2 giọng cần thiết, test UI.

**Allowlist dự kiến:**
- `src/subtitle_localizer/dubbing/tts.py`
- `src/subtitle_localizer/service/server.py`
- `src/subtitle_localizer/service/project_runtime.py`
- `src/subtitle_localizer/service/pipeline_settings.py`
- `web/src/App.tsx` + editor/timeline components liên quan speaker/dub
- `web/src/api/client.ts`
- `web/src/utils/batchSettingsStorage.ts` (chuẩn hoá mode alias)
- `tests/t13/*`, `tests/t16/*`, test UI/contract mới

**Hạng mục sửa:**
1. Chuẩn hoá mode alias: chấp nhận `multi` và `gender_multi` → runtime `multi`.
2. Wire `auto_detect_speakers` thật sự trong multi mode.
3. Đổi policy unknown-speaker: bỏ bias âm thầm sang male; dùng fallback có kiểm soát + metrics.
4. `splice_cue_voiceover` / single-cue API tôn trọng mode + speaker + male/female voices.
5. Trước khi synth: đảm bảo cue có `style.speaker` (từ existing / detect / optional refresh).
6. UI đơn video:
   - chọn mode single/multi
   - chọn voice / voice_male / voice_female
   - hiện `voices_needed`
   - cho sửa Nam/Nữ từng cue
7. Full-run đơn video luôn gửi đủ payload mode+voices (không phụ thuộc object settings thiếu field).
8. Red-first tests + verification UI.

**Acceptance:**
- Mode single → mọi cue 1 voice.
- Mode multi + cues có speaker female/male → đúng voice_female/voice_male.
- Cue chưa có speaker + auto_detect on → gán được theo tag/pronoun; unknown không âm thầm thành male nếu policy mới cấm.
- Nút dub 1 câu trong multi dùng đúng giọng theo speaker cue.
- UI hiện số giọng cần thiết = 1 hoặc 2 tương ứng mode.
- UTF-8 VI/ZH/JA/KO sạch.

### Ticket T24b — Character voice bank (L2, phiên sau)
- `speaker_id` + cast map N voices
- UI bảng nhân vật
- optional LLM character clustering
- diarization optional

---

## 8. Kế hoạch kiểm thử sau khi được duyệt (chưa chạy)

### Red-first (backend)
1. `detect_cue_speaker` unknown policy
2. `generate_timed_voiceover` mode alias `gender_multi`
3. `auto_detect_speakers=false` tôn trọng `style.speaker` sẵn có, không heuristic override
4. single-cue dub multi picks female voice for female cue
5. voices_needed helper / API metrics

### UI
1. Mở 1 project video có cues đã dịch có `[Nam]/[Nữ]`
2. Settings project: mode multi + 2 giọng khác nhau
3. Bấm lồng tiếng toàn video
4. Nghe timeline: xen kẽ nam/nữ đúng
5. Đổi 1 cue sang giới tính ngược → dub lại câu đó → giọng đổi đúng
6. Chuyển mode single → full dub lại → 1 giọng

### Regression
- `tests/t13/test_dubbing.py`
- `tests/t13/test_dubbing_modes.py`
- `tests/t16/test_dubbing_multi_speaker.py`
- `tests/t06/test_translation.py` (speaker parse)
- adjacent TTS provider tests nếu đụng contract

---

## 9. Rủi ro & quyết định cần chốt trước khi code

1. **Unknown speaker policy:** fallback `voice` (single voice) hay bắt user review?
2. **Phạm vi T24a có làm UI sửa speaker từng cue không?** (Khuyến nghị: CÓ, vì thiếu cái này không “triệt để”.)
3. **Có nâng L2 character casting ngay không?** (Khuyến nghị: KHÔNG trong cùng ticket; dễ phình scope.)
4. **Narrator:** map vào male/female theo nhãn dịch, hay giọng narrator riêng? (L1: theo nhãn; L2: `speaker_id=narrator`.)

---

## 10. Quyết nghị phiên nghiên cứu

- Đã nghiên cứu chuẩn thế giới + audit code hiện tại.
- **Chưa sửa / chưa test UI** theo yêu cầu “nghiên cứu báo cáo trước”.
- Phương án tối ưu khả thi ngay: **T24a = Gender-correct L1 triệt để cho đơn video + segment speaker + đúng số giọng 1/2**.
- Phương án tối ưu nghề dài hạn: **T24b = Character casting N voices**.

**Trạng thái:** `RESEARCH_COMPLETE_AWAITING_TICKET_APPROVAL`

STOPPED_AFTER_TICKET
