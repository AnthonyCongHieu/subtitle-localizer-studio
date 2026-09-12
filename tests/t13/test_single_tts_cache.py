import asyncio
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

import subtitle_localizer.dubbing.tts as tts


def test_single_tts_cache_deduplicates_provider_calls():
    async def run():
        with TemporaryDirectory() as d, patch.dict("os.environ", {"SUBTITLE_TTS_CACHE_DIR": d}), \
             patch.object(tts, "_synthesize_edge_tts", new=AsyncMock(return_value=b"audio")) as synth:
            first = await tts.synthesize_text("  Xin chào!  ", provider="edge", voice="vi-VN-NamMinhNeural")
            second = await tts.synthesize_text("Xin chào!", provider="edge", voice="vi-VN-NamMinhNeural")
            assert first == second == b"audio"
            synth.assert_awaited_once()
    asyncio.run(run())
