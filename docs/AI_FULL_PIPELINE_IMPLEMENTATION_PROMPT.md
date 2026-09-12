# PROMPT HỢP ĐỒNG: TRIỂN KHAI TAB FULL-PIPELINE

> Dùng nguyên văn tài liệu này làm prompt giao việc cho coding agent. Agent không được coi nhiệm vụ là hoàn tất nếu chưa cung cấp đủ bằng chứng backend, UI, pipeline thật và kiểm duyệt độc lập.

## 0. Vai trò của bạn

Bạn là coding agent chịu trách nhiệm phân tích, thiết kế, triển khai, kiểm thử và bàn giao một tính năng production cho Subtitle Localizer Studio.

Bạn phải làm việc như một kỹ sư senior:

- Đọc và tuân thủ AGENTS.md trước khi sửa file.
- Hiểu kiến trúc hiện tại trước khi thiết kế mới.
- Tái sử dụng downloader, project, stage, OCR, translation, dubbing, export và editor hiện có.
- Không tạo pipeline song song hoặc editor thứ hai nếu contract hiện tại có thể dùng lại.
- Mỗi phiên chỉ xử lý ticket này, không tự mở rộng sang việc không liên quan.
- Không dùng mock trong production workflow.
- Không che giấu lỗi bằng broad exception, trạng thái thành công giả, output rỗng hoặc fallback im lặng.
- Không làm hỏng UTF-8, tiếng Việt, Trung, Nhật, Hàn hoặc các ký tự Unicode khác.
- Không commit video, model, cache, proxy, database, secret, output lớn hoặc artifact tạm.
- Mọi kết luận phải có bằng chứng: file, lệnh, exit code, log, screenshot hoặc artifact có thể kiểm tra.

Không được tuyên bố DONE chỉ vì code compile hoặc unit test xanh.

## 1. Mục tiêu sản phẩm

Thêm một tab đơn giản cho phép người dùng:

Dán link → xác nhận → tải → tự tìm ROI → OCR → dịch → lồng tiếng → che phụ đề → xuất MP4 → mở editor

Tab phục vụ một video từ một link theo mặc định. Nguồn ngôn ngữ mặc định là auto, đích mặc định là vi.

Sau khi workflow hoàn tất, ứng dụng phải tự mở project trong editor chi tiết, nạp được video, cue, bản dịch, ROI/mask, voiceover, waveform, stage status và file xuất.

Nếu một provider lỗi, hệ thống được phép fallback. Nếu mọi fallback của stage đều thất bại hoặc quality gate tối thiểu không đạt, workflow phải dừng rõ ràng ở needs_review hoặc failed; tuyệt đối không tạo output giả.

## 2. Phạm vi

### Bao gồm

- Tab Full Pipeline trong khu vực downloader.
- Ô paste URL và nút phân tích link.
- Preview thông tin video trước khi chạy.
- Modal xác nhận tương tự hàng đợi tải, có thêm setting video/pipeline tối giản.
- Backend orchestrator bền vững, chạy độc lập với trình duyệt.
- Theo dõi workflow theo stage và khôi phục sau reload/restart.
- Tải video, tạo project, auto-detect ROI, OCR, dịch, TTS, che phụ đề và export.
- Fallback provider có ghi nhận.
- Retry stage và cancel an toàn.
- Tự động mở editor sau khi hoàn tất.
- Lịch sử workflow và mở lại project đã hoàn thành hoặc cần review.

### Không bao gồm

- Không xây editor mới.
- Không thay thế downloader hoặc queue hiện tại.
- Không mặc định chạy toàn bộ series.
- Không đưa toàn bộ cấu hình kỹ thuật OCR/API/encoder lên màn hình chính.
- Không thay đổi toàn bộ schema project nếu không cần.
- Không thêm phụ thuộc nặng nếu chức năng hiện tại đã đáp ứng.
- Không giảm quality gate chỉ để làm test pass.

## 3. Quy trình thực thi bắt buộc

### Phase A — Khảo sát

1. Đọc AGENTS.md, README.md, tài liệu kiến trúc và hướng dẫn chạy dự án.
2. Tìm component/API/backend hiện có cho parse/download URL, queue, create project, OCR/dịch, auto-detect ROI, dubbing, export, stages và editor navigation/loading.
3. Lập bản đồ luồng hiện tại, nêu rõ file và symbol sẽ tái sử dụng.
4. Kiểm tra public contract, types, persistence và test hiện có.
5. Ghi rủi ro kiến trúc trước khi sửa.

