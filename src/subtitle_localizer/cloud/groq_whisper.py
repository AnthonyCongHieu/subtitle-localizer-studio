"""Groq Cloud Whisper Subtitle Extractor.

Sử dụng Groq LPU Cloud ASR (Whisper Large-v3 / Whisper Large-v3-turbo)
để nhận diện giọng nói siêu tốc (~250x-300x realtime), trích xuất phụ đề
với mốc thời gian chính xác và phân đoạn câu rõ ràng.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
import subprocess
import tempfile
from typing import Any, Callable, Dict, List, Optional
import uuid

import requests

from subtitle_localizer.cloud.groq_pool import get_global_groq_pool, mask_groq_key
from subtitle_localizer.domain.models import SubtitleCueV1

logger = logging.getLogger(__name__)

DEFAULT_GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions"
SUPPORTED_GROQ_MODELS = ("whisper-large-v3", "whisper-large-v3-turbo")


class GroqWhisperExtractor:
    """Bóc tách phụ đề qua Groq Cloud Whisper Large-v3 LPU."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "whisper-large-v3",
        endpoint: str = DEFAULT_GROQ_ENDPOINT,
        timeout: int = 180,
    ) -> None:
        self.explicit_api_key = api_key
        self.model = model if model in SUPPORTED_GROQ_MODELS else "whisper-large-v3"
        self.endpoint = endpoint
        self.timeout = timeout

    @property
    def api_key(self) -> str:
        """API key tường minh hoặc từ biến môi trường GROQ_API_KEY."""
        return self.explicit_api_key or os.environ.get("GROQ_API_KEY", "")

    def _extract_audio(self, video_path: Path, output_path: Path) -> None:
        """Trích xuất luồng âm thanh sang MP3 16kHz mono 64kbps để tối ưu dung lượng và băng thông mạng."""
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-vn",
            "-acodec",
            "libmp3lame",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-b:a",
            "64k",
            str(output_path),
        ]
        result = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0 or not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError(f"FFmpeg audio extraction failed: {result.stderr.strip()}")

    def extract_cues(
        self,
        video_path: Path,
        source_lang: str = "auto",
        progress_callback: Optional[Callable[[float, str], None]] = None,
    ) -> List[SubtitleCueV1]:
        """Trích xuất phụ đề từ video thông qua Groq Cloud Whisper kèm cơ chế tự động xoay tua API Key."""
        if not video_path.exists() or not video_path.is_file():
            raise FileNotFoundError(f"Video file does not exist: {video_path}")

        pool = get_global_groq_pool()

        # Xác định key ban đầu: explicit -> pool -> env var
        active_key = self.explicit_api_key
        if not active_key and pool.total_keys > 0:
            active_key = pool.get_next_key()
        if not active_key:
            active_key = os.environ.get("GROQ_API_KEY", "")

        if not active_key:
            raise ValueError(
                "Chưa cấu hình Groq API Key! Vui lòng nhập Groq API Key trong Cài Đặt hoặc thêm vào Groq Key Pool."
            )

        temp_audio_dir = Path(tempfile.gettempdir()) / "sub_localizer_groq"
        temp_audio_dir.mkdir(parents=True, exist_ok=True)
        temp_audio_file = temp_audio_dir / f"audio_{uuid.uuid4().hex[:8]}.mp3"

        try:
            if progress_callback:
                progress_callback(0.2, "Đang trích xuất luồng âm thanh từ video...")

            logger.info("Extracting audio from %s to %s", video_path.name, temp_audio_file)
            self._extract_audio(video_path, temp_audio_file)

            audio_size_mb = temp_audio_file.stat().st_size / (1024 * 1024)
            logger.info("Extracted audio size: %.2f MB", audio_size_mb)

            if audio_size_mb > 25.0:
                raise ValueError(
                    f"File âm thanh ({audio_size_mb:.1f} MB) vượt quá giới hạn 25MB của Groq API. "
                    "Hãy nén hoặc cắt video thành các đoạn ngắn hơn."
                )

            max_attempts = max(1, min(pool.total_keys, 5)) if (not self.explicit_api_key and pool.total_keys > 0) else 1

            for attempt in range(max_attempts):
                if progress_callback:
                    progress_callback(
                        0.4,
                        f"Đang gửi âm thanh lên Groq Cloud LPU ({self.model}) [Key: {mask_groq_key(active_key)}]...",
                    )

                headers = {
                    "Authorization": f"Bearer {active_key}",
                }
                form_data: Dict[str, Any] = {
                    "model": self.model,
                    "response_format": "verbose_json",
                    "temperature": "0.0",
                }
                if source_lang and source_lang != "auto":
                    form_data["language"] = source_lang

                with open(temp_audio_file, "rb") as af:
                    files = {
                        "file": (temp_audio_file.name, af, "audio/mpeg"),
                    }
                    logger.info("Sending request to Groq endpoint: %s (attempt %d/%d)", self.endpoint, attempt + 1, max_attempts)
                    resp = requests.post(
                        self.endpoint,
                        headers=headers,
                        data=form_data,
                        files=files,
                        timeout=self.timeout,
                    )

                if resp.status_code == 429:
                    logger.warning("Groq API key %s gặp HTTP 429 Rate Limit", mask_groq_key(active_key))
                    pool.mark_rate_limited(active_key, cooldown_seconds=60.0, reason="HTTP 429 Rate Limit")
                    if attempt < max_attempts - 1:
                        next_key = pool.get_next_key()
                        if next_key:
                            active_key = next_key
                            continue
                    raise RuntimeError("Vượt quá giới hạn Rate Limit của Groq Cloud (HTTP 429). Vui lòng thử lại sau.")

                if resp.status_code == 401:
                    logger.warning("Groq API key %s không hợp lệ (HTTP 401)", mask_groq_key(active_key))
                    if not self.explicit_api_key and attempt < max_attempts - 1:
                        next_key = pool.get_next_key()
                        if next_key:
                            active_key = next_key
                            continue
                    raise PermissionError("Groq API Key không hợp lệ hoặc đã hết hạn (HTTP 401).")

                if not resp.ok:
                    raise RuntimeError(
                        f"Groq API error ({resp.status_code}): {resp.text}"
                    )

                # Thành công
                break

            if progress_callback:
                progress_callback(0.8, "Đang xử lý kết quả nhận diện từ Groq...")

            resp_json = resp.json()
            segments = resp_json.get("segments", [])

            cues: List[SubtitleCueV1] = []
            for seg in segments:
                start = round(float(seg.get("start", 0.0)), 3)
                end = round(float(seg.get("end", start + 1.0)), 3)
                text = str(seg.get("text", "")).strip()
                if text and end > start:
                    cues.append(
                        SubtitleCueV1(
                            cue_id=f"groq-{uuid.uuid4().hex[:8]}",
                            start_pts=start,
                            end_pts=end,
                            source_text=text,
                            quality_flags=["groq_whisper_extracted"],
                        )
                    )

            logger.info("Groq Whisper successfully extracted %d cues", len(cues))
            return cues

        finally:
            if temp_audio_file.exists():
                try:
                    temp_audio_file.unlink()
                except OSError:
                    pass
