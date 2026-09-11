from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Tuple

from subtitle_localizer.detector.persistent_text import box_iou, classify_persistent_boxes


@dataclass
class SubtitleEvent:
    """Khoảng thời gian phát hiện chữ phụ đề trên màn hình."""
    start_pts: float
    end_pts: float
    boxes: List[List[float]] = field(default_factory=list)
    confidence: float = 1.0


def _box_overlap(b1: List[float], b2: List[float]) -> float:
    """Tính Intersection over Union (IoU) giữa 2 bounding box [x1, y1, x2, y2]."""
    return box_iou(b1, b2)


class NativeTemporalDetector:
    """
    Thuật toán phát hiện sự xuất hiện/biến mất của câu phụ đề qua thời gian
    kết hợp lọc watermark/logo xuất hiện liên tục suốt video.
    """

    def __init__(
        self,
        min_duration_pts: float = 0.35,
        max_gap_pts: float = 0.45,
        max_watermark_ratio: float = 0.85,
    ) -> None:
        self.min_duration_pts = min_duration_pts
        self.max_gap_pts = max_gap_pts
        self.max_watermark_ratio = max_watermark_ratio

    def detect_subtitle_intervals(
        self,
        frames_data: List[Tuple[float, List[List[float]]]],
        total_duration: float = 1.0,
    ) -> List[SubtitleEvent]:
        """
        Nhận danh sách (pts, list_of_boxes) và gom nhóm thành các SubtitleEvent.
        """
        if not frames_data:
            return []

        # 1. Phát hiện và loại trừ watermark xuất hiện cố định > max_watermark_ratio
        watermark_boxes = classify_persistent_boxes(
            frames_data,
            persistent_ratio=self.max_watermark_ratio,
            iou_threshold=0.6,
        )

        # 2. Lọc các frame có text không phải watermark
        active_points: List[Tuple[float, List[List[float]]]] = []
        for pts, boxes in frames_data:
            valid_boxes = [
                b for b in boxes
                if not any(box_iou(b, wb) > 0.6 for wb in watermark_boxes)
            ]
            if valid_boxes:
                active_points.append((pts, valid_boxes))

        if not active_points:
            return []

        # 3. Gom cụm các mốc thời gian liền kề
        events: List[SubtitleEvent] = []
        cur_start = active_points[0][0]
        cur_end = active_points[0][0]
        cur_boxes = active_points[0][1]

        for pts, boxes in active_points[1:]:
            if (pts - cur_end) <= self.max_gap_pts:
                cur_end = pts
                cur_boxes = boxes
            else:
                if (cur_end - cur_start) >= self.min_duration_pts:
                    events.append(SubtitleEvent(start_pts=cur_start, end_pts=cur_end, boxes=cur_boxes))
                cur_start = pts
                cur_end = pts
                cur_boxes = boxes

        if (cur_end - cur_start) >= self.min_duration_pts:
            events.append(SubtitleEvent(start_pts=cur_start, end_pts=cur_end, boxes=cur_boxes))

        return events
