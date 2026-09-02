from __future__ import annotations

import uuid
from subtitle_localizer.domain.models import RegionTrackV1


def propose_default_roi(width: int, height: int, is_portrait: bool = False) -> RegionTrackV1:
    """
    Đề xuất vùng nhận diện phụ đề (ROI) chuẩn theo hình học video:
    - Landscape: vùng 78% -> 96% chiều cao, cách lề 8% mỗi bên.
    - Portrait (Shorts/TikTok): vùng giữa-dưới (68% -> 88% chiều cao) tránh bị UI app che khuất.
    """
    if is_portrait or (height > width):
        # Video dọc
        x = 0.05
        y = 0.68
        w = 0.90
        h = 0.20
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
