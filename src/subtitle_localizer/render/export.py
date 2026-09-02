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
    ) -> Path:
        out = Path(output_video_path).resolve()
        out.parent.mkdir(parents=True, exist_ok=True)

        # Ghi vào file tạm trước (atomic render)
        prefix = f".tmp_render_{out.stem}_"
        with tempfile.NamedTemporaryFile(dir=str(out.parent), prefix=prefix, suffix=".mp4", delete=False) as tmp:
            tmp_path = Path(tmp.name)

        cmd = self.build_ffmpeg_render_command(
            source_video_path=source_video_path,
            output_video_path=tmp_path,
            ass_path=ass_path,
            mask_filter=mask_filter,
            use_nvenc=use_nvenc,
        )

        try:
            res = subprocess.run(cmd, check=False, capture_output=True, text=True)
            if res.returncode != 0:
                # Nếu NVENC lỗi, thử fallback sang CPU libx264
                if use_nvenc:
                    fallback_cmd = self.build_ffmpeg_render_command(
                        source_video_path=source_video_path,
                        output_video_path=tmp_path,
                        ass_path=ass_path,
                        mask_filter=mask_filter,
                        use_nvenc=False,
                    )
                    res2 = subprocess.run(fallback_cmd, check=False, capture_output=True, text=True)
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
