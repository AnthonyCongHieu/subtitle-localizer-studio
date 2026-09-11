# Báo cáo điều tra bổ sung: Tốc độ thật, VI dài hơn ZH, đa giọng chuẩn, chống đè & bỏ quần chúng

**Ngày:** 2026-09-11  
**Liên quan:** `docs/research/BAO_CAO_NGHIEN_CUU_DUBBING_GENDER_CHARACTER.md`  
**Phạm vi:** Điều tra tiếp 4 yêu cầu; **chưa sửa code / chưa test UI**.

---

## Câu 1 — Tốc độ nhanh/chậm thật, chuyên nghiệp (đơn + đa)

### Chuẩn nghề
Tách **2 lớp tốc độ**, không gộp một cục:

| Lớp | Ý nghĩa | Ai chỉnh | Mục tiêu |
|---|---|---|---|
| **A. Base speaking rate** | Phong cách đọc (chậm lắng / nhanh gấp) | User | Cảm xúc, thương hiệu giọng |
| **B. Fit-to-slot** | Co giãn để khớp khung thời gian cue | Engine | Sync, chống tràn câu sau |

Studio chuyên nghiệp không dùng 1 nút “tốc độ” để vừa làm nghệ thuật vừa vá timing.

### Hiện trạng repo
**Đã có nền thật (không phải fake):**
- Edge-TTS: `rate="+10%"` native.
- CapCut: SSML `<prosody rate="...">`.
- Gemini: không có rate gốc → `apply_speaking_rate_to_audio()` bằng FFmpeg `atempo` (giữ pitch).
- Parser `parse_speaking_rate` hỗ trợ khoảng **0.5x → 2.0x**.
- Sau TTS còn **slot stretch tự động tới 1.45x**.

**Chưa đủ chuyên nghiệp:**
1. Global Settings đơn video chỉ preset cứng: `-10% / +0% / +10% / +20%`.
2. Batch UI lại dùng set khác: `0.85 / 1.0 / 1.15 / 1.25 / 1.35x` → lệch UX.
3. Không có slider liên tục + ô nhập chính xác (vd `1.12x`).
4. User rate và auto-stretch **cộng dồn** → dễ thành giọng quá nhanh/không tự nhiên.
5. Không có rate theo từng cue.
6. Không hiện “tốc độ hiệu dụng” = base × fit.

### Đề xuất chuẩn triển khai
1. UI chung cho đơn/đa:
   - Slider liên tục **0.70x → 1.40x** (base rate).
   - Hiển thị `%` và `x` realtime.
2. Policy fit-to-slot tách riêng:
   - `off` | `soft≤1.20` | `normal≤1.35` | `hard≤1.45`
3. Ưu tiên rút gọn lời dịch trước khi stretch mạnh.
4. Optional: rate override theo cue.
5. Preview nghe phải phản ánh **đúng rate sẽ render**.

---

## Câu 2 — Trung → Việt dài hơn / nói lâu hơn thì giải quyết thế nào?

Đây là bài toán kinh điển **language expansion** (ZH ngắn, VI/EN thường dài hơn).

### Pipeline chuẩn thế giới (ưu tiên từ trên xuống)

```text
1) Dubbing script adaptation (rút gọn/biên dịch khớp thời lượng)
2) Ngân sách đọc: CPS / giây slot / số tiếng
3) Base rate vừa phải
4) Time-stretch giữ pitch trong ngưỡng tự nhiên
5) Mượn khoảng lặng tới câu kế (nếu không overlap thật)
6) Trim/fade đuôi như last resort
7) Cấm để câu tràn đè câu sau khi không phải 2 người nói cùng lúc
```

### Hiện trạng repo
**Đang làm ở tầng audio (tầng dưới):**
- `calculate_slot_stretch` tăng tốc nếu audio > slot, cap **1.45x**.
- Mode `single`: slot có thể = thời gian tới câu kế (`until_next`), rồi `fade_trim` chống spill.
- Mode `multi`: **không trim theo câu kế**, cho phép cộng sóng (additive mix).

