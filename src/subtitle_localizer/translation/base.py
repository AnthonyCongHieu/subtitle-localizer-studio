from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List

from subtitle_localizer.domain.models import ModelDescriptorV1, SubtitleCueV1


class TranslationProvider(ABC):
    """Lớp cơ sở trừu tượng cho các mô hình dịch máy (Translation Engines)."""

    @abstractmethod
    def get_descriptor(self) -> ModelDescriptorV1:
        pass

    @abstractmethod
    def load(self) -> None:
        pass

    @abstractmethod
    def unload(self) -> None:
        pass

    @abstractmethod
    def translate_cues(
        self,
        cues: List[SubtitleCueV1],
        source_lang: str = "zh",
        target_lang: str = "vi",
    ) -> List[SubtitleCueV1]:
        pass
