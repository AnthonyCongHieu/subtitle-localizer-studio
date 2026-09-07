import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1, RegionTrackV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.server import create_app
from subtitle_localizer.service.worker import BackgroundWorker
from subtitle_localizer.service.pipeline_settings import GlobalPipelineSettings


class ProjectSettingsAndRoiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.temp_dir.name) / "settings_test.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.output_root = Path(self.temp_dir.name) / "outputs"
        self.app = create_app(
            database=self.db,
            repo=self.repo,
            auth_token="test-token-123",
            output_root=self.output_root,
        )

    def tearDown(self) -> None:
        self.db.close()
        import gc
        gc.collect()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_project_manifest_custom_pipeline_settings_serialization(self) -> None:
        proj = ProjectManifestV1(
            project_id="test-p1",
            title="Tập 1",
            source_video_path="E:/video.mp4",
            video_fingerprint="fp123",
            source_language="zh",
            custom_pipeline_settings={
                "ocr": {"engine": "paddle", "sample_fps": 3.0},
                "dubbing": {"voice": "vi-VN-HoaiMyNeural"},
            },
        )
        d = proj.to_dict()
        self.assertIn("custom_pipeline_settings", d)
        self.assertEqual(d["custom_pipeline_settings"]["ocr"]["engine"], "paddle")

        restored = ProjectManifestV1.from_dict(d)
        self.assertIsNotNone(restored.custom_pipeline_settings)
        self.assertEqual(restored.custom_pipeline_settings["dubbing"]["voice"], "vi-VN-HoaiMyNeural")

    def test_api_put_and_delete_project_settings(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        proj = ProjectManifestV1(
            project_id="proj-custom-setting-1",
            title="Tập 01",
            source_video_path="E:/dummy.mp4",
            video_fingerprint="fp01",
            source_language="zh",
        )
        self.repo.save_project(proj)

        custom_settings = {
            "ocr": {"engine": "rapidocr", "sample_fps": 4.0},
            "translation": {"prompt_tone": "humorous"},
        }

        # PUT settings
        put_res = client.put(
            "/api/v1/projects/proj-custom-setting-1/settings",
            headers=headers,
            json=custom_settings,
        )
        self.assertEqual(put_res.status_code, 200)
        saved_proj = self.repo.get_project("proj-custom-setting-1")
        self.assertIsNotNone(saved_proj.custom_pipeline_settings)
        self.assertEqual(saved_proj.custom_pipeline_settings["translation"]["prompt_tone"], "humorous")

        # DELETE settings (reset to global)
        del_res = client.delete(
            "/api/v1/projects/proj-custom-setting-1/settings",
            headers=headers,
        )
        self.assertEqual(del_res.status_code, 200)
        reset_proj = self.repo.get_project("proj-custom-setting-1")
        self.assertIsNone(reset_proj.custom_pipeline_settings)

    def test_custom_user_roi_not_overwritten_by_worker(self) -> None:
        # Create a dummy video file
        video_path = Path(self.temp_dir.name) / "sample.mp4"
        video_path.write_bytes(b"\x00" * 1024)

        custom_roi = RegionTrackV1(
            region_id="roi-user-custom",
            x=0.12,
            y=0.75,
            width=0.76,
            height=0.15,
        )
        proj = ProjectManifestV1(
            project_id="proj-roi-test",
            title="ROI Test",
            source_video_path=str(video_path),
            video_fingerprint="fp-roi",
            source_language="zh",
            regions=[custom_roi],
        )
        self.repo.save_project(proj)

        worker = BackgroundWorker(self.repo)

        with patch("cv2.VideoCapture") as mock_vc:
            mock_cap = MagicMock()
            mock_cap.get.side_effect = lambda prop: 1080 if prop == 3 else (1920 if prop == 4 else 0)
            mock_vc.return_value = mock_cap

            # Mock pipeline execution stages
            with patch("subtitle_localizer.service.worker.get_global_pipeline_settings") as mock_settings:
                settings = GlobalPipelineSettings()
                settings.ocr.mode = "local"
                settings.ocr.local_engine = "hybrid"
                mock_settings.return_value = settings

                with patch.object(worker.sampler, "sample_video_frames", return_value=([], [])):
                    worker.run_pipeline_synchronous("proj-roi-test")

        updated_proj = self.repo.get_project("proj-roi-test")
        self.assertEqual(len(updated_proj.regions), 1)
        self.assertEqual(updated_proj.regions[0].region_id, "roi-user-custom")
        self.assertEqual(updated_proj.regions[0].x, 0.12)
        self.assertEqual(updated_proj.regions[0].y, 0.75)

    def test_merge_pipeline_settings(self) -> None:
        from subtitle_localizer.service.pipeline_settings import merge_pipeline_settings
        base = GlobalPipelineSettings()
        base.ocr.engine = "rapidocr"
        base.translation.prompt_tone = "dramatic"

        overrides = {
            "ocr": {"engine": "paddle", "sample_fps": 5.0},
            "translation": {"prompt_tone": "humorous"},
        }
        merged = merge_pipeline_settings(base, overrides)
        self.assertEqual(merged.ocr.engine, "paddle")
        self.assertEqual(merged.ocr.sample_fps, 5.0)
        self.assertEqual(merged.translation.prompt_tone, "humorous")
        self.assertEqual(merged.translation.target_language, base.translation.target_language)
