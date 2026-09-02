from __future__ import annotations

from pathlib import Path
from typing import Any, List, Optional, Tuple
import numpy as np


class AdaptiveFrameSampler:
    """Bộ lấy mẫu frame thích ứng nhằm tối ưu hiệu năng OCR từ file video thật."""

    def __init__(self, sample_fps: float = 2.0, min_interval_pts: float = 0.3) -> None:
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

    def sample_video_frames(
        self,
        video_path: str | Path,
        roi_norm: Optional[Tuple[float, float, float, float]] = None,
        max_duration_seconds: float = 600.0,
    ) -> Tuple[List[Any], List[float]]:
        """Mở video thực tế và trích xuất danh sách crops cùng mốc thời gian PTS."""
        import cv2

        path_str = str(video_path)
        cap = cv2.VideoCapture(path_str)
        if not cap.isOpened():
            return [], []

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)

        # Tính bước nhảy frame theo sample_fps
        frame_step = max(1, int(round(fps / self.sample_fps)))
        max_frame_idx = min(total_frames, int(max_duration_seconds * fps))

        crops: List[Any] = []
        pts_list: List[float] = []

        # Tọa độ ROI (x, y, w, h theo tỉ lệ 0..1)
        if roi_norm:
            rx, ry, rw, rh = roi_norm
            y1 = max(0, int(height * ry))
            y2 = min(height, int(height * (ry + rh)))
            x1 = max(0, int(width * rx))
            x2 = min(width, int(width * (rw + rh)))
        else:
            # Mặc định lấy 20% đáy màn hình
            y1 = int(height * 0.75)
            y2 = height
            x1 = 0
            x2 = width

        curr_frame_idx = 0
        while curr_frame_idx < max_frame_idx:
            cap.set(cv2.CAP_PROP_POS_FRAMES, curr_frame_idx)
            ret, frame = cap.read()
            if not ret or frame is None:
                break

            pts = round(curr_frame_idx / fps, 3)

            # Crop vùng ROI
            crop = frame[y1:y2, x1:x2]
            crops.append(crop)
            pts_list.append(pts)

            curr_frame_idx += frame_step

        cap.release()
        return crops, pts_list
