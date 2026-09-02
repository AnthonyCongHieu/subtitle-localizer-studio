from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from subtitle_localizer.domain.models import SubtitleCueV1


@dataclass
class ContextWindow:
    """Ngữ cảnh của một câu phụ đề bao gồm 1 câu trước và 1 câu sau."""
    target_cue: SubtitleCueV1
    prev_text: Optional[str] = None
    next_text: Optional[str] = None


class ContextualBatcher:
    """Tạo cửa sổ ngữ cảnh xung quanh mỗi câu phụ đề để bản dịch mạch lạc hơn."""

    def __init__(self, window_size: int = 1) -> None:
        self.window_size = window_size

    def build_windows(self, cues: List[SubtitleCueV1]) -> List[ContextWindow]:
        windows: List[ContextWindow] = []
        for i, cue in enumerate(cues):
            prev_text = cues[i - 1].source_text if i > 0 else None
            next_text = cues[i + 1].source_text if i < (len(cues) - 1) else None
            windows.append(
                ContextWindow(
                    target_cue=cue,
                    prev_text=prev_text,
                    next_text=next_text,
                )
            )
        return windows
