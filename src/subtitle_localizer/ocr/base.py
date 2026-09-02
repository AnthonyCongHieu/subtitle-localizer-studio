from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, List, Optional

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

    @abstractmethod
    def recognize(
        self,
        crops: List[Any],
        pts_list: List[float],
        language: str = "zh",
    ) -> List[OcrObservationV1]:
        """Thực hiện nhận dạng chữ từ danh sách ảnh cắt."""
        pass
