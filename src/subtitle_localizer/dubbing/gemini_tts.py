"""Module tích hợp Google Gemini AI Speech / TTS qua Interactions API.

Đặc điểm:
- Sử dụng mô hình chính thức gemini-3.1-flash-tts-preview.
- Tận dụng hệ thống GeminiKeyPool (xoay vòng 43 API keys).
- Cho phép điều khiển cảm xúc/sắc thái phát âm bằng tự nhiên ngữ (Prompt Tone/Emotion).
- Hỗ trợ 30 giọng nhân vật có cá tính riêng biệt (Puck, Kore, Zephyr, Fenrir, Aoede, Sulafat, v.v.).
- Chuyển đổi chuẩn hóa âm thanh L16 (24kHz) sang MP3 chất lượng cao qua FFmpeg.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import subprocess
from typing import Any, Dict, List, Optional
import urllib.request
import urllib.error

from subtitle_localizer.translation.key_pool import GeminiKeyPool, get_global_gemini_pool

logger = logging.getLogger(__name__)

INTERACTIONS_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions"
GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview"

GEMINI_VOICE_CATALOG: List[Dict[str, Any]] = [
    {
        "voice_id": "Puck",
        "display_name": "Puck (Upbeat & Energetic)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam vui tươi, hoạt náo, tràn đầy năng lượng, phù hợp giải trí và vlog ngắn.",
        "tags": ["Vui tươi", "Sôi nổi", "Hoạt náo"],
    },
    {
        "voice_id": "Kore",
        "display_name": "Kore (Firm & Decisive)",
        "lang": "all",
        "gender": "female",
        "description": "Giọng nữ đanh thép, quyết đoán, rõ ràng, phù hợp bài giảng và phóng sự tin tức.",
        "tags": ["Quyết đoán", "Rõ ràng", "Phóng sự"],
    },
    {
        "voice_id": "Zephyr",
        "display_name": "Zephyr (Bright & Friendly)",
        "lang": "all",
        "gender": "female",
        "description": "Giọng nữ tươi sáng, thân thiện, mang lại cảm giác ấm áp và gần gũi.",
        "tags": ["Tươi sáng", "Thân thiện", "Tự nhiên"],
    },
    {
        "voice_id": "Fenrir",
        "display_name": "Fenrir (Excitable & Bold)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam phấn khích, hào hứng, tạo kịch tính cho phim hành động và thể thao.",
        "tags": ["Hào hứng", "Kịch tính", "Hành động"],
    },
    {
        "voice_id": "Aoede",
        "display_name": "Aoede (Breezy & Relaxed)",
        "lang": "all",
        "gender": "female",
        "description": "Giọng nữ phóng khoáng, thư giãn, êm ả, phù hợp nội dung du lịch và ẩm thực.",
        "tags": ["Thư giãn", "Phóng khoáng", "Du lịch"],
    },
    {
        "voice_id": "Sulafat",
        "display_name": "Sulafat (Warm Storyteller)",
        "lang": "all",
        "gender": "female",
        "description": "Giọng nữ ấm áp, truyền cảm, hoàn hảo cho kể chuyện và tóm tắt tiểu thuyết.",
        "tags": ["Ấm áp", "Kể chuyện", "Truyền cảm"],
    },
    {
        "voice_id": "Charon",
        "display_name": "Charon (Informative & Steady)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam trầm ổn, chuẩn mực chuyên gia, thích hợp thuyết minh tài liệu khoa học.",
        "tags": ["Trầm ổn", "Tài liệu", "Khoa học"],
    },
    {
        "voice_id": "Enceladus",
        "display_name": "Enceladus (Breathy & Mysterious)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam thì thầm, hơi thở bí ẩn, thích hợp phim kinh dị, trinh thám.",
        "tags": ["Thì thầm", "Bí ẩn", "Trinh thám"],
    },
    {
        "voice_id": "Leda",
        "display_name": "Leda (Youthful & Casual)",
        "lang": "all",
        "gender": "female",
        "description": "Giọng nữ thanh thiếu niên trẻ trung, đối thoại tự nhiên hàng ngày.",
        "tags": ["Trẻ trung", "Gen Z", "Hàng ngày"],
    },
    {
        "voice_id": "Orus",
        "display_name": "Orus (Authoritative Deep)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam quyền lực, trầm vang, phong thái lãnh đạo và giới thiệu phim điện ảnh.",
        "tags": ["Quyền lực", "Trầm vang", "Trailer Phim"],
    },
    {
        "voice_id": "Despina",
        "display_name": "Despina (Smooth Narrator)",
        "lang": "all",
        "gender": "female",
        "description": "Giọng nữ mượt mà, phát âm lưu loát, chuẩn audiobook chuyên nghiệp.",
        "tags": ["Mượt mà", "Audiobook", "Chuyên nghiệp"],
    },
    {
        "voice_id": "Algenib",
        "display_name": "Algenib (Gravelly & Gritty)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam khàn gai góc, phong trần, đậm chất nhân vật điện ảnh cổ điển.",
        "tags": ["Khàn", "Gai góc", "Điện ảnh"],
    },
    {
        "voice_id": "Callirrhoe",
        "display_name": "Callirrhoe (Graceful & Melodic)",
        "lang": "all",
        "gender": "female",
        "description": "Giọng nữ thanh nhã, giai điệu êm dịu, rất hợp phim thơ mộng và vlog nghệ thuật.",
        "tags": ["Thanh nhã", "Êm dịu", "Nghệ thuật"],
    },
    {
        "voice_id": "Eurydice",
        "display_name": "Eurydice (Poetic & Intimate)",
        "lang": "all",
        "gender": "female",
        "description": "Giọng nữ giàu chất thơ, thủ thỉ tâm tình, lắng đọng cảm xúc sâu sắc.",
        "tags": ["Chất thơ", "Tâm tình", "Sâu lắng"],
    },
    {
        "voice_id": "Hermes",
        "display_name": "Hermes (Nimble & Quick-witted)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam nhanh nhẹn, thông minh, hoạt ngôn, phù hợp tóm tắt nhanh và recap.",
        "tags": ["Nhanh nhẹn", "Thông minh", "Recap"],
    },
    {
        "voice_id": "Jupiter",
        "display_name": "Jupiter (Epic & Monumental)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam sử thi, vang dội, khí chất thần thoại cho các tựa phim bom tấn hoành tráng.",
        "tags": ["Sử thi", "Hoành tráng", "Bom tấn"],
    },
    {
        "voice_id": "Ganymede",
        "display_name": "Ganymede (Youthful Radiance)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam trẻ trung, rạng rỡ, trong sáng cho anime và thanh xuân học đường.",
        "tags": ["Trẻ trung", "Rạng rỡ", "Thanh xuân"],
    },
    {
        "voice_id": "Triton",
        "display_name": "Triton (Deep Oceanic)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam trầm vang như tiếng sóng biển, bí ẩn và cuốn hút kỳ lạ.",
        "tags": ["Trầm vang", "Bí ẩn", "Huyền bí"],
    },
    {
        "voice_id": "Proteus",
        "display_name": "Proteus (Dynamic Shape-shifter)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam biến hóa linh hoạt theo từng tình huống thoại, phong phú đa diện.",
        "tags": ["Biến hóa", "Đa diện", "Linh hoạt"],
    },
    {
        "voice_id": "Titan",
        "display_name": "Titan (Thunderous Might)",
        "lang": "all",
        "gender": "male",
        "description": "Giọng nam gầm vang uy lực, phù hợp nhân vật phản diện hoặc đại tướng quân đội.",
        "tags": ["Uy lực", "Phản diện", "Chiến tranh"],
    },
]

PROMPT_STYLE_PRESETS: Dict[str, str] = {
    "dramatic": "Say in a dramatic, suspenseful cinematic storytelling tone: ",
    "cheerful": "Say in an upbeat, cheerful and enthusiastic tone: ",
    "whisper": "Say in a mysterious, quiet whisper: ",
    "serious": "Say in an authoritative, clear and serious documentary narration tone: ",
    "emotional": "Say with deep emotion, heartfelt sensitivity and warmth: ",
    "natural": "Say in a completely natural, relaxed conversational tone: ",
}


def _convert_l16_to_mp3(raw_pcm_bytes: bytes, input_sample_rate: int = 24000) -> bytes:
    """Chuyển đổi dữ liệu PCM raw s16le (24kHz) từ Gemini thành MP3 128k bằng FFmpeg."""
    if not raw_pcm_bytes:
        return b""

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "s16le",
        "-ar",
        str(input_sample_rate),
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "-f",
        "mp3",
        "pipe:1",
    ]

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    mp3_bytes, err = proc.communicate(input=raw_pcm_bytes)
    if proc.returncode != 0 or not mp3_bytes:
        logger.warning(f"FFmpeg chuyển đổi PCM L16 sang MP3 thất bại: {err.decode('utf-8', errors='ignore')}")
        return b""
    return mp3_bytes


class GeminiTTSClient:
    """Client kết nối Google Gemini 3.1 Flash TTS qua Interactions API."""

    def __init__(self, key_pool: Optional[GeminiKeyPool] = None) -> None:
        self.key_pool = key_pool or get_global_gemini_pool()

    def build_prompt(self, text: str, style: str = "dramatic") -> str:
        """Ghép văn bản với tiền tố hướng dẫn biểu cảm (prompt style)."""
        prefix = PROMPT_STYLE_PRESETS.get(style.lower(), "")
        if not prefix and style:
            prefix = f"Say in a {style} tone: "
        return f"{prefix}{text.strip()}"

    async def synthesize(
        self,
        text: str,
        voice: str = "Puck",
        style: str = "dramatic",
        timeout: float = 25.0,
        max_retries: int = 3,
    ) -> bytes:
        """Sinh giọng đọc từ Google Gemini 3.1 Flash TTS và trả về dữ liệu MP3 (bytes)."""
        clean_text = text.strip()
        if not clean_text:
            return b""

        prompt_input = self.build_prompt(clean_text, style=style)
        actual_voice = voice.strip() or "Puck"

        payload = {
            "model": GEMINI_TTS_MODEL,
            "input": prompt_input,
            "response_format": {"type": "audio"},
            "generation_config": {
                "speech_config": [{"voice": actual_voice}]
            },
        }
        payload_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        for attempt in range(max_retries):
            api_key = self.key_pool.get_next_key()
            if not api_key:
                raise RuntimeError("Không có Gemini API Key hợp lệ trong pool để sinh giọng đọc.")

            def _call_gemini_sync(key: str) -> Optional[bytes]:
                req = urllib.request.Request(
                    INTERACTIONS_API_ENDPOINT,
                    data=payload_bytes,
                    headers={
                        "x-goog-api-key": key,
                        "Content-Type": "application/json",
                    },
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(req, timeout=timeout) as resp:
                        res_json = json.loads(resp.read().decode("utf-8"))
                        steps = res_json.get("steps", [])
                        if not steps:
                            return None
                        content = steps[0].get("content", [])
                        if not content:
                            return None
                        raw_base64 = content[0].get("data")
                        if not raw_base64:
                            return None
                        return base64.b64decode(raw_base64)
                except urllib.error.HTTPError as he:
                    error_body = he.read().decode("utf-8", errors="ignore")
                    logger.warning(f"Gemini TTS HTTP {he.code} (key {key[:8]}...): {error_body[:200]}")
                    if he.code in (429, 503):
                        self.key_pool.mark_key_rate_limited(key)
                    elif he.code in (400, 403):
                        self.key_pool.mark_key_invalid(key)
                    return None
                except Exception as ex:
                    logger.warning(f"Lỗi mạng khi gọi Gemini TTS: {ex}")
                    return None

            raw_l16_pcm = await asyncio.to_thread(_call_gemini_sync, api_key)
            if raw_l16_pcm:
                # Chuyển đổi PCM L16 (24kHz) sang định dạng MP3 đồng bộ
                mp3_data = _convert_l16_to_mp3(raw_l16_pcm, input_sample_rate=24000)
                if mp3_data:
                    return mp3_data

            await asyncio.sleep(0.5 * (attempt + 1))

        raise RuntimeError(f"Gemini TTS thất bại sau {max_retries} lần thử với các API keys.")
