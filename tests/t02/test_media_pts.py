import json
import sys
import tempfile
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.media.fingerprint import compute_video_fingerprint
from subtitle_localizer.media.preflight import check_disk_space, validate_source_read_only
from subtitle_localizer.media.probe import MediaProbeResult, probe_media
from subtitle_localizer.media.proxy import generate_proxy_video
from subtitle_localizer.media.pts import PtsTimelineMapper
from subtitle_localizer.media.waveform import extract_waveform_peaks


class MediaProbeAndPtsTest(unittest.TestCase):
    def test_probe_and_pts_mapping_on_synthetic_vfr(self) -> None:
        fixture_manifest = REPOSITORY_ROOT / "fixtures" / "synthetic" / "fixture_manifest.json"
        self.assertTrue(fixture_manifest.exists())
        data = json.loads(fixture_manifest.read_text(encoding="utf-8"))
        vfr_fixture = [f for f in data["fixtures"] if f["timing"] == "vfr"][0]

        # Test mock probe result
        probe_res = MediaProbeResult.from_ffprobe_json(vfr_fixture["ffprobe"])
        self.assertEqual(probe_res.width, 320)
        self.assertEqual(probe_res.height, 180)
        self.assertEqual(probe_res.duration, 5.0)
        self.assertTrue(probe_res.is_vfr)

        # Test PTS mapper
        pts_list = vfr_fixture["ffprobe"]["frame_pts_seconds"]
        mapper = PtsTimelineMapper(pts_list, is_vfr=True)
        self.assertEqual(mapper.get_frame_pts(0), 0.0)
        self.assertEqual(mapper.get_frame_pts(1), 0.7)
        self.assertEqual(mapper.get_frame_pts(5), 4.9)
        self.assertEqual(mapper.nearest_pts(1.75), 1.8)

    def test_video_fingerprint_determinism(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"\x00\x00\x00\x20ftypisom" + b"\x00" * 2048)
            tmp_path = Path(f.name)
        try:
            fp1 = compute_video_fingerprint(tmp_path)
            fp2 = compute_video_fingerprint(tmp_path)
            self.assertEqual(fp1, fp2)
            self.assertTrue(len(fp1) >= 32)
        finally:
            tmp_path.unlink(missing_ok=True)

    def test_source_read_only_and_preflight(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            source = Path(d) / "source_video.mp4"
            source.write_bytes(b"dummy video data")
            self.assertTrue(validate_source_read_only(source))
            self.assertTrue(check_disk_space(Path(d), required_bytes=1024))

    def test_waveform_extraction_format(self) -> None:
        # Mock waveform peaks extraction
        peaks = extract_waveform_peaks(duration=5.0, sample_rate=10)
        self.assertEqual(len(peaks), 50)
        self.assertTrue(all(0.0 <= p <= 1.0 for p in peaks))

    def test_proxy_generation_rejects_overwriting_source(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(b"data")
            p = Path(f.name)
        try:
            with self.assertRaises(ValueError):
                generate_proxy_video(p, p)
        finally:
            p.unlink(missing_ok=True)

    def test_pts_mapper_duration_and_frame_conversion(self) -> None:
        pts_list = [0.0, 0.5, 1.0, 2.5]
        mapper = PtsTimelineMapper(pts_list, is_vfr=True)
        self.assertEqual(mapper.total_frames(), 4)
        self.assertEqual(mapper.duration(), 2.5)
        self.assertEqual(mapper.pts_to_frame(0.52), 1)

    def test_canonicalize_path_unicode_and_spaces(self) -> None:
        from subtitle_localizer.media.preflight import canonicalize_path
        p = canonicalize_path("D:/Videos/Tiếng Việt & 中文 测试/sample 01.mp4")
        self.assertTrue(isinstance(p, Path))
        self.assertIn("Tiếng Việt", str(p))


if __name__ == "__main__":
    unittest.main()
