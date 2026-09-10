import os
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.service.pipeline_settings import (
    GlobalPipelineSettings,
    TranslationSettings,
    get_global_pipeline_settings,
    set_global_pipeline_settings,
)
from subtitle_localizer.translation.real import RealTranslationProvider


class _GeminiPool:
    total_keys = 1


def _cues():
    return [SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="你好")]


def test_translation_provider_respects_gemini_config():
    original_settings = get_global_pipeline_settings()
    provider = RealTranslationProvider()
    try:
        set_global_pipeline_settings(
            GlobalPipelineSettings(
                translation=TranslationSettings(provider="gemini", auto_fallback=True)
            )
        )
        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}, clear=False), patch(
            "subtitle_localizer.translation.key_pool.get_global_gemini_pool",
            return_value=_GeminiPool(),
        ), patch.object(provider, "_translate_with_gemini", return_value=True) as gemini, patch.object(
            provider, "_translate_with_local_qwen", return_value=True
        ) as local:
            provider.translate_cues(_cues())

        gemini.assert_called_once()
        local.assert_not_called()
    finally:
        set_global_pipeline_settings(original_settings)


def test_translation_falls_back_to_local_when_gemini_fails():
    original_settings = get_global_pipeline_settings()
    provider = RealTranslationProvider()
    try:
        set_global_pipeline_settings(
            GlobalPipelineSettings(
                translation=TranslationSettings(provider="gemini", auto_fallback=True)
            )
        )
        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}, clear=False), patch(
            "subtitle_localizer.translation.key_pool.get_global_gemini_pool",
            return_value=_GeminiPool(),
        ), patch.object(provider, "_translate_with_gemini", return_value=False) as gemini, patch.object(
            provider, "_translate_with_local_qwen", return_value=True
        ) as local:
            provider.translate_cues(_cues())

        gemini.assert_called_once()
        local.assert_called_once()
    finally:
        set_global_pipeline_settings(original_settings)
