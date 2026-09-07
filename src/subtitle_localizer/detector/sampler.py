from __future__ import annotations

from pathlib import Path
from typing import Any, List, Optional, Tuple
import math
import numpy as np


class AdaptiveFrameSampler:
    """Bộ lấy mẫu frame thích ứng nhằm tối ưu hiệu năng OCR từ file video thật."""

    def __init__(
        self,
        sample_fps: float = 2.0,
        min_interval_pts: float = 0.3,
        diff_threshold: float = 0.0,
    ) -> None:
        self.sample_fps = sample_fps
        self.min_interval_pts = min_interval_pts
        self.diff_threshold = diff_threshold

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
        max_duration_seconds: Optional[float] = None,
        diff_threshold: Optional[float] = None,
        start_seconds: float = 0.0,
        roi_norms: Optional[List[Tuple[float, float, float, float]]] = None,
    ) -> Tuple[List[Any], List[float]]:
        """Mở video thực tế và trích xuất danh sách crops cùng mốc thời gian PTS.
        Hỗ trợ trích xuất đồng thời từ 1 hoặc nhiều vùng ROI (Multi-Region OCR)."""
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
        if max_duration_seconds is not None and max_duration_seconds > 0:
            max_frame_idx = min(total_frames, int(max_duration_seconds * fps))
        else:
            max_frame_idx = total_frames

        crops: List[Any] = []
        pts_list: List[float] = []

        # Chuẩn bị danh sách tọa độ pixel cho các vùng ROI
        active_rois: List[Tuple[float, float, float, float]] = []
        if roi_norms and len(roi_norms) > 0:
            active_rois = [r for r in roi_norms if len(r) == 4]
        elif roi_norm:
            active_rois = [roi_norm]

        boxes: List[Tuple[int, int, int, int]] = []
        if active_rois:
            for rx, ry, rw, rh in active_rois:
                y1 = max(0, int(height * ry))
                y2 = min(height, int(height * (ry + rh)))
                x1 = max(0, int(width * rx))
                x2 = min(width, int(width * (rx + rw)))
                if x2 > x1 and y2 > y1:
                    boxes.append((y1, y2, x1, x2))
            if not boxes:
                cap.release()
                raise ValueError("ROI must have a positive area inside the video frame")
        else:
            # Mặc định lấy 20% đáy màn hình
            boxes = [(int(height * 0.75), height, 0, width)]

        curr_frame_idx = max(0, int(start_seconds * fps))
        if curr_frame_idx > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, curr_frame_idx)
        use_grab = hasattr(cap, "grab")
        active_diff_threshold = diff_threshold if diff_threshold is not None else self.diff_threshold
        prev_crops_gray: List[Optional[np.ndarray]] = [None] * len(boxes)

        while curr_frame_idx < max_frame_idx:
            if use_grab and curr_frame_idx > 0:
                # Fast sequential advance using grab
                for _ in range(frame_step - 1):
                    if not cap.grab():
                        break
            elif not use_grab:
                cap.set(cv2.CAP_PROP_POS_FRAMES, curr_frame_idx)

            ret, frame = cap.read()
            if not ret or frame is None:
                break

            decoder_pts = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if not math.isfinite(decoder_pts) or decoder_pts < 0:
                decoder_pts = curr_frame_idx / fps
            pts = round(decoder_pts, 3)

            for b_idx, (y1, y2, x1, x2) in enumerate(boxes):
                crop = frame[y1:y2, x1:x2]
                if active_diff_threshold > 0.0 and prev_crops_gray[b_idx] is not None:
                    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
                    if gray.shape == prev_crops_gray[b_idx].shape:
                        diff = float(np.mean(cv2.absdiff(gray, prev_crops_gray[b_idx])))
                        if diff < active_diff_threshold:
                            continue
                    prev_crops_gray[b_idx] = gray
                elif active_diff_threshold > 0.0:
                    prev_crops_gray[b_idx] = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop

                crops.append(crop)
                pts_list.append(pts)

            curr_frame_idx += frame_step

        cap.release()
        return crops, pts_list
