from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional


class VideoExporter:
    """Xây dựng và thực thi lệnh render video MP4 với subtitle và masking."""

    def build_ffmpeg_render_command(
        self,
        source_video_path: Path | str,
        output_video_path: Path | str,
        ass_path: Optional[Path | str] = None,
        mask_filter: Optional[str] = None,
        use_nvenc: bool = True,
        crf: int = 20,
        flip_h: bool = False,
        flip_v: bool = False,
        rotation: float = 0.0,
        resolution: str = "original",
        aspect_ratio: str = "original",
    ) -> List[str]:
        src = Path(source_video_path).resolve()
        out = Path(output_video_path).resolve()

        filters: List[str] = []
        if mask_filter:
            filters.append(mask_filter)

        if ass_path:
            ass_resolved = Path(ass_path).resolve()
            # Windows path escaping cho FFmpeg sub filter
            ass_filter_path = str(ass_resolved).replace("\\", "/").replace(":", "\\:")
            filters.append(f"subtitles='{ass_filter_path}'")

        # Áp dụng lật video ngang / dọc theo yêu cầu xuất video để lách bản quyền
        if flip_h:
            filters.append("hflip")
        if flip_v:
            filters.append("vflip")

        # Áp dụng xoay khung hình video thật sự bằng FFmpeg transpose filter
        if rotation:
            rot_norm = int(rotation) % 360
            if rot_norm == 90:
                filters.append("transpose=1")
            elif rot_norm == 180:
                filters.append("hflip,vflip")
            elif rot_norm == 270:
                filters.append("transpose=2")

        # Giữ đúng tỷ lệ, không kéo giãn hình; scale theo chiều cao rồi pad vào canvas.
        if resolution in {"720p", "1080p", "2k"}:
            target_h = {"720p": 720, "1080p": 1080, "2k": 1440}[resolution]
            filters.append(f"scale=-2:{target_h}:force_original_aspect_ratio=decrease")
        if aspect_ratio in {"16:9", "9:16"}:
            w, h = (16, 9) if aspect_ratio == "16:9" else (9, 16)
            filters.append(f"pad=ceil(max(iw,ih*{w}/{h})/2)*2:ceil(max(ih,iw*{h}/{w})/2)*2:(ow-iw)/2:(oh-ih)/2")

        vf_arg = ",".join(filters) if filters else None
        vcodec = "h264_nvenc" if use_nvenc else "libx264"

        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-i",
            str(src),
        ]

        if vf_arg:
            cmd.extend(["-vf", vf_arg])

        cmd.extend([
            "-c:v",
            vcodec,
            "-preset",
            "p5" if use_nvenc else "medium",
            "-c:a",
            "copy",
            str(out),
        ])

        return cmd

    def render_video(
        self,
        source_video_path: Path | str,
        output_video_path: Path | str,
        ass_path: Optional[Path | str] = None,
        mask_filter: Optional[str] = None,
        use_nvenc: bool = True,
        flip_h: bool = False,
        flip_v: bool = False,
        rotation: float = 0.0,
        resolution: str = "original",
        aspect_ratio: str = "original",
    ) -> Path:
        out = Path(output_video_path).resolve()
        out.parent.mkdir(parents=True, exist_ok=True)

        # Ghi vào file tạm trước (atomic render)
        prefix = f".tmp_render_{out.stem}_"
        with tempfile.NamedTemporaryFile(dir=str(out.parent), prefix=prefix, suffix=out.suffix or ".mp4", delete=False) as tmp:
            tmp_path = Path(tmp.name)

        cmd = self.build_ffmpeg_render_command(
            source_video_path=source_video_path,
            output_video_path=tmp_path,
            ass_path=ass_path,
            mask_filter=mask_filter,
            use_nvenc=use_nvenc,
            flip_h=flip_h,
            flip_v=flip_v,
            rotation=rotation,
            resolution=resolution,
            aspect_ratio=aspect_ratio,
        )

        try:
            # Thêm encoding='utf-8' và errors='replace' để chống lỗi UnicodeDecodeError charmap trên Windows
            res = subprocess.run(cmd, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if res.returncode != 0:
                # Nếu NVENC lỗi, thử fallback sang CPU libx264
                if use_nvenc:
                    fallback_cmd = self.build_ffmpeg_render_command(
                        source_video_path=source_video_path,
                        output_video_path=tmp_path,
                        ass_path=ass_path,
                        mask_filter=mask_filter,
                        use_nvenc=False,
                        flip_h=flip_h,
                        flip_v=flip_v,
                        rotation=rotation,
                        resolution=resolution,
                        aspect_ratio=aspect_ratio,
                    )
                    res2 = subprocess.run(fallback_cmd, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
                    if res2.returncode != 0:
                        raise RuntimeError(f"FFmpeg render failed: {res2.stderr or res2.stdout}")
                else:
                    raise RuntimeError(f"FFmpeg render failed: {res.stderr or res.stdout}")

            # Atomic replace
            os.replace(tmp_path, out)
            return out
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
