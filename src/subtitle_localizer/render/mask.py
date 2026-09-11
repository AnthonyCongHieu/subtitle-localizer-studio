"""Subtitle masking filters for FFmpeg export."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class TimedMaskSegment:
    """One mask box active on [start_pts, end_pts]. end_pts=None means always on."""

    x: int | str
    y: int | str
    width: int | str
    height: int | str
    start_pts: Optional[float] = None
    end_pts: Optional[float] = None
    always_on: bool = False


def _enable_clause(start_pts: Optional[float], end_pts: Optional[float], always_on: bool) -> str:
    if always_on or start_pts is None or end_pts is None:
        return ""
    start = max(0.0, float(start_pts))
    end = max(start + 0.01, float(end_pts))
    # Commas inside filtergraph option values must be escaped.
    return f":enable='between(t\\,{start:.3f}\\,{end:.3f})'"


def _norm_box_to_pixels(
    box: dict,
    video_width: int,
    video_height: int,
    pad_x: float = 0.01,
    pad_y: float = 0.008,
) -> Tuple[int, int, int, int]:
    x = float(box.get("x", 0.0))
    y = float(box.get("y", 0.0))
    w = float(box.get("width", 1.0))
    h = float(box.get("height", 0.2))
    x = max(0.0, x - pad_x)
    y = max(0.0, y - pad_y)
    w = min(1.0 - x, w + pad_x * 2)
    h = min(1.0 - y, h + pad_y * 2)
    px = max(0, min(video_width - 2, int(round(x * video_width))))
    py = max(0, min(video_height - 2, int(round(y * video_height))))
    pw = max(2, min(video_width - px, int(round(w * video_width))))
    ph = max(2, min(video_height - py, int(round(h * video_height))))
    return px, py, pw, ph


def build_timed_mask_segments_from_cues(
    cues: Sequence[object],
    video_width: int,
    video_height: int,
    fallback_box: Optional[Tuple[int, int, int, int]] = None,
    only_with_box: bool = False,
) -> List[TimedMaskSegment]:
    """Build per-cue timed blur segments from cue.style['box'] when available."""
    segments: List[TimedMaskSegment] = []
    for cue in cues:
        start = float(getattr(cue, "start_pts", 0.0) or 0.0)
        end = float(getattr(cue, "end_pts", start + 0.4) or (start + 0.4))
        if end <= start:
            end = start + 0.4
        style = getattr(cue, "style", None) or {}
        box = style.get("box") if isinstance(style, dict) else None
        if isinstance(box, dict) and all(k in box for k in ("x", "y", "width", "height")):
            x, y, w, h = _norm_box_to_pixels(box, video_width, video_height)
        elif fallback_box is not None and not only_with_box:
            x, y, w, h = fallback_box
        else:
            continue
        segments.append(
            TimedMaskSegment(
                x=x,
                y=y,
                width=w,
                height=h,
                start_pts=start,
                end_pts=end,
                always_on=False,
            )
        )
    return merge_adjacent_timed_segments(segments)


def merge_adjacent_timed_segments(
    segments: Sequence[TimedMaskSegment],
    max_gap: float = 0.12,
    pos_tol: int = 8,
) -> List[TimedMaskSegment]:
    """Merge nearly identical adjacent boxes to keep FFmpeg graphs shorter."""
    if not segments:
        return []
    ordered = sorted(
        segments,
        key=lambda s: (
            0 if s.always_on else 1,
            float(s.start_pts or 0.0),
            str(s.x),
            str(s.y),
        ),
    )
    merged: List[TimedMaskSegment] = [ordered[0]]
    for seg in ordered[1:]:
        prev = merged[-1]
        if prev.always_on or seg.always_on:
            merged.append(seg)
            continue
        try:
            same_box = (
                abs(int(prev.x) - int(seg.x)) <= pos_tol
                and abs(int(prev.y) - int(seg.y)) <= pos_tol
                and abs(int(prev.width) - int(seg.width)) <= pos_tol
                and abs(int(prev.height) - int(seg.height)) <= pos_tol
            )
        except (TypeError, ValueError):
            same_box = prev.x == seg.x and prev.y == seg.y and prev.width == seg.width and prev.height == seg.height
        if (
            same_box
            and prev.end_pts is not None
            and seg.start_pts is not None
            and float(seg.start_pts) <= float(prev.end_pts) + max_gap
        ):
            merged[-1] = TimedMaskSegment(
                x=prev.x,
                y=prev.y,
                width=prev.width,
                height=prev.height,
                start_pts=prev.start_pts,
                end_pts=max(float(prev.end_pts), float(seg.end_pts or prev.end_pts)),
                always_on=False,
            )
        else:
            merged.append(seg)
    return merged


class SubtitleMasker:
    def get_filter_string(
        self,
        mode: str,
        x: int | str,
        y: int | str,
        width: int | str,
        height: int | str,
        opacity: float = 0.85,
        blur_strength: int = 20,
        enable_expr: str = "",
    ) -> str:
        """Sinh biểu thức FFmpeg video filter tương ứng với độ mờ blur_strength tùy chỉnh."""
        overlay_x = str(x).replace("iw", "main_w").replace("ih", "main_h")
        overlay_y = str(y).replace("iw", "main_w").replace("ih", "main_h")
        enable = enable_expr or ""

        if mode == "box":
            return f"drawbox=x={x}:y={y}:w={width}:h={height}:color=black@{opacity}:t=fill{enable}"

        if mode == "mosaic":
            block_size = max(4, min(32, int(blur_strength * 0.5)))
            return (
                f"split[main][sub];"
                f"[sub]crop={width}:{height}:{x}:{y},"
                f"scale=iw/{block_size}:ih/{block_size}:flags=neighbor,"
                f"scale={width}:{height}:flags=neighbor[blurred];"
                f"[main][blurred]overlay={overlay_x}:{overlay_y}{enable}"
            )

        if mode in ("blur", "feather_tight", "optical_blend", "soft_cinema", "feather", "glass", "ambient", "gradient"):
            base_factor = 0.9 if mode in ("feather_tight", "optical_blend", "soft_cinema") else 0.7
            radius = max(2, min(50, int(blur_strength * base_factor)))
            power = 4 if mode in ("feather_tight", "optical_blend", "soft_cinema") else 3
            try:
                h_val = int(height)
                if h_val > 0:
                    radius = max(1, min(radius, max(1, (h_val // 2) - 1)))
            except (ValueError, TypeError):
                radius = min(radius, 4)
            return (
                f"split[main][sub];[sub]crop={width}:{height}:{x}:{y},"
                f"boxblur=luma_radius={radius}:luma_power={power}:chroma_radius=0[blurred];"
                f"[main][blurred]overlay={overlay_x}:{overlay_y}{enable}"
            )

        if mode == "crop":
            return f"crop=iw:ih-{height}:0:0"

        if mode == "sttn_lama":
            return f"drawbox=x={x}:y={y}:w={width}:h={height}:color=black@{opacity}:t=fill{enable}"

        return ""

    def get_multi_filter_string(
        self,
        boxes: list[tuple[int, int, int, int]],
        mode: str = "blur",
        opacity: float = 0.85,
        blur_strength: int = 20,
    ) -> str:
        """Sinh chuỗi filter FFmpeg che đồng thời nhiều vùng (boxes) với blur_strength thực tế."""
        if not boxes:
            return ""
        segments = [
            TimedMaskSegment(x=x, y=y, width=w, height=h, always_on=True)
            for x, y, w, h in boxes
        ]
        return self.get_timed_multi_filter_string(
            segments=segments,
            mode=mode,
            opacity=opacity,
            blur_strength=blur_strength,
        )

    def get_timed_multi_filter_string(
        self,
        segments: Sequence[TimedMaskSegment],
        mode: str = "blur",
        opacity: float = 0.85,
        blur_strength: int = 20,
    ) -> str:
        """Chain timed/always-on mask segments. Empty enable means permanent mask."""
        if not segments:
            return ""
        if len(segments) == 1 and (segments[0].always_on or segments[0].start_pts is None):
            seg = segments[0]
            return self.get_filter_string(
                mode=mode,
                x=seg.x,
                y=seg.y,
                width=seg.width,
                height=seg.height,
                opacity=opacity,
                blur_strength=blur_strength,
                enable_expr=_enable_clause(seg.start_pts, seg.end_pts, seg.always_on),
            )

        if mode in ("box", "sttn_lama"):
            parts = []
            for seg in segments:
                enable = _enable_clause(seg.start_pts, seg.end_pts, seg.always_on)
                parts.append(
                    f"drawbox=x={seg.x}:y={seg.y}:w={seg.width}:h={seg.height}:color=black@{opacity}:t=fill{enable}"
                )
            return ",".join(parts)

        if mode == "mosaic":
            chain_parts = []
            block_size = max(4, min(32, int(blur_strength * 0.5)))
            for i, seg in enumerate(segments):
                bx, by, bw, bh = seg.x, seg.y, seg.width, seg.height
                ox = str(bx).replace("iw", "main_w").replace("ih", "main_h")
                oy = str(by).replace("iw", "main_w").replace("ih", "main_h")
                enable = _enable_clause(seg.start_pts, seg.end_pts, seg.always_on)
                in_tag = f"[m{i-1}]" if i > 0 else ""
                is_last = i == len(segments) - 1
                out_tag = "" if is_last else f"[m{i}]"
                chain_parts.append(
                    f"{in_tag}split[main{i}][sub{i}];[sub{i}]crop={bw}:{bh}:{bx}:{by},"
                    f"scale=iw/{block_size}:ih/{block_size}:flags=neighbor,"
                    f"scale={bw}:{bh}:flags=neighbor[blurred{i}];"
                    f"[main{i}][blurred{i}]overlay={ox}:{oy}{enable}{out_tag}"
                )
            return ";".join(chain_parts)

        if mode in ("blur", "feather_tight", "optical_blend", "soft_cinema", "feather", "glass", "ambient", "gradient"):
            chain_parts = []
            base_factor = 0.9 if mode in ("feather_tight", "optical_blend", "soft_cinema") else 0.7
            radius = max(2, min(50, int(blur_strength * base_factor)))
            power = 4 if mode in ("feather_tight", "optical_blend", "soft_cinema") else 3
            for i, seg in enumerate(segments):
                bx, by, bw, bh = seg.x, seg.y, seg.width, seg.height
                ox = str(bx).replace("iw", "main_w").replace("ih", "main_h")
                oy = str(by).replace("iw", "main_w").replace("ih", "main_h")
                try:
                    h_val = int(bh)
                    box_radius = max(1, min(radius, max(1, (h_val // 2) - 1))) if h_val > 0 else radius
                except (ValueError, TypeError):
                    box_radius = min(radius, 4)
                enable = _enable_clause(seg.start_pts, seg.end_pts, seg.always_on)
                in_tag = f"[m{i-1}]" if i > 0 else ""
                is_last = i == len(segments) - 1
                out_tag = "" if is_last else f"[m{i}]"
                chain_parts.append(
                    f"{in_tag}split[main{i}][sub{i}];[sub{i}]crop={bw}:{bh}:{bx}:{by},"
                    f"boxblur=luma_radius={box_radius}:luma_power={power}:chroma_radius=0[blurred{i}];"
                    f"[main{i}][blurred{i}]overlay={ox}:{oy}{enable}{out_tag}"
                )
            return ";".join(chain_parts)

        return ""
