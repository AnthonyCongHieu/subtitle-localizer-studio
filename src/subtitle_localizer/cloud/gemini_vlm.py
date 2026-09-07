"""Google Gemini 2.5 Flash Multimodal Video VLM Subtitle Extractor.

Sử dụng Google Gemini File API để upload video và phân tích cả hình ảnh (OCR)
lẫn âm thanh (ASR), trích xuất toàn bộ phụ đề cứng trên video.
Tích hợp tự động với GeminiKeyPool để xoay tua 43 API keys và tự động dọn dẹp file.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import re
import time
from typing import Any, Dict, List, Optional
import uuid

from subtitle_localizer.domain.models import SubtitleCueV1

logger = logging.getLogger(__name__)


class GeminiVideoVlmExtractor:
    """Bóc tách phụ đề video bằng mô hình Gemini Multimodal Video VLM."""

    def __init__(
        self,
        model_name: str = "gemini-2.5-flash",
        api_key: Optional[str] = None,
    ) -> None:
        self.model_name = model_name
        self.explicit_api_key = api_key

    def _parse_subtitles_from_text(self, text: str) -> List[Dict[str, Any]]:
        """Phân tích nội dung phản hồi từ Gemini thành danh sách subtitle segments."""
        results: List[Dict[str, Any]] = []
        if not text:
            return results

        # 1. Thử parse trực tiếp dạng JSON mảng
        clean_text = text.strip()
        if clean_text.startswith("```"):
            clean_text = re.sub(r"^```[a-zA-Z0-9_-]*\n", "", clean_text)
            clean_text = re.sub(r"\n```$", "", clean_text).strip()

        try:
            parsed = json.loads(clean_text)
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, dict) and "text" in item:
                        start = float(item.get("start", item.get("start_time", 0.0)))
                        end = float(item.get("end", item.get("end_time", start + 2.0)))
                        val = str(item["text"]).strip()
                        if val:
                            results.append({"start": round(start, 3), "end": round(end, 3), "text": val})
                if results:
                    return results
        except Exception:
            pass

        # 2. Parse theo định dạng SRT tiêu chuẩn
        srt_pattern = re.compile(
            r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*\n(.*?)(?=\n\s*\n|\Z)",
            re.DOTALL,
        )
        for match in srt_pattern.finditer(text):
            sh, sm, ss, sms = map(int, match.groups()[:4])
            eh, em, es, ems = map(int, match.groups()[4:8])
            raw_sub = match.group(9).strip()
            # Bỏ các dòng phụ số thứ tự nếu có
            sub_lines = [line.strip() for line in raw_sub.splitlines() if line.strip() and not line.strip().isdigit()]
            final_text = " ".join(sub_lines)
            start_sec = sh * 3600 + sm * 60 + ss + sms / 1000.0
            end_sec = eh * 3600 + em * 60 + es + ems / 1000.0
            if final_text and end_sec > start_sec:
                results.append({"start": round(start_sec, 3), "end": round(end_sec, 3), "text": final_text})

        return results

    def extract_cues(
        self,
        video_path: Path,
        source_lang: str = "auto",
        progress_callback: Optional[Any] = None,
    ) -> List[SubtitleCueV1]:
        """Upload video lên Gemini File API, trích xuất phụ đề và chuyển hóa thành SubtitleCueV1."""
        if not video_path.exists() or not video_path.is_file():
            raise FileNotFoundError(f"Video file does not exist: {video_path}")

        from subtitle_localizer.translation.key_pool import get_global_gemini_pool
        pool = get_global_gemini_pool()

        # Xác định API Key khả dụng
        active_key = self.explicit_api_key or os.environ.get("GEMINI_API_KEY", "")
        if not active_key and pool.total_keys > 0:
            active_key = pool.get_next_key()

        if not active_key:
            raise RuntimeError("Không có Gemini API Key hợp lệ trong hệ thống hoặc Key Pool.")

        from google import genai

        lang_hint = "Chinese (zh)" if source_lang == "zh" else source_lang
        prompt = (
            f"You are an expert video subtitler. Watch this video carefully. "
            f"Transcribe all dialogue and hardcoded on-screen subtitles ({lang_hint}). "
            f"Extract each subtitle entry with start and end timestamps in seconds. "
            f"Respond strictly in JSON format as a list of objects with fields 'start' (float seconds), "
            f"'end' (float seconds), and 'text' (string). "
            f"Example: [{{\"start\": 1.5, \"end\": 3.8, \"text\": \"你好\"}}]. "
            f"Do not include markdown or explanations."
        )

        remote_file_name = None
        max_attempts = min(pool.total_keys, 5) if pool.total_keys > 0 else 1

        for attempt in range(max_attempts):
            client = genai.Client(api_key=active_key)
            try:
                if progress_callback:
                    progress_callback(0.15, "Đang tải video lên Google Gemini Cloud...")

                logger.info("Uploading video %s to Gemini File API...", video_path.name)
                video_file = client.files.upload(file=str(video_path))
                remote_file_name = video_file.name

                if progress_callback:
                    progress_callback(0.35, "Chờ Google Cloud xử lý chỉ mục video...")

                # Chờ video chuyển trạng thái ACTIVE
                wait_time = 0
                while video_file.state == "PROCESSING" and wait_time < 90:
                    time.sleep(2)
                    wait_time += 2
                    video_file = client.files.get(name=remote_file_name)

                if video_file.state != "ACTIVE":
                    raise RuntimeError(f"Video processing failed with state: {video_file.state}")

                if progress_callback:
                    progress_callback(0.55, "Gemini đang xem hình và trích xuất phụ đề...")

                logger.info("Generating subtitle content via model %s...", self.model_name)
                response = client.models.generate_content(
                    model=self.model_name,
                    contents=[video_file, prompt],
                )

                raw_output = response.text or ""
                parsed_segments = self._parse_subtitles_from_text(raw_output)

                cues: List[SubtitleCueV1] = []
                for idx, seg in enumerate(parsed_segments, 1):
                    cues.append(
                        SubtitleCueV1(
                            cue_id=f"gemini-vlm-{uuid.uuid4().hex[:8]}",
                            start_pts=seg["start"],
                            end_pts=seg["end"],
                            source_text=seg["text"],
                            quality_flags=["cloud_vlm_extracted"],
                        )
                    )

                logger.info("Successfully extracted %d cues via Gemini VLM", len(cues))
                return cues

            except Exception as exc:
                err_str = str(exc).lower()
                logger.warning("Gemini VLM attempt %d failed: %s", attempt + 1, exc)
                if "429" in err_str or "resource_exhausted" in err_str:
                    pool.mark_rate_limited(active_key, cooldown_seconds=60.0)
                    next_key = pool.get_next_key()
                    if next_key:
                        active_key = next_key
                        continue
                if attempt == max_attempts - 1:
                    raise RuntimeError(f"Gemini VLM extraction failed: {exc}") from exc
            finally:
                if remote_file_name:
                    try:
                        client.files.delete(name=remote_file_name)
                        logger.info("Cleaned up remote file: %s", remote_file_name)
                    except Exception:
                        pass

        return []
