import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import OcrObservationV1, SubtitleCueV1
from subtitle_localizer.reconstruction.builder import CueReconstructor


class CueReconstructionTest(unittest.TestCase):
    def test_reconstruct_single_cue_from_observations(self) -> None:
        reconstructor = CueReconstructor(min_cue_duration=0.3, max_merge_gap=0.4)
        observations = [
            OcrObservationV1(pts=1.0, raw_text="测试字幕内容", confidence=0.95),
            OcrObservationV1(pts=1.2, raw_text="测试字幕内容", confidence=0.98),
            OcrObservationV1(pts=1.5, raw_text="测试字幕内容", confidence=0.97),
            OcrObservationV1(pts=1.8, raw_text="测试字幕内容", confidence=0.94),
        ]
        cues = reconstructor.build_cues(observations)
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].source_text, "测试字幕内容")
        self.assertEqual(cues[0].start_pts, 1.0)
        self.assertEqual(cues[0].end_pts, 1.8)

    def test_two_line_reading_order_and_sorting(self) -> None:
        reconstructor = CueReconstructor(min_cue_duration=0.3)
        # Hai observation cùng thời điểm nhưng tọa độ Y khác nhau (dòng trên y=0.75, dòng dưới y=0.85) xuất hiện từ 2.0 đến 3.0
        observations = [
            OcrObservationV1(pts=2.0, boxes=[[0.1, 0.85, 0.9, 0.92]], raw_text="Dòng dưới", confidence=0.95),
            OcrObservationV1(pts=2.0, boxes=[[0.1, 0.75, 0.9, 0.82]], raw_text="Dòng trên", confidence=0.95),
            OcrObservationV1(pts=3.0, boxes=[[0.1, 0.85, 0.9, 0.92]], raw_text="Dòng dưới", confidence=0.95),
            OcrObservationV1(pts=3.0, boxes=[[0.1, 0.75, 0.9, 0.82]], raw_text="Dòng trên", confidence=0.95),
        ]
        cues = reconstructor.build_cues(observations)
        self.assertEqual(len(cues), 1)
        # Kiểm tra thứ tự dòng trên trước, dòng dưới sau
        self.assertEqual(cues[0].source_text, "Dòng trên\nDòng dưới")

    def test_flicker_filtering_and_quality_flags(self) -> None:
        reconstructor = CueReconstructor(min_cue_duration=0.25)
        # Cue 1: dài 0.1s (flicker) -> phải bị lọc bỏ
        # Cue 2: dài 1.0s, confidence 0.45 -> phải có flag 'low_confidence'
        observations = [
            OcrObservationV1(pts=0.5, raw_text="Rác chớp tắt", confidence=0.9),
            OcrObservationV1(pts=0.55, raw_text="Rác chớp tắt", confidence=0.9),
            OcrObservationV1(pts=3.0, raw_text="Phụ đề mờ", confidence=0.45),
            OcrObservationV1(pts=4.0, raw_text="Phụ đề mờ", confidence=0.45),
        ]
        cues = reconstructor.build_cues(observations)
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].source_text, "Phụ đề mờ")
        self.assertIn("low_confidence", cues[0].quality_flags)

    def test_multiline_flag_assignment(self) -> None:
        reconstructor = CueReconstructor(min_cue_duration=0.3)
        observations = [
            OcrObservationV1(pts=1.0, boxes=[[0.1, 0.7, 0.9, 0.8]], raw_text="Line 1"),
            OcrObservationV1(pts=1.0, boxes=[[0.1, 0.8, 0.9, 0.9]], raw_text="Line 2"),
            OcrObservationV1(pts=2.0, boxes=[[0.1, 0.7, 0.9, 0.8]], raw_text="Line 1"),
            OcrObservationV1(pts=2.0, boxes=[[0.1, 0.8, 0.9, 0.9]], raw_text="Line 2"),
        ]
        cues = reconstructor.build_cues(observations)
        self.assertEqual(len(cues), 1)
        self.assertIn("multiline", cues[0].quality_flags)


if __name__ == "__main__":
    unittest.main()
