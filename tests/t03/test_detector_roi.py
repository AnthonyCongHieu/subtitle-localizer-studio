import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.detector.roi import propose_default_roi
from subtitle_localizer.detector.sampler import AdaptiveFrameSampler
from subtitle_localizer.detector.temporal import NativeTemporalDetector, SubtitleEvent
from subtitle_localizer.detector.videosubfinder import VideoSubFinderAdapter
from subtitle_localizer.domain.models import RegionTrackV1


class DetectorAndRoiTest(unittest.TestCase):
    def test_roi_proposal_portrait_and_landscape(self) -> None:
        # Video ngang 1920x1080
        roi_land = propose_default_roi(1920, 1080, is_portrait=False)
        self.assertTrue(roi_land.is_valid())
        self.assertEqual(roi_land.y, 0.78)
        self.assertEqual(roi_land.y + roi_land.height, 0.96)
        self.assertEqual(roi_land.width, 0.84)

        # Video dọc 1080x1920 (TikTok/Reels/Shorts)
        roi_port = propose_default_roi(1080, 1920, is_portrait=True)
        self.assertTrue(roi_port.is_valid())
        self.assertGreaterEqual(roi_port.y, 0.65)
        self.assertGreaterEqual(roi_port.height, 0.15)

    def test_adaptive_sampler_sample_selection(self) -> None:
        sampler = AdaptiveFrameSampler(sample_fps=2.0, min_interval_pts=0.3)
        timestamps = [0.0, 0.1, 0.2, 0.4, 0.5, 0.8, 1.0, 1.4, 2.0]
        sampled = sampler.filter_timestamps(timestamps)
        self.assertTrue(len(sampled) < len(timestamps))
        self.assertIn(0.0, sampled)
        self.assertIn(0.4, sampled)

    def test_native_temporal_detector_detects_cues_and_filters_watermark(self) -> None:
        detector = NativeTemporalDetector(min_duration_pts=0.4, max_watermark_ratio=0.85)

        # Mô phỏng frames (pts, has_text_in_roi, has_watermark_in_corner)
        # Giả lập 10s: watermark xuất hiện 100% thời gian, subtitle 1 xuất hiện từ 1.0s đến 3.5s, subtitle 2 từ 5.0s đến 7.2s
        frames_data = []
        for i in range(100):
            pts = round(i * 0.1, 2)
            has_sub1 = 1.0 <= pts <= 3.5
            has_sub2 = 5.0 <= pts <= 7.2
            boxes = []
            if has_sub1 or has_sub2:
                boxes.append([0.1, 0.8, 0.9, 0.95])  # Subtitle ROI box
            # Watermark box ở góc trên cùng
            boxes.append([0.02, 0.02, 0.15, 0.08])
            frames_data.append((pts, boxes))

        events = detector.detect_subtitle_intervals(frames_data, total_duration=10.0)
        self.assertEqual(len(events), 2)
        self.assertAlmostEqual(events[0].start_pts, 1.0, delta=0.2)
        self.assertAlmostEqual(events[0].end_pts, 3.5, delta=0.2)
        self.assertAlmostEqual(events[1].start_pts, 5.0, delta=0.2)
        self.assertAlmostEqual(events[1].end_pts, 7.2, delta=0.2)

    def test_videosubfinder_adapter_mock_fallback(self) -> None:
        adapter = VideoSubFinderAdapter(cli_path=None)
        self.assertFalse(adapter.is_available())
        # Khi CLI không có, adapter fallback an toàn
        result = adapter.propose_regions("dummy.mp4")
        self.assertTrue(len(result) >= 1)
        self.assertTrue(result[0].is_valid())


if __name__ == "__main__":
    unittest.main()
