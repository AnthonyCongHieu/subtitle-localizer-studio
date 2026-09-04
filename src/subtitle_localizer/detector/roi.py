from __future__ import annotations

import uuid
from typing import Any, List, Optional
from subtitle_localizer.domain.models import RegionTrackV1


def propose_default_roi(width: int, height: int, is_portrait: bool = False) -> RegionTrackV1:
    """
    Đề xuất vùng nhận diện phụ đề (ROI) chuẩn theo hình học video:
    - Landscape: vùng 78% -> 96% chiều cao, cách lề 8% mỗi bên.
    - Portrait (Shorts/TikTok/Reels): vùng mở rộng 70% -> 96% chiều cao (x=0.05, y=0.70, w=0.90, h=0.26)
      để bao quát trọn vẹn cả phụ đề trung tâm (0.74-0.80) lẫn phụ đề đặt sát đáy (0.85-0.95).
    """
    if is_portrait or (height > width):
        # Video dọc (Shorts/TikTok/Reels/Phim ngắn Hồng Quả):
        # Bao quát từ 62% -> 96% chiều cao màn hình để bắt trọn cả phụ đề thoại (0.65-0.75)
        # lẫn phụ đề sát đáy (0.85-0.95), sau đó Smart ROI Tightening sẽ tự động co sát viền chữ.
        x = 0.05
        y = 0.62
        w = 0.90
        h = 0.34
    else:
        # Video ngang
        x = 0.08
        y = 0.78
        w = 0.84
        h = 0.18

    return RegionTrackV1(
        region_id=f"roi-{uuid.uuid4().hex[:8]}",
        x=round(x, 4),
        y=round(y, 4),
        width=round(w, 4),
        height=round(h, 4),
    )


def compute_tight_roi_from_observations(
    observations: List[Any],
    base_roi: RegionTrackV1,
    crop_width: int,
    crop_height: int,
    padding_x: float = 0.02,
    padding_y: float = 0.015,
) -> Optional[RegionTrackV1]:
    """
    Tự co giãn ROI thông minh dựa trên toạ độ thực tế của các bounding box phụ đề đã nhận diện:
    - Tìm min/max box bao trọn toàn bộ các câu phụ đề
    - Cộng padding an toàn để che đủ nét chữ mà không che thừa nội dung video xung quanh
    - Trả về RegionTrackV1 mới được co gọn, hoặc None nếu không phát hiện box nào
    """
    all_boxes = []
    for obs in observations:
        boxes = getattr(obs, "boxes", [])
        for box in boxes:
            if len(box) >= 4:
                all_boxes.append(box)

    if not all_boxes or crop_width <= 0 or crop_height <= 0:
        return None

    # Tọa độ trong crop: x1, y1, x2, y2
    min_bx = min(b[0] for b in all_boxes)
    min_by = min(b[1] for b in all_boxes)
    max_bx = max(b[2] for b in all_boxes)
    max_by = max(b[3] for b in all_boxes)

    # Chuyển đổi sang hệ tọa độ chuẩn hóa toàn video (0.0 -> 1.0)
    norm_x1 = base_roi.x + (min_bx / crop_width) * base_roi.width
    norm_y1 = base_roi.y + (min_by / crop_height) * base_roi.height
    norm_x2 = base_roi.x + (max_bx / crop_width) * base_roi.width
    norm_y2 = base_roi.y + (max_by / crop_height) * base_roi.height

    # Thêm padding an toàn vừa khít
    tight_x = max(0.0, norm_x1 - padding_x)
    tight_y = max(0.0, norm_y1 - padding_y)
    tight_w = min(1.0 - tight_x, (norm_x2 - norm_x1) + padding_x * 2)
    tight_h = min(1.0 - tight_y, (norm_y2 - norm_y1) + padding_y * 2)

    # Chỉ áp dụng nếu kích thước hợp lệ
    if tight_w >= 0.05 and tight_h >= 0.02:
        return RegionTrackV1(
            region_id=base_roi.region_id,
            x=round(tight_x, 4),
            y=round(tight_y, 4),
            width=round(tight_w, 4),
            height=round(tight_h, 4),
        )
    return None
