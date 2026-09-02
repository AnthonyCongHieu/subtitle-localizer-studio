import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import OcrObservationV1
from subtitle_localizer.ocr.base import OcrProvider
from subtitle_localizer.ocr.cache import OcrResultCache
from subtitle_localizer.ocr.mock import MockOcrProvider
from subtitle_localizer.ocr.preprocessing import enhance_text_contrast
from subtitle_localizer.ocr.registry import OcrRegistry


class OcrRuntimeTest(unittest.TestCase):
    def test_ocr_registry_and_provider_lookup(self) -> None:
        registry = OcrRegistry()
        mock_provider = MockOcrProvider()
        registry.register("mock", mock_provider)

        provider = registry.get_provider("mock")
        self.assertIsNotNone(provider)
        self.assertEqual(provider.get_descriptor().id, "mock-ocr")

        # Fallback provider theo language
        zh_provider = registry.get_provider_for_language("zh")
        self.assertIsNotNone(zh_provider)

    def test_mock_ocr_inference_multilingual(self) -> None:
        provider = MockOcrProvider()
        # Mock crop dữ liệu
        crops = [b"fake_image_crop_bytes_1", b"fake_image_crop_bytes_2"]
        results = provider.recognize(crops, pts_list=[1.5, 2.8], language="zh")
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0].pts, 1.5)
        self.assertTrue(len(results[0].raw_text) > 0)
        self.assertGreaterEqual(results[0].confidence, 0.9)

    def test_ocr_result_cache(self) -> None:
        cache = OcrResultCache()
        obs = OcrObservationV1(pts=1.0, raw_text="测试字幕", normalized_text="测试字幕", confidence=0.98)
        cache.put("frame_hash_123", obs)

        cached = cache.get("frame_hash_123")
        self.assertIsNotNone(cached)
        self.assertEqual(cached.raw_text, "测试字幕")
        self.assertIsNone(cache.get("non_existing_hash"))

    def test_preprocessing_contrast_enhancement(self) -> None:
        raw_pixels = b"\x10\x20\x30\x40\x50\x60"
        enhanced = enhance_text_contrast(raw_pixels, width=3, height=2)
        self.assertEqual(len(enhanced), len(raw_pixels))


if __name__ == "__main__":
    unittest.main()
