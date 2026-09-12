import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.dubbing.tts import generate_timed_voiceover


def test_disabled_local_rewrite_never_calls_ollama(tmp_path):
    async def run():
        cue = SubtitleCueV1(cue_id="c1", start_pts=0, end_pts=0.5, translated_text="Một câu rất dài để kiểm tra")
        with patch("subtitle_localizer.dubbing.tts.synthesize_text", new=AsyncMock(return_value=b"")), \
             patch("subtitle_localizer.dubbing.tts.rewrite_spoken_text_local", new=AsyncMock()) as rewrite:
            try:
                await generate_timed_voiceover([cue], output_path=tmp_path / "x.mp3", local_rewrite_enabled=False)
            except ValueError:
                pass
            rewrite.assert_not_awaited()
    asyncio.run(run())
