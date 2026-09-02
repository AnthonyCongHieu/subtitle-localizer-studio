from __future__ import annotations

from typing import List


class AdaptiveFrameSampler:
    """Bộ lấy mẫu frame thích ứng nhằm tối ưu hiệu năng OCR trên GPU 6GB."""

    def __init__(self, sample_fps: float = 2.5, min_interval_pts: float = 0.25) -> None:
        self.sample_fps = sample_fps
        self.min_interval_pts = min_interval_pts

    def filter_timestamps(self, timestamps: List[float]) -> List[float]:
        """Lọc danh sách frame timestamps theo khoảng cách thời gian tối thiểu."""
        if not timestamps:
            return []

        sorted_ts = sorted(timestamps)
        result = [sorted_ts[0]]

        for ts in sorted_ts[1:]:
            if (ts - result[-1]) >= self.min_interval_pts:
                result.append(ts)

        return result
