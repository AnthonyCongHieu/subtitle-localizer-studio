# Ticket T27 — Translation Quality + Local Engine Bake-off (Locked Plan)

**Ngày:** 2026-09-11  
**Mục tiêu phiên này:** Tổng hợp mọi yêu cầu liên quan chất lượng dịch / xưng hô / local engine và khóa plan fix triệt để.  
**Trạng thái:** LOCKED PLAN (chưa implement trong ticket này; implement tách ticket theo wave bên dưới).

---

## 0. Nguồn yêu cầu (tổng hợp hội thoại)

1. So sánh bản gốc ↔ bản dịch; user đánh giá **yếu**.
2. Case mẫu: `您说得对` → `Bạn nói đúng` lệch ngữ cảnh; nhìn hình thì **cô gái** đang nói với nam → phải gần `Anh nói đúng`.
3. Cải thiện phải dùng được cho **nhiều video khác nhau**, không hardcode cast/video test.
4. Dịch phải **bám sát ý gốc + đúng ngữ cảnh**: không lệch nghĩa, không word-by-word thô, không paraphrase phóng tác.
5. Bổ sung **mode local xịn nhất** vào engine dịch, dựa trên bài đánh giá/benchmark sẵn trong project.
6. **Test + so sánh API vs Local** theo nhiều cột chất lượng/tốc độ.
7. Liên hệ sẵn có: nhãn `[Nam]/[Nữ]`, prompt anh–em, glossary, dubbing gender research (T25/T26), benchmark scripts.

---

## 1. Chẩn đoán gốc rễ (không phải chỉ “model kém”)

| # | Lỗi quan sát | Gốc rễ hệ thống | Ảnh hưởng |
|---|---|---|---|
| R1 | `Bạn` thay vì `anh/em` | Prompt chưa đủ mạnh + không có `addressing_mode` / character context theo project | Phim tình cảm nghe lạnh, sai vai |
| R2 | `Đó là vấn đề của tôi` cho `是我的问题` | Calque + refine chưa bắt idiom nhận lỗi | Sai nghĩa/ngữ vực |
| R3 | `Bạn sao rồi` cho `你怎么了` | Sai sắc thái hỏi thăm vs hỏi bất thường | Lệch ngữ cảnh thoại |
| R4 | Không “biết ai đang nói” từ hình | Pipeline text-only; speaker tag chỉ từ LLM, chưa vision | Sai xưng hô / sai giọng dub |
| R5 | Local chưa có preset “xịn nhất” | Có `run_translation_benchmark.py` (đa cột) nhưng chưa promote sweet-spot thành engine mode UI/runtime | User không chọn được local tối ưu |
| R6 | Adapter Gemma/NLLB/OPUS còn stub | T00 bake-off thiết kế nhưng runtime thật vẫn Qwen/Gemini | Không dùng được candidate local đã nghiên cứu |
| R7 | So sánh API↔Local chưa thành gate sản xuất | Benchmark có schema cột, thiếu report chạy lại + tiêu chí promote | Không chứng minh local đủ tốt |

---

## 2. Nguyên tắc khóa (áp dụng mọi video)

1. **Video-agnostic:** không hardcode tên nhân vật/phim test trong code mặc định.
2. **Per-project/series context:** `character_context` (free-text) + `addressing_mode` do user/series set.
3. **Fidelity band:** bám sát ý + cảm xúc + quan hệ; rút gọn khẩu ngữ phụ đề; cấm bịa plot; cấm dịch thô từng chữ.
4. **Evidence-first promote:** local “xịn nhất” chỉ được gắn default/preset sau khi benchmark đa cột thắng hoặc nằm trong ngưỡng so với Gemini baseline.
5. **Tách wave:** chất lượng dịch text trước; vision speaker sau; không trộn GPL / không commit model-weights/outputs/secrets.

---

## 3. Thiết kế sản phẩm khóa

### 3.1 TranslationSettings (mở rộng)

```text
addressing_mode: "auto" | "couple_anh_em" | "neutral"   # default auto
character_context: str = ""                              # ghi chú nhân vật/quan hệ theo project/series
local_quality_preset: "manual" | "sweet_spot" | "best_quality" | "fastest"
local_model: giữ lựa chọn hiện có + preset map sang model/batch/temp/tone/post
```

- `auto`: drama/daily → ưu tiên anh–em khi hội thoại đôi/gia đình; cấm `bạn` làm xưng hô chính.
- `couple_anh_em`: ép polish đại từ theo speaker gender (nữ→xưng `anh`, nam→xưng `em`) cho mọi short couple, không cần tên riêng.
- `neutral`: tài liệu/cast đông/không rõ quan hệ — giữ `bạn` khi cần.

### 3.2 Prompt fidelity (mọi provider narrative)

Bắt buộc có khối:
- Bám sát ý gốc; không thêm tình tiết.
- Không dịch word-by-word thô; không calque kiểu `vấn đề của tôi` cho `是我的问题`.
- `你怎么了` = `sao vậy/có sao không`, không `sao rồi`.
- Inject `character_context` nếu non-empty.
- Rule addressing theo `addressing_mode`.
- Giữ `[i] [Nam|Nữ|...] câu`.

### 3.3 Post-process tổng quát (không gắn 1 video)

1. `_refine_subtitles`: sửa idiom/calque phổ biến ZH→VI.
2. `_polish_addressing(text, source, speaker_gender, addressing_mode)`: chỉ rewrite `Bạn` khi mode cho phép + có speaker.
3. Áp dụng trong `_apply_model_response` sau parse speaker.

### 3.4 Engine local “xịn nhất”

Dựa trên `benchmarks/run_translation_benchmark.py` + `run_remote_models_benchmark.py` + T00 matrix:

