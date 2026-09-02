from __future__ import annotations

from pathlib import Path
from typing import List

from subtitle_localizer.domain.models import SubtitleCueV1


def format_srt_time(seconds: float) -> str:
    """Chuyển đổi PTS giây thành định dạng SRT `HH:MM:SS,mmm`."""
    total_ms = int(round(max(0.0, seconds) * 1000))
    hours = total_ms // 3600000
    total_ms %= 3600000
    minutes = total_ms // 60000
    total_ms %= 60000
    secs = total_ms // 1000
    ms = total_ms % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


class SrtExporter:
    """Xuất phụ đề chuẩn định dạng SubRip (.srt) UTF-8."""

    def export_srt_text(self, cues: List[SubtitleCueV1], use_translated: bool = True) -> str:
        blocks: List[str] = []
        for index, cue in enumerate(cues, 1):
            start = format_srt_time(cue.start_pts)
            end = format_srt_time(cue.end_pts)
            text = (cue.translated_text if use_translated and cue.translated_text else cue.source_text).strip()
            blocks.append(f"{index}\n{start} --> {end}\n{text}")

        return "\n\n".join(blocks) + "\n"

    def export_srt_file(
        self,
        cues: List[SubtitleCueV1],
        output_path: Path | str,
        use_translated: bool = True,
    ) -> Path:
        path = Path(output_path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        content = self.export_srt_text(cues, use_translated=use_translated)
        path.write_text(content, encoding="utf-8")
        return path
