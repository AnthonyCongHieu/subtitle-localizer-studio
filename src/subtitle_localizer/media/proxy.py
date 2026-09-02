from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Optional


def generate_proxy_video(
    source_video_path: Path | str,
    output_proxy_path: Path | str,
    max_dimension: int = 640,
    crf: int = 28,
) -> Path:
    """
    Tạo proxy video độ phân giải nhẹ bằng FFmpeg libx264 ultrafast
    nhằm tăng tốc playback preview và waveform rendering trên UI.
    """
    src = Path(source_video_path).resolve()
    out = Path(output_proxy_path).resolve()
    if not src.exists():
        raise FileNotFoundError(f"Source video not found: {src}")

    if src == out:
        raise ValueError("Output proxy path cannot be identical to source video path!")

    out.parent.mkdir(parents=True, exist_ok=True)

    # Scale giữ nguyên tỷ lệ khung hình (portrait hoặc landscape)
    scale_filter = f"scale='if(gt(iw,ih),min({max_dimension},iw),-2)':'if(gt(iw,ih),-2,min({max_dimension},ih))'"

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-i",
        str(src),
        "-vf",
        scale_filter,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        str(crf),
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-pix_fmt",
        "yuv420p",
        str(out),
    ]

    res = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg failed to generate proxy: {res.stderr or res.stdout}")

    return out