**Cột so sánh bắt buộc**
`Time s | ms/cue | cue/s | tok/s | BLEU | ChrF | Lev% | Lex% | Vai% | Đại từ% | Slang% | ID% | Quality | Sweet`

**Candidates local**
- Qwen2.5 `7b` / `14b` (đã có trong settings)
- TranslateGemma 4B, MADLAD-400 3B, NLLB-600M, OPUS-MT (T00; hiện adapter stub → cần runtime thật hoặc loại khỏi UI nếu license/VRAM fail)

**Promote rule**
- `sweet_spot` = max(0.7*quality + 0.3*speed_norm)
- `best_quality` = max(quality_composite)
- Local preset được gắn nhãn UI chỉ khi chạy benchmark ra artifact mới dưới `benchmarks/results/` và quality_composite không kém Gemini baseline quá ngưỡng khóa **≤ 2.0 điểm** (theo spec T00 “no more than a two-point quality loss”), trừ khi user chủ động chọn local-only.

### 3.5 Speaker từ hình (Phase B, không chặn Phase A)

- Với mỗi cue: lấy frame mid-slot → heuristic face/mouth / VLM nhẹ → `style.speaker` prior.
- Prior này đưa vào prompt + dubbing; user vẫn override trong editor (T26).
- Bắt buộc video-agnostic; không train riêng 1 phim.

---

## 4. Work breakdown (tickets implement)

### Wave A — T27a: Fidelity + Addressing (P0)
**Goal:** hết calque yếu + xưng hô đúng theo mode, chạy mọi video.  
**Allowlist:**
- `src/subtitle_localizer/service/pipeline_settings.py`
- `src/subtitle_localizer/translation/real.py`
- `src/subtitle_localizer/service/server.py` (test-translation request fields nếu cần)
- `web/src/api/client.ts`
- `web/src/components/project/GlobalSettingsView.tsx`
- `web/src/components/project/DashboardBatchHub.tsx`
- `tests/t06/test_translation_context_fidelity.py` (đã RED sẵn)
- `docs/evidence/T27a_*`

**Acceptance**
- Refine: `是我的问题` ↛ `vấn đề của tôi`; `你怎么了` ↛ `sao rồi`.
- `couple_anh_em` + speaker nữ: `Bạn nói đúng` → `Anh nói đúng`.
- `neutral` giữ `Bạn`.
- Prompt chứa `character_context` + fidelity rules.
- Không hardcode tên cast test trong default glossary bắt buộc.
- Tests t06 fidelity xanh; regression `tests/t06/test_translation.py` xanh.

### Wave B — T27b: Local Sweet-Spot Engine Mode (P0)
**Goal:** thêm mode/preset local xịn nhất từ đánh giá có sẵn + chạy lại so sánh API↔Local đa cột.  
**Allowlist:**
- `benchmarks/run_translation_benchmark.py`
- `benchmarks/run_remote_models_benchmark.py` (nếu cần)
- `src/subtitle_localizer/translation/real.py` (preset batch/temp/tone/post)
- `src/subtitle_localizer/translation/registry.py` / adapters (chỉ nếu promote model non-stub)
- `src/subtitle_localizer/service/pipeline_settings.py`
- `web/src/...` engine select UI
- `benchmarks/results/translation_benchmark_*` (generate locally; không commit weights)
- `docs/evidence/T27b_*`

**Acceptance**
- Có report markdown/json đa cột: Gemini baseline vs local configs/models.
- UI/runtime có preset `sweet_spot` / `best_quality` map đúng config thắng.
- Khuyến nghị production ghi rõ khi nào dùng Gemini vs Local.

### Wave C — T27c: Speaker consistency + editor loop (P1)
**Goal:** speaker label ổn định xuyên batch; UI sửa được; ăn khớp dubbing T25/T26.  
**Allowlist:** translation parse continuity + cue editor speaker fields (tái sử dụng T26) + tests.

### Wave D — T27d: Vision speaker prior (P2)
**Goal:** prior giới tính từ frame; fallback LLM; không phá offline local.

---

## 5. Trạng thái hiện tại (evidence)

- Đã có test đỏ: `tests/t06/test_translation_context_fidelity.py` (5 fail) — neo acceptance Wave A.
- `addressing_mode` / `character_context` / `_polish_addressing` **chưa** có trong runtime (patch trước đó bị abort).
- Benchmark harness đa cột **đã có** trong `benchmarks/run_translation_benchmark.py`; thư mục `benchmarks/results/` có thể chưa có artifact mới.
- Adapter Gemma/NLLB/OPUS vẫn stub trong `translation/adapters.py`.

---

## 6. Thứ tự triển khai khóa

1. **T27a** (text fidelity + addressing + UI settings)  
2. **T27b** (benchmark API vs local + promote local preset)  
3. **T27c** (speaker continuity/editor)  
4. **T27d** (vision prior)

Không gộp A+B+D trong một session nếu vượt allowlist/ticket discipline.

---

## 7. Forbidden

- Không hardcode phụ đề/cast của 1 video test làm default toàn cục.
- Không vendor GPL; không commit videos/models/proxies/caches/outputs/databases/secrets.
- Không hạ fidelity bằng cách chỉ “làm test xanh” mà bỏ so sánh đa cột ở Wave B.

---

## 8. Definition of Done cho PLAN này

- Tài liệu này tồn tại và bao phủ đủ yêu cầu mục 0.
- Có decomposition ticket + acceptance + allowlist.
- Có nguyên tắc video-agnostic + fidelity band + promote rule local.
- Sẵn sàng xin duyệt **implement T27a** ở session kế tiếp.