**Chưa làm ở tầng lời (tầng trên — quan trọng nhất):**
- Prompt dịch hiện bắt `[Nam]/[Nữ]`, **không** yêu cầu bản dịch khớp độ dài/thời lượng đọc.
- Không có “dubbing script” khác “subtitle script”.
- Không có cảnh báo CPS / “câu quá dài so với slot”.
- Nếu VI dài vượt 1.45x:
  - `single`: bị cắt đuôi → mất chữ.
  - `multi`: dễ **đè câu sau** dù không phải nói đồng thời.

### Cách giải quyết đúng cho Studio
1. **Translation-for-dubbing mode**
   - Prompt thêm: giữ nghĩa, rút gọn khẩu ngữ, ưu tiên ngắn hơn phụ đề đọc.
   - Target: đọc hết trong `slot_duration` ở rate ≈ 1.0–1.15x.
2. **Length budget trước TTS**
   - Ước lượng: `expected_sec ≈ f(số tiếng VI, base_rate)`.
   - Nếu vượt slot: rút gọn lại bằng LLM (1 pass ngắn) hoặc đánh dấu cue cần review.
3. **Chỉ stretch sau khi lời đã hợp lý**
   - Soft stretch ≤ 1.20x là “nghe chuyên nghiệp”.
   - > 1.35x = chất lượng giảm rõ.
4. **Phụ đề trên màn hình có thể dài hơn lời đọc**
   - Có thể giữ bản dịch đầy đủ để burn-in, còn TTS dùng bản rút gọn (`spoken_text`).
   - Đây là tách track chuẩn nghề: *reading text* ≠ *spoken text*.

### Công thức thực dụng đề xuất
```text
spoken_text = translated_text_adapted_for_duration
speech = TTS(spoken_text, base_rate)
if duration(speech) > slot:
    stretch <= max_fit_policy
if still > slot and mode != true_overlap:
    fade_trim to next boundary
flag cue if compression/stretch exceeded threshold
```

---

## Câu 3 — Đa giọng cực chuẩn: đúng nhân vật, đủ số giọng, không đè, bỏ quần chúng?

### 3.1. Gen chuẩn đúng nhân vật + đủ số giọng
**Không thể cực chuẩn nếu chỉ có Nam/Nữ.**  
Cùng giới tính bắt buộc cần `speaker_id`.

Pipeline đề xuất:
1. Khi dịch: gắn
   - `gender`
   - `speaker_id` (nu_chinh, nam_phu, me, narrator...)
   - `speaker_role` (`main|support|narrator|crowd|extra`)
2. `required_voices = unique(speaker_id where role in {main,support,narrator})`
3. Cast map: mỗi `speaker_id` → 1 `voice_id` (cùng gender vẫn khác timbre)
4. TTS theo `speaker_id`, không theo gender pool chung
5. UI cho sửa sai nhanh từng cue + bảng nhân vật

Nền sẵn có để làm nhanh:
- `cue.style` mở
- dịch context 1-shot/large batch
- glossary tên nhân vật
- nhiều giọng male/female trong catalog

### 3.2. Không đè nhau trừ khi nói cùng lúc
Hiện trạng:
- `mix_voice_pcm`:
  - `single`: trim tới `next_start` → không stack narration.
  - `multi`: **cố ý additive** cho overlap thật.

Rủi ro:
- Cue tuần tự nhưng TTS dài → mode multi bị đè giả.
- OCR timing hơi chồng → đè dù không phải “nói cùng lúc” thực sự.

Chuẩn cần làm:
```text
true_overlap =
  cueA overlaps cueB in timeline
  AND speaker_idA != speaker_idB
  AND both are speakable roles

if true_overlap: additive mix (cho phép đè)
else: fit-to-slot + no-spill trim như single
```

Nói cách khác: **multi = nhiều giọng, không mặc định = luôn được overlap.**  
Overlap chỉ khi timeline + nhân vật chứng minh nói đồng thời.

### 3.3. Tiếng quần chúng / đám đông có bỏ qua được không?
**Có — và nên bỏ qua TTS.**

