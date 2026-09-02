from __future__ import annotations

import bisect
from typing import List, Optional


class PtsTimelineMapper:
    """
    Ánh xạ Presentation Timestamp (PTS) thực tế cho video CFR và VFR.
    Tuyệt đối không suy đoán PTS chỉ bằng frame_index / fixed_fps trên video VFR.
    """

    def __init__(self, frame_pts_list: Optional[List[float]] = None, is_vfr: bool = False, fps: float = 25.0) -> None:
        self.frame_pts_list: List[float] = sorted(frame_pts_list) if frame_pts_list else []
        self.is_vfr = is_vfr
        self.fps = max(1.0, fps)

    def get_frame_pts(self, frame_index: int) -> float:
        """Lấy PTS chính xác của frame theo chỉ mục."""
        if self.frame_pts_list and 0 <= frame_index < len(self.frame_pts_list):
            return self.frame_pts_list[frame_index]
        return round(frame_index / self.fps, 4)

    def nearest_pts(self, target_pts: float) -> float:
        """Tìm PTS gần nhất trong chuỗi timestamps thực tế."""
        if not self.frame_pts_list:
            return target_pts
        pos = bisect.bisect_left(self.frame_pts_list, target_pts)
        if pos == 0:
            return self.frame_pts_list[0]
        if pos >= len(self.frame_pts_list):
            return self.frame_pts_list[-1]
        before = self.frame_pts_list[pos - 1]
        after = self.frame_pts_list[pos]
        return after if (after - target_pts) < (target_pts - before) else before

    def pts_to_frame(self, pts: float) -> int:
        """Tìm chỉ mục frame tương ứng với PTS."""
        if not self.frame_pts_list:
            return int(round(pts * self.fps))
        nearest = self.nearest_pts(pts)
        return self.frame_pts_list.index(nearest)

    def total_frames(self) -> int:
        return len(self.frame_pts_list)

    def duration(self) -> float:
        if self.frame_pts_list:
            return self.frame_pts_list[-1]
        return 0.0
