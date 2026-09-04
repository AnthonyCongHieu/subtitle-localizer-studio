"""
Module: FrameAccurateBoundaryRefiner (v3 — Smart Sequential + Selective Seek)
Nhiệm vụ: Tinh chỉnh ranh giới Onset/Offset phụ đề chính xác đến từng khung hình (< 33ms).
Kỹ thuật: Sắp xếp tất cả boundary theo thời gian tăng dần. Nếu boundary tiếp theo gần
(< 3 giây phía trước), decode tuần tự bằng grab(). Chỉ seek khi có khoảng cách lớn.
Giảm từ ~258 seek xuống ~20-30 seek, tốc độ mục tiêu: ~10-20 giây cho 129 câu.

Tham khảo: docs/FRAME_ACCURATE_SUBTITLE_SYNC.md
"""
from __future__ import annotations

import logging
import math
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from subtitle_localizer.domain.models import SubtitleCueV1

logger = logging.getLogger(__name__)


class FrameAccurateBoundaryRefiner:
    """
    Tinh chỉnh ranh giới phụ đề chính xác đến từng khung hình bằng kỹ thuật
    Smart Sequential Decode + Selective Seek + Sobel Gradient Spike Analysis.
    """

    def __init__(
        self,
        roi_norm: Tuple[float, float, float, float] = (0.0, 0.75, 1.0, 0.25),
        edge_threshold: float = 25.0,
        gradient_spike_ratio: float = 1.6,
        onset_search_backward: float = 0.55,
        offset_search_forward: float = 0.55,
        downscale_width: int = 320,
    ) -> None:
        self.roi_norm = roi_norm
        self.edge_threshold = edge_threshold
        self.gradient_spike_ratio = gradient_spike_ratio
        self.onset_backward = onset_search_backward
        self.offset_forward = offset_search_forward
        self.downscale_width = downscale_width

    def _crop_roi_gray(
        self, frame: np.ndarray, y1: int, y2: int, x1: int, x2: int
    ) -> np.ndarray:
        """Cắt vùng ROI, chuyển Gray, downscale để tính Sobel cực nhanh."""
        crop = frame[y1:y2, x1:x2]
        if crop.ndim == 3:
            crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        tw = self.downscale_width
        th = max(16, int(crop.shape[0] * (tw / max(1, crop.shape[1]))))
        return cv2.resize(crop, (tw, th), interpolation=cv2.INTER_LINEAR)

    @staticmethod
    def _compute_edge_energy(gray_roi: np.ndarray, threshold: float = 25.0) -> float:
        """Tính năng lượng biên cạnh Sobel — đếm số pixel vượt ngưỡng gradient."""
        gx = cv2.Sobel(gray_roi, cv2.CV_16S, 1, 0, ksize=3)
        gy = cv2.Sobel(gray_roi, cv2.CV_16S, 0, 1, ksize=3)
        mag = np.abs(gx.astype(np.int32)) + np.abs(gy.astype(np.int32))
        return float(np.count_nonzero(mag > int(threshold * 8)))

    def _find_onset(
        self, pts_list: List[float], energies: List[float], coarse_pts: float
    ) -> float:
        """Phân tích gradient spike tìm frame chữ xuất hiện (Onset)."""
        if len(energies) < 3:
            return coarse_pts
        arr = np.array(energies, dtype=np.float32)
        delta = np.diff(arr)
        baseline = float(np.median(arr[: max(1, len(arr) // 3)]))
        step_threshold = max(15.0, baseline * 0.4)
        for i in range(len(delta)):
            if delta[i] > step_threshold and arr[i + 1] > (baseline * self.gradient_spike_ratio):
                return pts_list[i + 1]
        return coarse_pts

    def _find_offset(
        self, pts_list: List[float], energies: List[float], coarse_pts: float
    ) -> float:
        """Phân tích gradient drop tìm frame chữ biến mất (Offset)."""
        if len(energies) < 3:
            return coarse_pts
        arr = np.array(energies, dtype=np.float32)
        delta = np.diff(arr)
        peak_energy = float(np.max(arr))
        drop_threshold = -max(15.0, peak_energy * 0.35)
        for i in range(len(delta)):
            if delta[i] < drop_threshold:
                frame_dur = pts_list[1] - pts_list[0] if len(pts_list) > 1 else 1.0 / 30.0
                return round(pts_list[i] + frame_dur, 3)
        return coarse_pts

    def refine_cues(
        self,
        video_path: str,
        cues: List[SubtitleCueV1],
    ) -> List[SubtitleCueV1]:
        """
        Tinh chỉnh ranh giới tất cả cues bằng chiến lược Smart Sequential:
        1. Tạo danh sách tất cả boundary windows, sắp xếp theo thời gian tăng dần.
        2. Duyệt tuần tự: nếu window tiếp theo gần (< 3s), decode tiến bằng grab().
           Nếu xa, seek 1 lần rồi decode cục bộ.
        3. Thu thập edge energy cho từng window, phân tích gradient spike.
        """
        if not cues:
            return cues

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.warning("Không thể mở video: %s", video_path)
            return cues

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        vid_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
        vid_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)

        # Tọa độ pixel ROI (tính 1 lần)
        rx, ry, rw, rh = self.roi_norm
        y1 = max(0, int(vid_h * ry))
        y2 = min(vid_h, int(vid_h * (ry + rh)))
        x1 = max(0, int(vid_w * rx))
        x2 = min(vid_w, int(vid_w * (rx + rw)))

        # Bước 1: Tạo danh sách tất cả boundary windows
        # Mỗi entry: (window_start, window_end, center_pts, cue_index, type)
        windows: List[Tuple[float, float, float, int, str]] = []
        for idx, cue in enumerate(cues):
            # Onset window
            o_start = max(0.0, cue.start_pts - self.onset_backward)
            o_end = cue.start_pts + 0.1
            windows.append((o_start, o_end, cue.start_pts, idx, "onset"))
            # Offset window
            f_start = max(0.0, cue.end_pts - 0.15)
            f_end = cue.end_pts + self.offset_forward
            windows.append((f_start, f_end, cue.end_pts, idx, "offset"))

        # Sắp xếp theo window_start tăng dần
        windows.sort(key=lambda w: w[0])

        # Bước 2: Duyệt tuần tự — Smart Sequential + Selective Seek
        results: Dict[str, float] = {}  # key = "{idx}_{type}" -> refined_pts
        current_pos = -1.0  # Vị trí hiện tại trong video (giây)
        seek_count = 0
        FORWARD_THRESHOLD = 3.0  # Nếu window_start cách current_pos < 3s, decode tiến

        for w_start, w_end, center_pts, cue_idx, btype in windows:
            # Quyết định: seek hay decode tiến?
            need_seek = True
            if current_pos >= 0:
                gap = w_start - current_pos
                if 0 <= gap <= FORWARD_THRESHOLD:
                    # Gần phía trước → decode tiến bằng grab() (rất nhanh, ~0.3ms/frame)
                    need_seek = False
                    frames_to_skip = max(0, int(gap * fps) - 2)
                    for _ in range(frames_to_skip):
                        if not cap.grab():
                            need_seek = True
                            break
                elif gap < 0 and abs(gap) < 0.1:
                    # Gần như trùng vị trí hiện tại, không cần seek
                    need_seek = False

            if need_seek:
                seek_ms = max(0.0, (w_start - 0.05)) * 1000.0
                cap.set(cv2.CAP_PROP_POS_MSEC, seek_ms)
                seek_count += 1

            # Decode tuần tự trong cửa sổ
            pts_list: List[float] = []
            energies: List[float] = []
            max_frames = int((w_end - w_start + 0.15) * fps) + 5

            for _ in range(max_frames):
                ret, frame = cap.read()
                if not ret or frame is None:
                    break

                cur_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
                cur_pts = cur_ms / 1000.0
                if not math.isfinite(cur_pts) or cur_pts < 0:
                    continue

                current_pos = cur_pts

                if cur_pts < w_start - 0.03:
                    continue
                if cur_pts > w_end + 0.03:
                    break

                roi_gray = self._crop_roi_gray(frame, y1, y2, x1, x2)
                energy = self._compute_edge_energy(roi_gray, self.edge_threshold)
                pts_list.append(round(cur_pts, 3))
                energies.append(energy)

            # Phân tích gradient
            key = f"{cue_idx}_{btype}"
            if btype == "onset":
                results[key] = self._find_onset(pts_list, energies, center_pts)
            else:
                results[key] = self._find_offset(pts_list, energies, center_pts)

        cap.release()

        # Bước 3: Áp dụng kết quả vào cues
        refined_count = 0
        for idx, cue in enumerate(cues):
            onset_key = f"{idx}_onset"
            offset_key = f"{idx}_offset"

            if onset_key in results:
                new_s = results[onset_key]
                if abs(new_s - cue.start_pts) > 0.005:
                    cue.start_pts = round(new_s, 3)
                    refined_count += 1

            if offset_key in results:
                new_e = results[offset_key]
                if abs(new_e - cue.end_pts) > 0.005:
                    cue.end_pts = round(new_e, 3)

            # Đảm bảo end > start
            if cue.end_pts <= cue.start_pts:
                cue.end_pts = round(cue.start_pts + 0.4, 3)

        logger.info(
            "Boundary Refinement hoàn tất: %d/%d câu tinh chỉnh, %d seek (Frame-Accurate ≤ 33ms)",
            refined_count, len(cues), seek_count,
        )
        return cues
