from __future__ import annotations

from pathlib import Path
from typing import Any, List, Optional, Tuple
import math
import numpy as np


def detect_scene_cut(
    previous_hist: Optional[np.ndarray],
    frame: Any,
    threshold: float = 0.65,
) -> Tuple[bool, np.ndarray]:
    """Compare a frame histogram with the previous one.

    Returns ``(is_cut, current_hist)`` so callers can keep the returned
    histogram between frames.  Correlation is robust to small luminance noise;
    a low score indicates a hard scene transition.
    """
    import cv2

    if frame is None or getattr(frame, "size", 0) == 0:
        current = np.zeros((32, 1), dtype=np.float32)
        return False, current
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if getattr(frame, "ndim", 0) == 3 else frame
    current = cv2.calcHist([gray], [0], None, [32], [0, 256])
    cv2.normalize(current, current)
    if previous_hist is None or getattr(previous_hist, "size", 0) == 0:
        return False, current
    prev = np.asarray(previous_hist, dtype=np.float32)
    score = float(cv2.compareHist(prev.reshape(-1, 1), current, cv2.HISTCMP_CORREL))
    return score < float(threshold), current


def merge_voice_intervals(
    intervals: List[Tuple[float, float]],
    padding: float = 0.4,
    merge_gap: float = 0.8,
) -> List[Tuple[float, float]]:
    """Pad and merge overlapping/nearby voice activity intervals."""
    if not intervals:
        return []
    if padding < 0 or merge_gap < 0:
        raise ValueError("padding and merge_gap must be non-negative")
    expanded = []
    for start, end in intervals:
        if end < start:
            start, end = end, start
        expanded.append((max(0.0, float(start) - padding), float(end) + padding))
    expanded.sort(key=lambda item: item[0])
    merged: List[Tuple[float, float]] = [expanded[0]]
    for start, end in expanded[1:]:
        prev_start, prev_end = merged[-1]
        if start <= prev_end + merge_gap:
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))
    return merged


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
        sample_fps: Optional[float] = None,
        fps: Optional[float] = None,
        edge_gating_threshold: Optional[float] = None,
    ) -> Tuple[List[Any], List[float]]:
        """Mở video thực tế và trích xuất danh sách crops cùng mốc thời gian PTS.
        Hỗ trợ trích xuất đồng thời từ 1 hoặc nhiều vùng ROI (Multi-Region OCR)."""
        import cv2

        path_str = str(video_path)
        cap = cv2.VideoCapture(path_str)
        if not cap.isOpened():
            return [], []

        video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)

        # Tính bước nhảy frame theo sample_fps truyền vào hoặc mặc định
        eff_sample_fps = fps or sample_fps or self.sample_fps
        frame_step = max(1, int(round(video_fps / max(0.1, eff_sample_fps))))
        if max_duration_seconds is not None and max_duration_seconds > 0:
            max_frame_idx = min(total_frames, int(max_duration_seconds * video_fps))
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

        curr_frame_idx = max(0, int(start_seconds * video_fps))
        if curr_frame_idx > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, curr_frame_idx)
        use_grab = hasattr(cap, "grab")
        active_diff_threshold = diff_threshold if diff_threshold is not None else self.diff_threshold
        active_edge_gating = edge_gating_threshold if edge_gating_threshold is not None else 0.0
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
                decoder_pts = curr_frame_idx / video_fps
            pts = round(decoder_pts, 3)

            for b_idx, (y1, y2, x1, x2) in enumerate(boxes):
                crop = frame[y1:y2, x1:x2]
                gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop

                # Text-Presence Edge Gating (VideoSubFinder algorithm):
                # Bỏ qua các frame không có năng lượng cạnh tần số cao của chữ
                if active_edge_gating > 0.0:
                    edge_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                    if edge_var < active_edge_gating:
                        continue

                if active_diff_threshold > 0.0 and prev_crops_gray[b_idx] is not None:
                    if gray.shape == prev_crops_gray[b_idx].shape:
                        diff = float(np.mean(cv2.absdiff(gray, prev_crops_gray[b_idx])))
                        if diff < active_diff_threshold:
                            continue
                    prev_crops_gray[b_idx] = gray
                elif active_diff_threshold > 0.0:
                    prev_crops_gray[b_idx] = gray

                crops.append(crop)
                pts_list.append(pts)

            curr_frame_idx += frame_step

        cap.release()
        return crops, pts_list

    def stream_voice_windows(
        self,
        video_path: str | Path,
        voice_windows: List[Tuple[float, float]],
        roi_norm: Optional[Tuple[float, float, float, float]] = None,
        roi_norms: Optional[List[Tuple[float, float, float, float]]] = None,
        sample_fps: Optional[float] = None,
    ):
        """Yield ``(crop, pts)`` only for frames inside VAD voice windows.

        The iterator is intentionally CPU/OpenCV based and fails closed when
        the input cannot be opened; callers can substitute the NVDEC decoder
        without changing this contract.
        """
        import cv2

        windows = sorted(
            (max(0.0, float(start)), max(0.0, float(end)))
            for start, end in voice_windows
            if float(end) >= float(start)
        )
        if not windows:
            return
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            cap.release()
            return
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
        step = max(1, int(round(fps / max(0.1, sample_fps or self.sample_fps))))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        rois = [r for r in (roi_norms or ([roi_norm] if roi_norm else [])) if r and len(r) == 4]
        frame_idx = 0
        window_idx = 0
        try:
            while window_idx < len(windows):
                ret, frame = cap.read()
                if not ret or frame is None:
                    break
                pts = frame_idx / fps
                while window_idx < len(windows) and pts > windows[window_idx][1]:
                    window_idx += 1
                if window_idx >= len(windows):
                    break
                start, end = windows[window_idx]
                if start <= pts <= end and frame_idx % step == 0:
                    if rois and width > 0 and height > 0:
                        for rx, ry, rw, rh in rois:
                            x1, y1 = max(0, int(rx * width)), max(0, int(ry * height))
                            x2, y2 = min(width, int((rx + rw) * width)), min(height, int((ry + rh) * height))
                            if x2 > x1 and y2 > y1:
                                yield frame[y1:y2, x1:x2], round(pts, 3)
                    else:
                        yield frame, round(pts, 3)
                frame_idx += 1
        finally:
            cap.release()
