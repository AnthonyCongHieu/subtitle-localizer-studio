"""
Module: FrameAccurateBoundaryRefiner (v4 — Anchor Template Matching + Zero-Lag Lead-In)
Nhiệm vụ: Tinh chỉnh ranh giới Onset/Offset phụ đề chính xác đến từng khung hình (< 33ms),
loại bỏ hoàn toàn hiện tượng nháy lộ chữ gốc tiếng Trung/nước ngoài trước khi khung che kịp tới.

Kỹ thuật:
- Anchor Mask Template Matching: Lấy mẫu khung hình neo (anchor) tại trung tâm cue,
  trích xuất mặt nạ điểm ảnh chữ (character glyph mask).
- Smart Window Scan: Quét tìm frame đầu tiên và cuối cùng khớp với mặt nạ neo.
- Lead-In Buffer (-0.06s) & Lead-Out Buffer (+0.06s): Xuất hiện trước 2 frame, tắt sau 2 frame.
- Fallback an toàn: Tự động điều chỉnh khi không đủ điểm ảnh chữ hoặc câu quá ngắn.
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
    Anchor Template Matching + Zero-Lag Lead-In.
    """

    def __init__(
        self,
        roi_norm: Tuple[float, float, float, float] = (0.0, 0.75, 1.0, 0.25),
        lead_in: float = 0.06,
        lead_out: float = 0.06,
        match_threshold: float = 0.50,
        text_lum_threshold: int = 195,
        onset_search_backward: float = 0.65,
        offset_search_forward: float = 0.75,
        downscale_width: int = 320,
    ) -> None:
        self.roi_norm = roi_norm
        self.lead_in = lead_in
        self.lead_out = lead_out
        self.match_threshold = match_threshold
        self.text_lum_threshold = text_lum_threshold
        self.onset_backward = onset_search_backward
        self.offset_forward = offset_search_forward
        self.downscale_width = downscale_width

    def _crop_roi_gray(
        self, frame: np.ndarray, y1: int, y2: int, x1: int, x2: int
    ) -> np.ndarray:
        """Cắt vùng ROI, chuyển Gray, resize để xử lý cực nhanh."""
        crop = frame[y1:y2, x1:x2]
        if crop.ndim == 3:
            crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        tw = self.downscale_width
        th = max(16, int(crop.shape[0] * (tw / max(1, crop.shape[1]))))
        return cv2.resize(crop, (tw, th), interpolation=cv2.INTER_LINEAR)

    def _extract_text_mask(self, gray_roi: np.ndarray) -> np.ndarray:
        """Trích xuất mặt nạ nhị phân của chữ phụ đề (high-contrast pixels)."""
        mask = (gray_roi > self.text_lum_threshold).astype(np.uint8)
        cnt = np.count_nonzero(mask)
        if cnt < 40:
            # Fallback sang Otsu trên nửa trên độ sáng nếu chữ mờ
            _, mask = cv2.threshold(gray_roi, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return mask

    def refine_cues(
        self,
        video_path: str,
        cues: List[SubtitleCueV1],
    ) -> List[SubtitleCueV1]:
        """
        Tinh chỉnh ranh giới tất cả cues bằng kỹ thuật Anchor Template Matching:
        1. Sắp xếp cues theo start_pts.
        2. Với mỗi cue, tìm frame neo tại điểm giữa thời gian của cue.
        3. Quét tìm chính xác frame onset và offset.
        4. Áp dụng Lead-In buffer (-0.06s) và Lead-Out buffer (+0.06s).
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

        rx, ry, rw, rh = self.roi_norm
        y1 = max(0, int(vid_h * ry))
        y2 = min(vid_h, int(vid_h * (ry + rh)))
        x1 = max(0, int(vid_w * rx))
        x2 = min(vid_w, int(vid_w * (rx + rw)))

        refined_count = 0
        total_cues = len(cues)

        for i in range(total_cues):
            cue = cues[i]
            prev_end = cues[i - 1].end_pts if i > 0 else 0.0
            next_start = cues[i + 1].start_pts if i + 1 < total_cues else cue.end_pts + 1.0

            s_pts = cue.start_pts
            e_pts = cue.end_pts

            # 1. Xác định khung hình neo (Anchor Frame) ở giữa khoảng thời gian của cue
            anchor_target_pts = (s_pts + e_pts) / 2.0
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, anchor_target_pts * 1000.0))
            ret, f_anchor = cap.read()
            if not ret or f_anchor is None:
                continue

            gray_anchor = self._crop_roi_gray(f_anchor, y1, y2, x1, x2)
            mask_anchor = self._extract_text_mask(gray_anchor)
            cnt_anchor = np.count_nonzero(mask_anchor)

            if cnt_anchor < 30:
                # Không đủ điểm ảnh chữ để làm mẫu neo, chỉ áp dụng lead-in/lead-out an toàn
                new_s = max(prev_end, round(s_pts - self.lead_in, 3))
                new_e = min(next_start + 0.05, round(e_pts + self.lead_out, 3))
                cue.start_pts = new_s
                cue.end_pts = max(round(new_s + 0.35, 3), new_e)
                continue

            # 2. Quét cửa sổ tìm Onset
            w_onset_start = max(prev_end, s_pts - self.onset_backward)
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, w_onset_start - 0.05) * 1000.0)

            detected_onset = s_pts

            while True:
                ret, frame = cap.read()
                if not ret or frame is None:
                    break
                cur_pts = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
                if cur_pts > s_pts + 0.15:
                    break
                if cur_pts < w_onset_start - 0.02:
                    continue

                gray_f = self._crop_roi_gray(frame, y1, y2, x1, x2)
                mask_f = self._extract_text_mask(gray_f)
                match_ratio = np.count_nonzero(cv2.bitwise_and(mask_f, mask_anchor)) / cnt_anchor

                if match_ratio >= self.match_threshold:
                    detected_onset = cur_pts
                    break

            # 3. Quét cửa sổ tìm Offset
            w_offset_start = max(s_pts, e_pts - 0.10)
            w_offset_limit = min(next_start + 0.10, e_pts + self.offset_forward)
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, w_offset_start - 0.05) * 1000.0)

            detected_offset = e_pts
            last_match_pts = e_pts

            while True:
                ret, frame = cap.read()
                if not ret or frame is None:
                    break
                cur_pts = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
                if cur_pts > w_offset_limit:
                    break
                if cur_pts < w_offset_start - 0.02:
                    continue

                gray_f = self._crop_roi_gray(frame, y1, y2, x1, x2)
                mask_f = self._extract_text_mask(gray_f)
                match_ratio = np.count_nonzero(cv2.bitwise_and(mask_f, mask_anchor)) / cnt_anchor

                if match_ratio >= self.match_threshold:
                    last_match_pts = cur_pts
                elif cur_pts > e_pts and match_ratio < 0.35:
                    break

            detected_offset = last_match_pts

            # 4. Áp dụng Lead-In (-0.06s) và Lead-Out (+0.06s)
            final_onset = max(prev_end, round(detected_onset - self.lead_in, 3))
            final_offset = min(next_start + 0.05, round(detected_offset + self.lead_out, 3))
            if final_offset <= final_onset:
                final_offset = round(final_onset + 0.35, 3)

            if abs(final_onset - cue.start_pts) > 0.005 or abs(final_offset - cue.end_pts) > 0.005:
                refined_count += 1

            cue.start_pts = final_onset
            cue.end_pts = final_offset

        cap.release()
        logger.info(
            "Boundary Refinement hoàn tất: %d/%d câu tinh chỉnh ranh giới (Anchor Template + Zero-Lag Lead-In)",
            refined_count, total_cues,
        )
        return cues
