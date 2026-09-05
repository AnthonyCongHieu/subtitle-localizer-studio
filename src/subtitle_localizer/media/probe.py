from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class MediaProbeResult:
    """Kết quả phân tích metadata video từ ffprobe."""
    width: int
    height: int
    duration: float
    fps: float
    codec_name: str
    bit_rate: int
    is_vfr: bool
    audio_present: bool
    raw_probe: Dict[str, Any] = field(default_factory=dict)
    frame_pts_seconds: List[float] = field(default_factory=list)

    @classmethod
    def from_ffprobe_json(cls, data: Dict[str, Any]) -> MediaProbeResult:
        video_stream = None
        audio_stream = None
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video" and video_stream is None:
                video_stream = stream
            elif stream.get("codec_type") == "audio" and audio_stream is None:
                audio_stream = stream

        width = int(video_stream.get("width", 0)) if video_stream else 0
        height = int(video_stream.get("height", 0)) if video_stream else 0
        codec_name = str(video_stream.get("codec_name", "unknown")) if video_stream else "unknown"

        # Tính toán fps từ r_frame_rate hoặc avg_frame_rate
        fps = 25.0
        if video_stream and "r_frame_rate" in video_stream:
            try:
                num, den = video_stream["r_frame_rate"].split("/")
                fps = float(num) / float(den) if float(den) != 0 else 25.0
            except Exception:
                fps = 25.0

        format_info = data.get("format", {})
        duration = float(format_info.get("duration", video_stream.get("duration", 0.0) if video_stream else 0.0))
        bit_rate = int(format_info.get("bit_rate", 0))

        frame_pts = data.get("frame_pts_seconds", [])
        is_vfr = False
        if frame_pts and len(frame_pts) >= 3:
            intervals = [round(r - l, 5) for l, r in zip(frame_pts, frame_pts[1:])]
            is_vfr = len(set(intervals)) > 1

        return cls(
            width=width,
            height=height,
            duration=duration,
            fps=fps,
            codec_name=codec_name,
            bit_rate=bit_rate,
            is_vfr=is_vfr,
            audio_present=audio_stream is not None,
            raw_probe=data,
            frame_pts_seconds=frame_pts,
        )


def probe_media(video_path: Path | str) -> MediaProbeResult:
    """Thực thi ffprobe trích xuất metadata video định dạng JSON."""
    path = Path(video_path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Video file does not exist: {path}")

    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        str(path),
    ]
    try:
        res = subprocess.run(cmd, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
        data = json.loads(res.stdout)
    except Exception as err:
        raise RuntimeError(f"FFprobe failed to analyze {path}: {err}")

    # Lấy frame timestamps nếu cần
    pts_cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "frame=best_effort_timestamp_time",
        "-of",
        "json",
        str(path),
    ]
    try:
        pts_res = subprocess.run(pts_cmd, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if pts_res.returncode == 0:
            pts_data = json.loads(pts_res.stdout)
            frames = pts_data.get("frames", [])
            data["frame_pts_seconds"] = [
                float(f["best_effort_timestamp_time"])
                for f in frames
                if "best_effort_timestamp_time" in f
            ]
    except Exception:
        pass

    return MediaProbeResult.from_ffprobe_json(data)
