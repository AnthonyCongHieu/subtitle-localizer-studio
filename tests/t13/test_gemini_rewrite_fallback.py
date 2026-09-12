import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from subtitle_localizer.dubbing.tts import rewrite_spoken_text_api_then_local


def test_gemini_rewrite_falls_back_to_local_when_under_25_percent():
    async def run():
        with patch("subtitle_localizer.dubbing.tts.rewrite_spoken_text_gemini", new=AsyncMock(return_value="")), \
             patch("subtitle_localizer.dubbing.tts.rewrite_spoken_text_local", new=AsyncMock(return_value="Câu ngắn")):
            result = await rewrite_spoken_text_api_then_local("Câu rất dài cần rút gọn")
            assert result == ("Câu ngắn", "local_model")
    asyncio.run(run())
