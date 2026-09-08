import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import OcrObservationV1
from subtitle_localizer.ocr.rapid import _is_valid_language_text
from subtitle_localizer.reconstruction.builder import CueReconstructor


class OcrNoiseFilteringTest(unittest.TestCase):
    def test_single_letter_and_symbol_noise_rejected_for_chinese(self) -> None:
        noise_samples = ["y", "p", "1", "T", "C", "(", ")", "I", "-", "\"", "…", "  y  "]
        for sample in noise_samples:
            self.assertFalse(
                _is_valid_language_text(sample, language="zh"),
                f"Ký tự rác '{sample}' không được phép vượt qua bộ lọc ngôn ngữ tiếng Trung",
            )

    def test_valid_chinese_text_accepted(self) -> None:
        valid_samples = ["你好", "离婚", "为什么这样", "是", "好", "我不明白"]
        for sample in valid_samples:
            self.assertTrue(
                _is_valid_language_text(sample, language="zh"),
                f"Câu tiếng Trung hợp lệ '{sample}' phải được chấp nhận",
            )

    def test_cue_reconstructor_filters_solitary_noise_cues(self) -> None:
        reconstructor = CueReconstructor()
        observations = [
            OcrObservationV1(pts=0.0, raw_text="Ly hôn", confidence=0.95),
            OcrObservationV1(pts=1.0, raw_text="y", confidence=0.80),
            OcrObservationV1(pts=2.0, raw_text="p", confidence=0.75),
            OcrObservationV1(pts=3.0, raw_text="1", confidence=0.70),
            OcrObservationV1(pts=4.0, raw_text="你好", confidence=0.92),
        ]
        cues = reconstructor.build_cues(observations)
        texts = [c.source_text for c in cues]

        self.assertIn("Ly hôn", texts)
        self.assertIn("你好", texts)
        self.assertNotIn("y", texts)
        self.assertNotIn("p", texts)
        self.assertNotIn("1", texts)

    def test_tap10_trash_sub_patterns_rejected(self) -> None:
        trash_samples = ["C", "CC", "D", "Y", "d", "cc", "CCC", "YY", "h."]
        for sample in trash_samples:
            self.assertFalse(
                _is_valid_language_text(sample, language="auto"),
                f"Sub rác Tap 10 '{sample}' phải bị loại bỏ ngay cả khi language='auto'",
            )

        reconstructor = CueReconstructor()
        observations = [
            OcrObservationV1(pts=0.0, raw_text="C", confidence=0.90),
            OcrObservationV1(pts=0.4, raw_text="CC", confidence=0.90),
            OcrObservationV1(pts=0.8, raw_text="D", confidence=0.90),
            OcrObservationV1(pts=1.2, raw_text="Y", confidence=0.90),
            OcrObservationV1(pts=1.6, raw_text="d", confidence=0.90),
            OcrObservationV1(pts=2.0, raw_text="你老婆睡了我老公", confidence=0.95),
        ]
        cues = reconstructor.build_cues(observations)
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].source_text, "你老婆睡了我老公")


if __name__ == "__main__":
    unittest.main()
