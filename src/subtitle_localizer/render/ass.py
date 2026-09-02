from __future__ import annotations

from pathlib import Path
from typing import List

from subtitle_localizer.domain.models import SubtitleCueV1


def format_ass_time(seconds: float) -> str:
    """Chuyển đổi PTS giây thành định dạng ASS `H:MM:SS.cc` (centiseconds)."""
    total_cs = int(round(max(0.0, seconds) * 100))
    hours = total_cs // 360000
    total_cs %= 360000
    minutes = total_cs // 6000
    total_cs %= 6000
    secs = total_cs // 100
    cs = total_cs % 100
    return f"{hours}:{minutes:02d}:{secs:02d}.{cs:02d}"


class AssExporter:
    """Xuất phụ đề định dạng Advanced SubStation Alpha (.ass) v4.00+."""

    def __init__(
        self,
        font_name: str = "Arial",
        font_size: int = 22,
        primary_color: str = "&H00FFFFFF",
        outline_color: str = "&H00000000",
        outline: int = 2,
        shadow: int = 1,
        alignment: int = 2,  # Bottom Center
    ) -> None:
        self.font_name = font_name
        self.font_size = font_size
        self.primary_color = primary_color
        self.outline_color = outline_color
        self.outline = outline
        self.shadow = shadow
        self.alignment = alignment

    def export_ass_text(
        self,
        cues: List[SubtitleCueV1],
        script_title: str = "Subtitle Localizer Studio",
        use_translated: bool = True,
    ) -> str:
        header = f"""[Script Info]
Title: {script_title}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{self.font_name},{self.font_size},{self.primary_color},&H000000FF,{self.outline_color},&H00000000,0,0,0,0,100,100,0,0,1,{self.outline},{self.shadow},{self.alignment},10,10,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        dialogue_lines: List[str] = []
        for cue in cues:
            start = format_ass_time(cue.start_pts)
            end = format_ass_time(cue.end_pts)
            text = (cue.translated_text if use_translated and cue.translated_text else cue.source_text).strip()
            # ASS xuống dòng bằng `\N`
            text = text.replace("\n", "\\N")
            dialogue_lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")

        return header + "\n".join(dialogue_lines) + "\n"

    def export_ass_file(
        self,
        cues: List[SubtitleCueV1],
        output_path: Path | str,
        script_title: str = "Subtitle Localizer Studio",
        use_translated: bool = True,
    ) -> Path:
        path = Path(output_path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        content = self.export_ass_text(cues, script_title=script_title, use_translated=use_translated)
        path.write_text(content, encoding="utf-8")
        return path