### Phase B — Thiết kế trước code

Tạo kế hoạch kỹ thuật ngắn, quyết định đầy đủ:

- state machine workflow;
- API request/response;
- persistence/idempotency;
- retry/cancel/resume;
- mapping setting UI → backend;
- quality gates;
- artifact và telemetry;
- chiến lược test.

Không bắt đầu sửa code khi chưa xác định được các contract trên.

### Phase C — Test đỏ

Viết test trước cho contract mới, tối thiểu gồm tạo workflow, state transition, idempotency, retry/cancel, reload/resume, fallback, quality gate failure và output path validation.

Test phải fail vì hành vi chưa tồn tại, không được viết test vô nghĩa chỉ kiểm tra object có tồn tại.

### Phase D — Triển khai theo lớp

1. Backend orchestration và persistence.
2. API schema/client/types.
3. UI tab, preview và confirmation modal.
4. Progress/history/retry/cancel.
5. Editor auto-open và project hydration.
6. Quality gates, fallback và artifact validation.
7. Integration/E2E.

### Phase E — Kiểm chứng

Chạy unit, API/integration, frontend typecheck/build/test, backend thật, UI browser thật, pipeline representative thật, ffprobe/audio/subtitle/Unicode/artifact checks và regression liên quan.

### Phase F — Bàn giao reviewer

Khi chưa có đủ bằng chứng, trạng thái chỉ được là READY_FOR_REVIEW hoặc BLOCKED.

Không trả DONE trước khi reviewer độc lập trả APPROVED.

## 4. State machine workflow

Workflow phải có trạng thái rõ ràng, lưu bền vững và không phụ thuộc lifecycle của browser tab:

\`\`\`
queued -> downloading -> detecting_roi -> ocr -> translating -> dubbing -> exporting -> completed
\`\`\`

Nhánh lỗi:

\`\`\`
any active state -> retrying -> same state
any active state -> needs_review
any active state -> failed
any active state -> cancelled
\`\`\`

Yêu cầu:

- Mỗi transition hợp lệ phải được kiểm tra.
- Không nhảy sang completed nếu stage bắt buộc chưa xong.
- completed chỉ được ghi sau khi export verify thành công.
- needs_review dùng khi có output nhưng cảnh báo chất lượng cần người kiểm tra.
- failed dùng khi stage không tạo được artifact tối thiểu.
- cancelled phải dừng tác vụ đang chạy và giữ log/artifact an toàn.
- Workflow đã hoàn tất không được chạy trùng khi UI reload.
- Cùng input/settings/idempotency key không tạo workflow trùng ngoài chủ ý.

## 5. Backend contract bắt buộc

Tên route có thể điều chỉnh theo convention hiện tại, nhưng phải cung cấp đủ capability sau và không phá public API cũ.

### Preview

POST /api/v1/workflows/full-pipeline/preview

Input tối thiểu:

\`\`\`json
{
  "url": "...",
  "source_language": "auto",
  "target_language": "vi"
}
\`\`\`

Output phải có nếu lấy được: canonical URL, platform, title, thumbnail, duration, size estimate, available resolutions, series/video classification, warnings và normalized target info.

### Create workflow

POST /api/v1/workflows/full-pipeline

Phải trả về workflow_id, trạng thái ban đầu, project_id nếu đã tạo được, stage list, normalized settings và created timestamp.

### Status

GET /api/v1/workflows/{workflow_id}

Phải trả về workflow state, current stage, tổng progress, stage progress, project id, retry count, fallback events, warnings/errors, artifacts, quality metrics, timestamps và output path nếu đã có.

### Control

- POST /api/v1/workflows/{workflow_id}/cancel
- POST /api/v1/workflows/{workflow_id}/retry

Retry phải cho phép retry stage lỗi hoặc retry workflow theo policy rõ ràng. Không chạy lại stage đã valid nếu không cần thiết.

## 6. Setting UI tối giản

Màn hình xác nhận chỉ hiển thị setting người dùng thực sự cần.

### Nguồn/tải

- URL;
- tiêu đề/thumbnail/thời lượng;
- một video từ link theo mặc định;
- quality: auto/best, 720p, 1080p;
- output directory;
- cookie/proxy chỉ hiển thị khi hệ thống cần.

### Xử lý

- source language: auto;
- target language: Vietnamese;
- OCR: Auto quality;
- translation: Auto quality;
- dubbing: on/off;
- voice: default Vietnamese voice hoặc auto cast;
- auto-fit speaking speed.

### Xuất

- format: MP4;
- resolution: original;
- auto mask original subtitles: on;
- burn-in Vietnamese subtitles: on/off;
- export SRT/ASS: on;
- mask mode: auto soft.

Không hiển thị toàn bộ thông số model, ROI, concurrency, encoder, provider endpoint trên màn hình chính. Setting nâng cao nằm ở màn hình settings/editor hiện có.

## 7. Quality gates bắt buộc

### Download gate

- URL được parse đúng.
- File nằm đúng output directory.
- File tồn tại và size > 0.
- Container/media probe hợp lệ.
- Có video stream.
- Duration hợp lệ.
- Không dùng .part, file tạm hoặc file chưa hoàn tất.

### ROI/OCR gate

- ROI nằm trong [0,1].
- width/height > 0.
- ROI được lưu vào project.
- Có evidence frame hoặc metric auto-detect.
- Cue có source text hợp lệ.
- Timing không âm và end > start.
- Không có overlap bất thường ngoài ngưỡng.
- Không có mock marker như Sample text hoặc mock-ocr.
- Không có cue thì phải fallback hoặc dừng, không coi là thành công.

### Translation gate

- Cue source tồn tại.
- translated_text không rỗng.
- Count bản dịch đạt policy.
- Bảo toàn Unicode.
- Không rò rỉ nguyên văn nguồn ngoài tên riêng hợp lệ.
- Lỗi cloud phải ghi fallback provider/model.
- Mọi provider lỗi thì workflow dừng rõ ràng.

### Dubbing gate

- Voiceover tồn tại và size > 0.
- Decode được bằng FFmpeg/audio probe.
- Không chỉ chứa silence.
- Duration phù hợp video.
- Cue overflow được ghi nhận và xử lý.
- Provider, voice, mode và rate được lưu metadata.
- Lỗi TTS không được nuốt.

### Export gate

- MP4 tồn tại và size > 0.
- ffprobe có video stream.
- Có audio stream khi dubbing bật.
- Duration trong ngưỡng hợp lệ.
- Subtitle/mask render thành công.
- Output path nằm trong project output root.
- has_export=true chỉ sau khi verify toàn bộ.
- Không đánh dấu completed nếu export fail.

## 8. Fallback policy

Fallback phải có thứ tự, lý do và log:

- OCR API → PP-OCRv5 local → RapidOCR local.
- Translation cloud → local model → configured fallback model.
- CapCut/Gemini TTS → Edge TTS → configured local fallback nếu có.
- GPU/NVDEC/NVENC → CPU/software encoder.

Mỗi fallback event phải ghi stage, provider/backend trước, lỗi, provider/backend sau, timestamp và kết quả.

Không fallback vô hạn, không retry lỗi dữ liệu đầu vào như lỗi mạng, và không ghi trạng thái thành công khi fallback cuối cùng thất bại.

## 9. Editor integration

Khi completed:

1. Refresh project list.
2. Load manifest mới nhất.
3. Load cues.
4. Load stages và artifacts.
5. Set active project.
6. Chuyển sang editor view.
7. Nạp video stream, ROI, masks, waveform, voiceover và export metadata.

Khi needs_review:

- vẫn cho phép mở editor;
- hiển thị banner cảnh báo cụ thể;
- có nút retry stage;
- không hiện nhãn hoàn tất như workflow đạt chuẩn.

## 10. Ma trận kiểm thử bắt buộc

### Backend/API

- URL hợp lệ, URL rỗng/malformed/unsupported.
- Preview response validation.
- Workflow creation và idempotency.
- State transition hợp lệ/không hợp lệ.
- Polling status.
- Retry stage.
- Cancel từng stage.
- Resume sau process restart.
- Fallback provider.
- Hard failure khi mọi fallback thất bại.
- Path traversal/output directory.
- Không tạo output rỗng.

### Frontend

- Paste URL.
- Preview loading/success/error.
- Confirmation modal.
- Setting persistence.
- Start workflow.
- Progress từng stage.
- Fallback warning.
- Cancel và retry.
- Reload browser.
- Tự mở editor khi completed.
- Mở editor ở needs-review.
- Link tới artifact/export.
- Responsive layout và không overflow modal.

### E2E

Dùng video fixture có kiểm soát và ít nhất một nguồn thật nếu môi trường cho phép:

1. Dán link.
2. Preview.
3. Xác nhận.
4. Tải video.
5. Verify media.
6. Auto-detect ROI.
7. OCR.
8. Dịch.
9. TTS.
10. Export.
11. ffprobe output.
12. Mở editor.
13. Kiểm tra cue/ROI/voiceover/export.

### Regression

Chạy các nhóm test liên quan hiện có: downloader/queue, OCR quality, translation routing, multi-provider TTS, export/render, editor/project contracts, API contracts, TypeScript/Vite build và pytest regression phù hợp.

## 11. Reviewer độc lập

Agent phải dừng tại các checkpoint sau để reviewer kiểm tra.

### Checkpoint 1 — Design

Reviewer xác nhận kiến trúc không song song không cần thiết, state machine đầy đủ, API contract rõ, retry/cancel/resume có thiết kế và quality gates không mơ hồ.

### Checkpoint 2 — Backend

Reviewer kiểm tra persistence, idempotency, stage transitions, fallback, error handling, path safety và test đỏ/xanh có ý nghĩa.

### Checkpoint 3 — UI

Reviewer kiểm tra UX dán-link đơn giản, modal không quá phức tạp, setting truyền đúng backend, progress phản ánh trạng thái thật và không mock trạng thái.

### Checkpoint 4 — E2E

Reviewer kiểm tra workflow thật sự tải/OCR/dịch/TTS/export, editor load đúng project, artifact phát được, subtitle/mask đúng vùng và log/metrics truy vết được.

Reviewer chỉ trả một verdict:

- APPROVED: đủ bằng chứng, đạt tiêu chí.
- CHANGES_REQUIRED: cần sửa cụ thể, chưa được coi là hoàn thành.
- BLOCKED: bị chặn bởi môi trường/quyền/phụ thuộc, có bằng chứng.

## 12. Báo cáo bàn giao bắt buộc

Agent phải trả báo cáo theo mẫu:

\`\`\`
STATUS: READY_FOR_REVIEW | BLOCKED

Mục tiêu:
- ...

Files changed:
- ...

API/schema changes:
- ...

Workflow state machine:
- ...

Settings mapping:
- ...

Quality gates:
- ...

Fallback policy:
- ...

Tests:
- Command: ...
  Exit code: ...
  Result: ...

Backend evidence:
- URL/log/artifact: ...

UI evidence:
- Screenshot/video/log: ...

Pipeline evidence:
- Input: ...
- OCR report: ...
- SRT/ASS: ...
- Voiceover: ...
- Export MP4: ...
- ffprobe: ...

Quality metrics:
- Download integrity: ...
- OCR cue count/quality: ...
- Translation coverage: ...
- TTS validity: ...
- Export streams/duration: ...

Known limitations:
- ...

Reviewer verdict:
- APPROVED | CHANGES_REQUIRED | BLOCKED

Remaining risks:
- ...
\`\`\`

Không được dùng câu “đã test thành công” nếu không có command, exit code và kết quả cụ thể.

## 13. Tiêu chí hoàn thành cuối cùng

Chỉ được đánh dấu hoàn thành khi tất cả điều kiện sau đúng:

- Backend orchestrator bền vững.
- URL preview và confirmation hoạt động.
- Workflow tải đúng video.
- ROI được tìm và lưu đúng.
- OCR tạo cue hợp lệ.
- Dịch tạo bản dịch đạt quality gate.
- TTS tạo audio hợp lệ.
- MP4 có hình, audio, mask và subtitle theo setting.
- Fallback đã được test ít nhất ở một failure path.
- Retry/cancel/reload/resume hoạt động.
- Editor tự mở và nạp đúng project.
- Có ít nhất một E2E thật hoặc fixture tương đương có kiểm chứng artifact.
- Typecheck/build/test regression đạt.
- Không có mojibake, secret, cache hoặc output không được phép trong diff.
- Reviewer trả APPROVED.

Nếu bất kỳ điều kiện nào chưa đạt, phải dừng với CHANGES_REQUIRED hoặc BLOCKED; không được tuyên bố DONE.

## 14. Lệnh dừng phiên

Khi đã hoàn tất đúng phạm vi ticket hoặc bị chặn có bằng chứng, kết thúc phiên bằng một trong hai marker:

\`\`\`
READY_FOR_REVIEW
\`\`\`

hoặc:

\`\`\`
BLOCKED
\`\`\`

Không tự chuyển sang ticket khác.