Chuẩn nghề:
- Crowd/walla/extras thường **không cast VA riêng**.
- Giữ ambience gốc (có ducking) hoặc bỏ sạch lời TTS.
- Chỉ lồng các nhân vật có identity.

Cách nhận diện (kết hợp):
1. LLM tag: `[Quần chúng]`, `[Đám đông]`, `[Crowd]`, `众人`, `齐声` → `speaker_role=crowd`
2. Heuristic từ vựng: “mọi người”, “đám đông”, “đồng thanh”, “crowd”
3. Rule: nếu role ∈ `{crowd, extra, walla}` → `skip_tts=true`
4. UI vẫn hiện cue phụ đề, nhưng track lồng tiếng bỏ qua
5. Không tính crowd vào `required_voices`

Hiện trạng:
- `clean_subtitle_text` đã bỏ `(Nhạc)`, `*hành động*`, ký hiệu nhạc.
- **Chưa** có lọc crowd/extra/`speaker_role`.
- OCR style `accurate_dialogue` lọc logo/rác, không phải quần chúng.

---

## Tổng hợp khoảng trống ưu tiên (để ticket hóa)

| # | Vấn đề | Mức | Hướng fix |
|---|---|---|---|
| 1 | Rate UI không liên tục, lệch batch vs global | Cao | Slider thật 0.70–1.40x cho cả đơn/đa |
| 2 | Base rate bị cộng dồn với stretch | Cao | Tách policy base vs fit-to-slot |
| 3 | VI dài hơn ZH chưa xử lý ở tầng dịch | Rất cao | `spoken_text` rút gọn theo slot + CPS budget |
| 4 | Multi dễ đè giả khi câu dài | Rất cao | Overlap chỉ khi true simultaneous speech |
| 5 | Chưa có speaker_id / đủ giọng cùng giới | Rất cao | Character cast map |
| 6 | Chưa skip quần chúng | Cao | `speaker_role=crowd` → skip TTS |
| 7 | Chưa cảnh báo cue quá dài / stretch quá ngưỡng | Trung | Flag review trên UI |

---

## Kiến trúc đích (gộp câu 1–3)

```text
Translate
  → gender + speaker_id + speaker_role
  → adapted spoken_text (khớp duration)
Review UI
  → sửa speaker, nghe thử, hiện voices_needed
Cast
  → speaker_id → voice_id (skip crowd)
Synthesize
  → base_rate user
Fit
  → stretch theo policy
Mix
  → no-spill mặc định
  → additive chỉ khi true_overlap
Export/Listen
  → timeline đúng giọng, không đè giả
```

---

## Đề xuất tách ticket (chưa implement)

### T24a — Timing & Rate chuyên nghiệp (đơn + đa)
- Slider rate thật
- Tách base rate / fit-to-slot
- `spoken_text` adaptation khi VI dài hơn slot
- no-spill cho multi khi không phải overlap thật
- cảnh báo CPS/stretch

### T24b — Character-accurate multi voice
- `speaker_id` + `speaker_role`
- cast N giọng (cùng giới vẫn khác giọng)
- `required_voices`
- skip crowd/extra
- single-cue resynth đúng cast

### T24c — UI verify
- Test trên UI đơn video + multi
- Case: 2 nữ, 1 crowd, 1 overlap thật, 1 câu VI dài

---

## Kết luận ngắn trả lời đúng 4 ý

1. **Tốc độ thật:** đã có backend rate thật, nhưng UI/policy chưa chuyên nghiệp; cần slider liên tục + tách fit-to-slot.  
2. **VI dài hơn ZH:** giải đúng nghề là **rút gọn lời nói (spoken adaptation)** trước, stretch chỉ là lớp phụ; hiện mới làm lớp phụ.  
3. **Đa giọng cực chuẩn:** cần `speaker_id` + cast map; overlap chỉ khi nói cùng lúc; quần chúng **nên skip TTS**.  
4. **Điều tra tiếp:** đã chốt gap kỹ thuật và hướng ticket; sẵn sàng triển khai khi bạn duyệt phạm vi.

**Trạng thái:** `RESEARCH_SUPPLEMENT_COMPLETE_AWAITING_APPROVAL`

STOPPED_AFTER_TICKET
