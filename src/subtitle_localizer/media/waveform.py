from __future__ import annotations

import math
import subprocess
from pathlib import Path
from typing import List, Optional


def extract_waveform_peaks(
    video_path: Optional[Path | str] = None,
    duration: float = 1.0,
    sample_rate: int = 10,
) -> List[float]:
    """
    Trích xuất danh sách các điểm biên độ âm thanh (peaks) thật chuẩn hóa [0.0, 1.0]
    từ video thật qua FFmpeg PCM để vẽ waveform timeline trên React UI.
    """
    total_samples = max(1, int(round(duration * sample_rate)))
    if video_path is None or not Path(video_path).exists():
        return [0.0] * total_samples

    path = Path(video_path).resolve()
    try:
        # Trích xuất dữ liệu âm thanh mono 8-bit không dấu bằng FFmpeg với tốc độ cực nhanh
        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "100",
            "-f",
            "u8",
            "pipe:1",
        ]
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        raw_bytes, _ = proc.communicate(timeout=15)
        if not raw_bytes:
            return [0.0] * total_samples

        raw_len = len(raw_bytes)
        bucket_size = max(1, raw_len // total_samples)
        peaks: List[float] = []

        for i in range(total_samples):
            start = i * bucket_size
            end = min(raw_len, start + bucket_size)
            if start >= raw_len:
                peaks.append(0.0)
                continue
            chunk = raw_bytes[start:end]
            if not chunk:
                peaks.append(0.0)
                continue
            peak_val = max(abs(b - 128) for b in chunk) / 128.0
            peaks.append(round(peak_val, 3))

        max_p = max(peaks) if peaks else 0.0
        if max_p > 0.05:
            scale = 1.0 / max_p
            peaks = [round(min(1.0, p * scale), 3) for p in peaks]

        return peaks
    except Exception:
        return [0.0] * total_samples


def extract_thumbnails(
    video_path: Path | str,
    output_dir: Path | str,
    fps: float = 0.5,
) -> List[Path]:
    """Trích xuất chuỗi thumbnail định kỳ (mỗi 2 giây 1 frame) cho timeline bar."""
    src = Path(video_path).resolve()
    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    out_pattern = str(out_dir / "thumb_%04d.jpg")
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-i",
        str(src),
        "-vf",
        f"fps={fps},scale=160:-1",
        "-q:v",
        "5",
        out_pattern,
    ]
    subprocess.run(cmd, check=False, capture_output=True)
    return sorted(list(out_dir.glob("thumb_*.jpg")))
