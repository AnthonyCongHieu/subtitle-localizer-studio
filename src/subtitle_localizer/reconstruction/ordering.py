from __future__ import annotations

from typing import List

from subtitle_localizer.domain.models import OcrObservationV1


def sort_reading_order(observations: List[OcrObservationV1]) -> str:
    """
    Sắp xếp thứ tự đọc tự nhiên cho phụ đề 2 dòng:
    Dòng phía trên xuất hiện trước dòng phía dưới.
    """
    if not observations:
        return ""

    # Sắp xếp các observation cùng thời điểm theo tọa độ Y (top box trước, bottom box sau)
    sorted_obs = sorted(
        observations,
        key=lambda obs: (
            obs.boxes[0][1] if obs.boxes and len(obs.boxes[0]) >= 2 else 0.0,
            obs.boxes[0][0] if obs.boxes and len(obs.boxes[0]) >= 1 else 0.0,
        ),
    )

    lines = [obs.raw_text.strip() for obs in sorted_obs if obs.raw_text.strip()]
    return "\n".join(lines)
