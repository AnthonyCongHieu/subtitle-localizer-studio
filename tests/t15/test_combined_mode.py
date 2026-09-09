import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.detector.sampler import AdaptiveFrameSampler, merge_voice_intervals
from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.ocr.mock import MockOcrProvider
from subtitle_localizer.translation.mock import MockTranslationProvider
from subtitle_localizer.service.pipeline_settings import ExtractionSettings, GlobalPipelineSettings
from subtitle_localizer.service.worker import BackgroundWorker


class CombinedModeAndSamplerTest(unittest.TestCase):
    def test_merge_voice_intervals_padding_and_merging(self) -> None:
        raw_intervals = [
            (1.0, 2.0),
            (2.5, 3.5),
            (10.0, 12.0),
        ]
        merged = merge_voice_intervals(raw_intervals, padding=0.4, merge_gap=0.8)
        self.assertEqual(len(merged), 2)
        self.assertAlmostEqual(merged[0][0], 0.6)
        self.assertAlmostEqual(merged[0][1], 3.9)
        self.assertAlmostEqual(merged[1][0], 9.6)
        self.assertAlmostEqual(merged[1][1], 12.4)

    def test_merge_voice_intervals_empty(self) -> None:
        self.assertEqual(merge_voice_intervals([]), [])

    def test_worker_mode_local_does_not_call_cloud_api(self) -> None:
        import tempfile
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            db = Database(Path(tmpdir) / "test.db")
            db.migrate()
            repo = ProjectRepository(db)

            video_path = Path(tmpdir) / "local_test.mp4"
            video_path.write_bytes(b"placeholder")

            manifest = ProjectManifestV1(
                project_id="p-local-test",
                title="Local Mode Test",
                source_video_path=str(video_path),
                video_fingerprint="fp_local",
                source_language="zh",
                target_language="vi",
                custom_pipeline_settings={
                    "ocr": {
                        "mode": "local",
                        "local_engine": "pure_ocr",
                    }
                }
            )
            repo.save_project(manifest)

            worker = BackgroundWorker(repo)
            worker.ocr_registry.register("rapidocr", MockOcrProvider())
            worker.translation_registry.register("real", MockTranslationProvider())

            with patch("subtitle_localizer.cloud.capcut_bridge.CapCutBridgeExtractor.extract_cues") as mock_capcut:
                with patch.object(
                    worker.sampler,
                    "sample_video_frames",
                    return_value=([b"crop"] * 2, [1.0, 2.0]),
                ):
                    success = worker.run_pipeline_synchronous("p-local-test", ocr_only=True)
                    self.assertTrue(success)
                    mock_capcut.assert_not_called()

            db.close()

    def test_worker_mode_api_runs_voice_gated_sampling(self) -> None:
        import tempfile
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            db = Database(Path(tmpdir) / "test_api.db")
            db.migrate()
            repo = ProjectRepository(db)

            video_path = Path(tmpdir) / "api_test.mp4"
            video_path.write_bytes(b"placeholder")

            manifest = ProjectManifestV1(
                project_id="p-api-test",
                title="API Mode Test",
                source_video_path=str(video_path),
                video_fingerprint="fp_api",
                source_language="zh",
                target_language="vi",
                custom_pipeline_settings={
                    "ocr": {
                        "mode": "api",
                        "api_provider": "capcut",
                        "api_fusion_mode": "hybrid_ocr",
                    }
                }
            )
            repo.save_project(manifest)

            worker = BackgroundWorker(repo)
            mock_ocr = MockOcrProvider()
            worker.ocr_registry.register("rapidocr", mock_ocr)

            fake_cloud_cues = [
                SubtitleCueV1(cue_id="c1", start_pts=1.0, end_pts=3.0, source_text="你好世界"),
            ]

            with patch("subtitle_localizer.cloud.capcut_bridge.CapCutBridgeExtractor.extract_cues", return_value=fake_cloud_cues):
                with patch.object(
                    worker.sampler,
                    "stream_voice_windows",
                    return_value=iter([(b"crop", 1.5), (b"crop", 2.5)]),
                ) as mock_voice_sample:
                    success = worker.run_pipeline_synchronous("p-api-test", ocr_only=True)
                    self.assertTrue(success)
                    mock_voice_sample.assert_called_once()

            db.close()

    def test_worker_mode_api_fallback_to_local_ocr_on_cloud_error(self) -> None:
        import tempfile
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            db = Database(Path(tmpdir) / "test_fb.db")
            db.migrate()
            repo = ProjectRepository(db)

            video_path = Path(tmpdir) / "fb_test.mp4"
            video_path.write_bytes(b"placeholder")

            manifest = ProjectManifestV1(
                project_id="p-fb-test",
                title="Fallback Mode Test",
                source_video_path=str(video_path),
                video_fingerprint="fp_fb",
                source_language="zh",
                target_language="vi",
                custom_pipeline_settings={
                    "ocr": {
                        "mode": "api",
                        "api_provider": "capcut",
                        "auto_fallback": True,
                    }
                }
            )
            repo.save_project(manifest)

            worker = BackgroundWorker(repo)
            worker.ocr_registry.register("rapidocr", MockOcrProvider())

            with patch("subtitle_localizer.cloud.capcut_bridge.CapCutBridgeExtractor.extract_cues", side_effect=RuntimeError("Network offline")):
                with patch.object(
                    worker.sampler,
                    "sample_video_frames",
                    return_value=([b"crop"] * 2, [1.0, 2.0]),
                ) as mock_full_sample:
                    success = worker.run_pipeline_synchronous("p-fb-test", ocr_only=True)
                    self.assertTrue(success)
                    mock_full_sample.assert_called_once()

            db.close()

    def test_worker_mode_api_streaming_error_preserves_cloud_cues(self) -> None:
        """Kiem tra khi streaming OCR gap loi, cloud_cues van duoc bao toan khong bi ghi de boi cues rong."""
        import tempfile
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            db = Database(Path(tmpdir) / "test_stream_err.db")
            db.migrate()
            repo = ProjectRepository(db)

            video_path = Path(tmpdir) / "err_test.mp4"
            video_path.write_bytes(b"placeholder")

            manifest = ProjectManifestV1(
                project_id="p-err-test",
                title="Streaming Error Test",
                source_video_path=str(video_path),
                video_fingerprint="fp_err",
                source_language="zh",
                target_language="vi",
                custom_pipeline_settings={
                    "ocr": {
                        "mode": "api",
                        "api_provider": "capcut",
                        "api_fusion_mode": "hybrid_ocr",
                    }
                }
            )
            repo.save_project(manifest)

            worker = BackgroundWorker(repo)
            worker.ocr_registry.register("rapidocr", MockOcrProvider())

            fake_cloud_cues = [
                SubtitleCueV1(cue_id="c_preserved", start_pts=1.0, end_pts=3.0, source_text="保留字幕"),
            ]

            with patch("subtitle_localizer.cloud.capcut_bridge.CapCutBridgeExtractor.extract_cues", return_value=fake_cloud_cues):
                with patch.object(
                    worker.sampler,
                    "stream_voice_windows",
                    side_effect=RuntimeError("Video decoder crashed"),
                ):
                    success = worker.run_pipeline_synchronous("p-err-test", ocr_only=True)
                    self.assertTrue(success)
                    saved_cues = repo.get_cues("p-err-test")
                    self.assertEqual(len(saved_cues), 1)
                    self.assertEqual(saved_cues[0].source_text, "保留字幕")

            db.close()


if __name__ == "__main__":
    unittest.main()

