import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.translation.context import ContextualBatcher
from subtitle_localizer.translation.glossary import GlossaryPreserver
from subtitle_localizer.translation.mock import MockTranslationProvider
from subtitle_localizer.translation.registry import TranslationRegistry


class TranslationRuntimeTest(unittest.TestCase):
    def test_contextual_batching_window(self) -> None:
        batcher = ContextualBatcher(window_size=1)
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="Hello"),
            SubtitleCueV1(cue_id="c2", start_pts=1.5, end_pts=2.5, source_text="How are you?"),
            SubtitleCueV1(cue_id="c3", start_pts=3.0, end_pts=4.0, source_text="I am fine."),
        ]
        windows = batcher.build_windows(cues)
        self.assertEqual(len(windows), 3)
        # Window cho c2 có prev là c1 và next là c3
        self.assertEqual(windows[1].prev_text, "Hello")
        self.assertEqual(windows[1].target_cue.source_text, "How are you?")
        self.assertEqual(windows[1].next_text, "I am fine.")

    def test_glossary_and_number_preservation(self) -> None:
        glossary = GlossaryPreserver(terms={"Subtitle Localizer": "Bộ bản địa hóa phụ đề"})
        original_text = "Chào mừng bạn đến với Subtitle Localizer phiên bản 2026."

        # Bảo toàn số và thuật ngữ
        masked_text, placeholders = glossary.protect_entities(original_text)
        self.assertIn("__TERM_0__", masked_text)
        self.assertIn("__NUM_0__", masked_text)

        # Khôi phục lại
        restored = glossary.restore_entities(masked_text, placeholders)
        self.assertEqual(restored, original_text)

    def test_mock_translation_to_vietnamese(self) -> None:
        provider = MockTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="你好世界"),
            SubtitleCueV1(cue_id="c2", start_pts=1.2, end_pts=2.2, source_text="This is an English test"),
        ]
        translated = provider.translate_cues(cues, source_lang="zh", target_lang="vi")
        self.assertEqual(len(translated), 2)
        self.assertTrue(len(translated[0].translated_text) > 0)
        self.assertIn("Xin chào", translated[0].translated_text)

    def test_translation_registry_and_nllb_license_flag(self) -> None:
        registry = TranslationRegistry()
        nllb_provider = registry.get_provider("nllb")
        self.assertIsNotNone(nllb_provider)
        desc = nllb_provider.get_descriptor()
        self.assertIn("CC-BY-NC", desc.license)

    def test_translation_settings_two_modes(self) -> None:
        from subtitle_localizer.service.pipeline_settings import TranslationSettings
        settings = TranslationSettings(
            provider="local",
            local_model="qwen2.5:7b-instruct",
            local_endpoint="http://localhost:11434",
        )
        self.assertEqual(settings.provider, "local")
        self.assertEqual(settings.local_model, "qwen2.5:7b-instruct")
        self.assertEqual(settings.local_endpoint, "http://localhost:11434")

    def test_local_default_and_batch_limit_match_benchmark_profile(self) -> None:
        from subtitle_localizer.service.pipeline_settings import TranslationSettings
        from subtitle_localizer.translation.real import RealTranslationProvider

        self.assertEqual(TranslationSettings().local_model, "qwen3:14b")
        provider = RealTranslationProvider()
        self.assertEqual(provider._local_chunk_size(140, 35), 35)
        # batch_size = 0 -> một request cho cả kịch bản (trong ngân sách ngữ cảnh).
        self.assertEqual(provider._local_chunk_size(140, 0), 140)

    def test_local_one_shot_budget_keeps_prompt_inside_context(self) -> None:
        from subtitle_localizer.translation.real import (
            _LOCAL_ONE_SHOT_SOURCE_CHARS,
            RealTranslationProvider,
        )

        provider = RealTranslationProvider()
        short_script = [
            SubtitleCueV1(cue_id=f"c{i}", start_pts=float(i), end_pts=float(i + 1), source_text="你好")
            for i in range(140)
        ]
        self.assertEqual(provider._one_shot_cue_limit(short_script, list(range(140))), 140)

        long_script = [
            SubtitleCueV1(
                cue_id=f"L{i}",
                start_pts=float(i),
                end_pts=float(i + 1),
                source_text="这是一个非常长的中文字幕句子，用来验证上下文预算。" * 2,
            )
            for i in range(400)
        ]
        limit = provider._one_shot_cue_limit(long_script, list(range(400)))
        self.assertGreater(limit, 0)
        self.assertLess(limit, 400)
        used = sum(len(long_script[i].source_text) + 12 for i in range(limit))
        self.assertLessEqual(used, _LOCAL_ONE_SHOT_SOURCE_CHARS)

    def test_local_translation_sends_one_request_for_zero_batch_size(self) -> None:
        import json
        from unittest.mock import MagicMock, patch

        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(
                cue_id=f"c{i}", start_pts=float(i), end_pts=float(i + 1), source_text=f"中文{i}"
            )
            for i in range(40)
        ]
        response = MagicMock()
        response.status = 200
        response.read.return_value = json.dumps({
            "choices": [{"message": {"content": "\n".join(f"[{i + 1}] Bản dịch {i}" for i in range(40))}}]
        }).encode("utf-8")
        response.__enter__.return_value = response

        with patch("urllib.request.urlopen", return_value=response) as urlopen:
            result = provider._translate_with_local_qwen(
                cues, "zh", "vi", model="qwen3:14b", endpoint="http://localhost:11434", batch_size=0
            )

        self.assertTrue(result)
        self.assertEqual(urlopen.call_count, 1)
        self.assertTrue(all(cue.translated_text for cue in cues))

    def test_real_translation_local_qwen_parse(self) -> None:
        from subtitle_localizer.translation.real import RealTranslationProvider
        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="你好"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="打车"),
        ]
        # Test parsing format [0] Xin chào, [1] Gọi xe
        sample_response = "[0] Xin chào\n[1] Gọi xe"
        provider._apply_model_response(cues, [0, 1], sample_response)
        self.assertEqual(cues[0].translated_text, "Xin chào")
        self.assertEqual(cues[1].translated_text, "Gọi xe")

    def test_translation_settings_auto_fallback(self) -> None:
        from subtitle_localizer.service.pipeline_settings import TranslationSettings
        settings = TranslationSettings(
            provider="local",
            auto_fallback=True,
        )
        self.assertTrue(settings.auto_fallback)
        self.assertEqual(settings.provider, "local")

    def test_registry_respects_gemini_setting(self) -> None:
        from subtitle_localizer.service.pipeline_settings import GlobalPipelineSettings, TranslationSettings, set_global_pipeline_settings
        from subtitle_localizer.translation.real import RealTranslationProvider
        try:
            settings = GlobalPipelineSettings(translation=TranslationSettings(provider="gemini"))
            set_global_pipeline_settings(settings)
            provider = TranslationRegistry().get_provider_for_pair("zh", "vi")
            self.assertIsInstance(provider, RealTranslationProvider)
        finally:
            set_global_pipeline_settings(GlobalPipelineSettings())

    def test_real_provider_does_not_force_local_in_pytest(self) -> None:
        from unittest.mock import patch
        import os
        from subtitle_localizer.service.pipeline_settings import GlobalPipelineSettings, TranslationSettings, set_global_pipeline_settings
        provider = __import__("subtitle_localizer.translation.real", fromlist=["RealTranslationProvider"]).RealTranslationProvider()
        cues = [SubtitleCueV1(cue_id="c1", start_pts=0, end_pts=1, source_text="你好")]
        settings = GlobalPipelineSettings(translation=TranslationSettings(provider="gemini", auto_fallback=False))
        try:
            set_global_pipeline_settings(settings)
            with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}), patch.object(provider, "_translate_with_gemini", return_value=True) as gem, patch.object(provider, "_translate_with_local_qwen", return_value=False) as local:
                provider.translate_cues(cues)
            gem.assert_called_once()
            local.assert_not_called()
        finally:
            set_global_pipeline_settings(GlobalPipelineSettings())

    def test_extraction_and_pipeline_settings_defaults_api_priority(self) -> None:
        from subtitle_localizer.service.pipeline_settings import ExtractionSettings, TranslationSettings, GlobalPipelineSettings
        ext = ExtractionSettings()
        self.assertEqual(ext.mode, "local")
        self.assertEqual(ext.engine, "ppocrv5")
        self.assertEqual(ext.primary_backend, "ppocrv5")
        self.assertEqual(ext.recognition_batch_size, 16)
        self.assertTrue(ext.enable_nvdec_hwaccel)
        self.assertTrue(ext.enable_anti_noise_funnel)
        self.assertTrue(ext.enable_stroke_dhash_cache)
        self.assertTrue(ext.auto_fallback)

        trans = TranslationSettings()
        self.assertEqual(trans.provider, "gemini")
        self.assertEqual(trans.gemini_model, "gemini-3.8-flash")
        self.assertTrue(trans.auto_fallback)
        # 0 = một request cho toàn bộ kịch bản (không chia batch)
        self.assertEqual(trans.batch_size, 0)

        modern_trans = TranslationSettings(gemini_model="gemini-3.8-flash")
        self.assertEqual(modern_trans.gemini_model, "gemini-3.8-flash")
        alias_trans = TranslationSettings(gemini_model="3.8")
        self.assertEqual(alias_trans.gemini_model, "gemini-3.8-flash")

        global_s = GlobalPipelineSettings()
        self.assertEqual(global_s.ocr.mode, "local")
        self.assertEqual(global_s.translation.provider, "gemini")

    def test_apply_model_response_1based_and_0based_indexing(self) -> None:
        from subtitle_localizer.translation.real import RealTranslationProvider
        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="你好"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="再见"),
        ]
        # Test 1-based model response: [1] [Nam] Xin chào, [2] [Nữ] Tạm biệt
        resp_1based = "[1] [Nam] Xin chào\n[2] [Nữ] Tạm biệt"
        updated = provider._apply_model_response(cues, [0, 1], resp_1based)
        self.assertEqual(updated, 2)
        self.assertEqual(cues[0].translated_text, "Xin chào")
        self.assertEqual(cues[0].style.get("speaker"), "male")
        self.assertEqual(cues[1].translated_text, "Tạm biệt")
        self.assertEqual(cues[1].style.get("speaker"), "female")

        # Test 0-based model response: [0] [Nữ] Chào bạn, [1] [Nam] Hẹn gặp lại
        resp_0based = "[0] [Nữ] Chào bạn\n[1] [Nam] Hẹn gặp lại"
        updated2 = provider._apply_model_response(cues, [0, 1], resp_0based)
        self.assertEqual(updated2, 2)
        self.assertEqual(cues[0].translated_text, "Chào bạn")
        self.assertEqual(cues[0].style.get("speaker"), "female")
        self.assertEqual(cues[1].translated_text, "Hẹn gặp lại")
        self.assertEqual(cues[1].style.get("speaker"), "male")

    def test_strips_narrator_role_prefix_from_translated_text(self) -> None:
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="c4", start_pts=9.94, end_pts=11.48, source_text="有人跟大学"),
            SubtitleCueV1(
                cue_id="c5",
                start_pts=12.62,
                end_pts=15.78,
                source_text="影视君男人是从业多年的影视审核员",
            ),
        ]
        response = (
            "[0] (Tiếng người dẫn chuyện) Có người học theo người khác\n"
            "[1] [Nam] (Tiếng người dẫn chuyện) Anh ấy đã làm việc trong ngành kiểm duyệt phim ảnh nhiều năm"
        )
        updated = provider._apply_model_response(cues, [0, 1], response)
        self.assertEqual(updated, 2)
        self.assertEqual(cues[0].translated_text, "Có người học theo người khác")
        self.assertNotIn("dẫn chuyện", cues[0].translated_text.lower())
        self.assertEqual(
            cues[1].translated_text,
            "Anh ấy đã làm việc trong ngành kiểm duyệt phim ảnh nhiều năm",
        )
        self.assertEqual(cues[1].style.get("speaker"), "male")


if __name__ == "__main__":
    unittest.main()

