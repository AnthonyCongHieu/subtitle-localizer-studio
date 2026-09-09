import sys
import unittest
from pathlib import Path
import numpy as np

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.detector.sampler import AdaptiveFrameSampler, detect_scene_cut
from subtitle_localizer.ocr.base import OcrProvider
from subtitle_localizer.ocr.mock import MockOcrProvider


class StreamPipelineTest(unittest.TestCase):
    def test_detect_scene_cut_identical_frames(self) -> None:
        """Frame giong het nhau khong phai la chuyen canh."""
        f1 = np.ones((100, 100, 3), dtype=np.uint8) * 100
        f2 = np.ones((100, 100, 3), dtype=np.uint8) * 100
        is_cut, hist1 = detect_scene_cut(None, f1)
        self.assertFalse(is_cut)
        is_cut2, hist2 = detect_scene_cut(hist1, f2)
        self.assertFalse(is_cut2)

    def test_detect_scene_cut_drastic_change(self) -> None:
        """Thay doi dot ngot giua frame sang va toi la chuyen canh."""
        dark = np.zeros((100, 100, 3), dtype=np.uint8)
        bright = np.ones((100, 100, 3), dtype=np.uint8) * 255
        _, hist_dark = detect_scene_cut(None, dark)
        is_cut, _ = detect_scene_cut(hist_dark, bright, threshold=0.65)
        self.assertTrue(is_cut)

    def test_recognize_stream_fallback_in_base_provider(self) -> None:
        """Base OcrProvider drains stream and dispatches to recognize."""
        mock = MockOcrProvider()
        mock.load()
        stream_data = [(np.zeros((30, 30, 3), dtype=np.uint8), 1.0), (np.zeros((30, 30, 3), dtype=np.uint8), 2.0)]
        obs = mock.recognize_stream(stream_data, language="zh")
        self.assertEqual(len(obs), 2)
        self.assertAlmostEqual(obs[0].pts, 1.0)
        self.assertAlmostEqual(obs[1].pts, 2.0)

    def test_stream_voice_windows_empty_video(self) -> None:
        """Video khong ton tai tra ve stream rong an toan khong treo."""
        sampler = AdaptiveFrameSampler()
        items = list(sampler.stream_voice_windows(
            video_path=Path("non_existent_video.mp4"),
            voice_windows=[(0.0, 1.0)],
        ))
        self.assertEqual(items, [])


    def test_rapid_ocr_recognize_stream(self) -> None:
        """RapidOcrProvider processes generator stream directly."""
        from subtitle_localizer.ocr.rapid import RapidOcrProvider
        class StubEngine:
            def __call__(self, img, use_det=True, use_cls=True):
                if not use_det:
                    return [("测试字幕", 0.95)], 0.01
                return [([0, 0, 10, 10], "测试字幕", 0.95)], 0.01


        provider = RapidOcrProvider()
        provider.is_loaded = True
        provider.engine = StubEngine()

        def frame_gen():
            for p in [1.0, 1.5, 2.0]:
                yield np.full((32, 64, 3), 200, dtype=np.uint8), p

        obs = provider.recognize_stream(frame_gen(), language="zh", total_estimated=3)
        self.assertGreaterEqual(len(obs), 1)
        self.assertEqual(obs[0].raw_text, "测试字幕")


if __name__ == "__main__":
    unittest.main()

