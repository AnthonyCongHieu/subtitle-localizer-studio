# Kế Hoạch: Clean Git & Push Origin

## 1. Hiện Trạng & Rà Soát Git
- Nhánh: `main`, kết nối tới `origin` (GitHub: `AnthonyCongHieu/subtitle-localizer-studio.git`).
- Local `HEAD` đang trùng `origin/main` (toàn bộ commit trước đã được push).
- GitHub Desktop hiển thị chấm xanh do có nhiều thay đổi chưa commit (`uncommitted changes`):
  - 6 files modified (`sampler.py`, `rapid.py`, `worker.py`, `real.py`, `package-lock.json`, `App.tsx`).
  - 10 files components cũ bị di dời sang `web/archive/`.
  - 25 files untracked (thư mục `scratch/`, `web/archive/`, `boundary_refiner.py`, components mới).
- **Rủi ro chất lượng hiện tại:**
  - `pytest` fail 7/140 tests (4 test web do mất file component cũ, 2 test OCR do early-exit làm mất ký tự đầu, 1 test dịch thuật do nuốt lỗi kết nối).
  - Có file ảnh nhị phân tạm trong `scratch/` (`frame_00s.jpg`, `frame_05s.jpg`) vi phạm quy định không commit ảnh/cache của repository.

## 2. Các Bước Thực Hiện
1. **Dọn rác & Ignore:**
   - Thêm `/scratch/` vào `.gitignore` để loại bỏ ảnh và script tạm khỏi git.
   - Khôi phục các components ở `web/archive/components/` về lại `web/src/components/` để đảm bảo test web (T08, T09) pass 100%.
   - Xóa bỏ thư mục thừa `web/archive/`.
2. **Sửa mã nguồn để pass 100% tests:**
   - Trong `src/subtitle_localizer/ocr/rapid.py`: Gỡ bỏ break early-exit gây cắt mất chữ đầu dòng.
   - Trong `src/subtitle_localizer/translation/real.py`: Chuẩn hóa lại ngoại lệ `RuntimeError` khi dịch lỗi.
3. **Kiểm chứng thực tế (Evidence-Based):**
   - Chạy `pytest` -> Đạt 140/140 passed (0 failed).
   - Chạy `npm run build` -> Đạt 0 lỗi build.
4. **Commit & Push:**
   - Gom các thay đổi hợp lệ và commit theo chuẩn:
     `feat(pipeline & ui): frame-accurate subtitle sync, auto gap-rescue pass, and modern capcut layout`
   - Push lên `origin/main`.
   - Kiểm tra `git status` đảm bảo `working tree clean`.
