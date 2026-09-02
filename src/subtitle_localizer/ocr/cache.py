from __future__ import annotations

from typing import Dict, Optional

from subtitle_localizer.domain.models import OcrObservationV1


class OcrResultCache:
    """Bộ nhớ đệm kết quả nhận dạng OCR theo frame hash để tránh inference lặp lại."""

    def __init__(self, max_entries: int = 10000) -> None:
        self.max_entries = max_entries
        self._cache: Dict[str, OcrObservationV1] = {}

    def get(self, frame_hash: str) -> Optional[OcrObservationV1]:
        return self._cache.get(frame_hash)

    def put(self, frame_hash: str, observation: OcrObservationV1) -> None:
        if len(self._cache) >= self.max_entries:
            # Xóa bớt phần tử đầu tiên
            first_key = next(iter(self._cache))
            del self._cache[first_key]
        self._cache[frame_hash] = observation

    def clear(self) -> None:
        self._cache.clear()
