from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Iterable, List, Optional, Tuple

from subtitle_localizer.domain.models import ModelDescriptorV1, OcrObservationV1


class OcrProvider(ABC):
    """Lớp cơ sở trừu tượng cho tất cả OCR Engines (PaddleOCR, Mock, v.v.)."""

    @abstractmethod
    def get_descriptor(self) -> ModelDescriptorV1:
        """Trả về ModelDescriptorV1 mô tả nguồn gốc, bản quyền và thông số mô hình."""
        pass

    @abstractmethod
    def load(self) -> None:
        """Nạp model vào RAM/VRAM."""
        pass

    @abstractmethod
    def unload(self) -> None:
        """Giải phóng model khỏi VRAM để nhường chỗ cho Translation hoặc Render stage."""
        pass

    def runtime_status(self) -> dict[str, Any]:
        """Return non-sensitive runtime state for diagnostics and benchmarks."""
        return {"loaded": False}

    @abstractmethod
    def recognize(
        self,
        crops: List[Any],
        pts_list: List[float],
        language: str = "zh",
    ) -> List[OcrObservationV1]:
        """Thực hiện nhận dạng chữ từ danh sách ảnh cắt."""
        pass

    def recognize_stream(
        self,
        stream_data: Iterable[Tuple[Any, float]],
        language: str = "zh",
        total_estimated: Optional[int] = None,
    ) -> List[OcrObservationV1]:
        """Recognize an iterator of ``(crop, pts)`` pairs.

        Providers only need to implement the established list-based
        :meth:`recognize` contract; this adapter keeps streaming callers from
        having to materialize or duplicate provider-specific logic.
        """
        crops: List[Any] = []
        pts_list: List[float] = []
        for item in stream_data:
            if not isinstance(item, (tuple, list)) or len(item) != 2:
                raise ValueError("OCR stream items must be (crop, pts) pairs")
            crop, pts = item
            crops.append(crop)
            pts_list.append(float(pts))
        return self.recognize(crops, pts_list, language=language)
