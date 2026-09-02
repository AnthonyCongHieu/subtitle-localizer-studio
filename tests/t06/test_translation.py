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


if __name__ == "__main__":
    unittest.main()
