import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1, RegionTrackV1, SubtitleCueV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.server import create_app
from subtitle_localizer.service.worker import BackgroundWorker
from subtitle_localizer.service.pipeline_settings import GlobalPipelineSettings, merge_pipeline_settings


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

    def test_ocr_advanced_preprocessing_is_opt_in(self) -> None:
        base = GlobalPipelineSettings()
        self.assertEqual(base.ocr.performance_profile, "full_speed_quality")
        self.assertFalse(base.ocr.include_advanced_preprocessing)
        merged = merge_pipeline_settings(
            base, {"ocr": {"include_advanced_preprocessing": True}}
        )
        self.assertTrue(merged.ocr.include_advanced_preprocessing)

    def test_ocr_maximum_recall_profile_enables_advanced_preprocessing(self) -> None:
        base = GlobalPipelineSettings()
        merged = merge_pipeline_settings(
            base, {"ocr": {"performance_profile": "maximum_recall"}}
        )
        self.assertEqual(merged.ocr.performance_profile, "maximum_recall")

    def test_merge_pipeline_settings_ducking_volume(self) -> None:
        from subtitle_localizer.service.pipeline_settings import merge_pipeline_settings, GlobalPipelineSettings
        base = GlobalPipelineSettings()
        self.assertEqual(base.dubbing.ducking_volume, 0.25)

        overrides = {
            "dubbing": {"ducking_volume": 0.15, "voice": "vi-VN-NamAnNeural"},
        }
        merged = merge_pipeline_settings(base, overrides)
        self.assertEqual(merged.dubbing.ducking_volume, 0.15)
        self.assertEqual(merged.dubbing.voice, "vi-VN-NamAnNeural")

    def test_merge_pipeline_settings_dubbing_enabled_and_batch(self) -> None:
        from subtitle_localizer.service.pipeline_settings import merge_pipeline_settings, GlobalPipelineSettings
        base = GlobalPipelineSettings()
        self.assertTrue(base.dubbing.enabled)
        self.assertTrue(base.batch.dubbing_enabled)

        overrides = {
            "dubbing": {"enabled": False},
            "batch": {"dubbing_enabled": False, "target_lang": "en", "ducking_volume": 10},
        }
        merged = merge_pipeline_settings(base, overrides)
        self.assertFalse(merged.dubbing.enabled)
        self.assertFalse(merged.batch.dubbing_enabled)
        self.assertEqual(merged.batch.target_lang, "en")
        self.assertEqual(merged.batch.ducking_volume, 10)

    def test_export_mp4_dynamic_ducking_volume_applied(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        video_path = Path(self.temp_dir.name) / "sample_export.mp4"
        video_path.write_bytes(b"\x00" * 1024)

        proj_id = "proj-ducking-test"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="Ducking Test",
            source_video_path=str(video_path),
            video_fingerprint="fp-duck",
            source_language="zh",
            custom_pipeline_settings={
                "dubbing": {"ducking_volume": 0.10},
            },
        )
        self.repo.save_project(proj)

        # Create dummy voiceover file in project output
        proj_out = self.output_root / proj_id
        proj_out.mkdir(parents=True, exist_ok=True)
        vo_file = proj_out / f"voiceover_{proj_id}.mp3"
        vo_file.write_bytes(b"FAKE_MP3_DATA")

        with patch("cv2.VideoCapture") as mock_vc, \
             patch("subtitle_localizer.render.export.VideoExporter.render_video") as mock_render, \
             patch("subtitle_localizer.dubbing.tts.mix_voiceover_into_video") as mock_mix:

            mock_cap = MagicMock()
            mock_cap.get.side_effect = lambda prop: 1920 if prop == 3 else (1080 if prop == 4 else 0)
            mock_vc.return_value = mock_cap

            rendered_dummy = proj_out / "rendered.mp4"
            rendered_dummy.write_bytes(b"DUMMY_MP4")
            mock_render.return_value = rendered_dummy

            res = client.post(f"/api/v1/projects/{proj_id}/export/mp4", headers=headers, json={})
            self.assertEqual(res.status_code, 200)
            self.assertTrue(mock_mix.called)
            # Check ducking_volume passed was 0.10 from custom_pipeline_settings
            _, kwargs = mock_mix.call_args
            self.assertEqual(kwargs.get("ducking_volume"), 0.10)

    def test_api_stop_and_cancel_pipeline(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        proj_id = "proj-stop-test"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="Stop Test",
            source_video_path="E:/dummy.mp4",
            video_fingerprint="fp-stop",
            source_language="zh",
        )
        self.repo.save_project(proj)

        # 1. Stop non-existent project -> 404
        bad_res = client.post("/api/v1/projects/non-existent-proj/pipeline/stop", headers=headers)
        self.assertEqual(bad_res.status_code, 404)

        # 2. Stop valid project -> 200 and sets cancelled
        res = client.post(f"/api/v1/projects/{proj_id}/pipeline/stop", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "cancelled")
        self.assertEqual(data["project_id"], proj_id)

        # Check stage recorded in repo
        stages = self.repo.get_stage_runs(proj_id)
        self.assertTrue(any(s.stage_name == "cancelled" and s.status == "cancelled" for s in stages))

        # 3. Test alias endpoint /cancel
        res_cancel = client.post(f"/api/v1/projects/{proj_id}/pipeline/cancel", headers=headers)
        self.assertEqual(res_cancel.status_code, 200)
        self.assertEqual(res_cancel.json()["status"], "cancelled")

    def test_batch_create_projects_and_pick_endpoints(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        # 1. Test batch create projects
        batch_req = {
            "items": [
                {
                    "title": "Batch Ep 01",
                    "source_video_path": "E:/videos/ep01.mp4",
                    "source_language": "zh",
                    "target_language": "vi",
                },
                {
                    "title": "Batch Ep 02",
                    "source_video_path": "E:/videos/ep02.mp4",
                    "source_language": "zh",
                    "target_language": "vi",
                },
            ],
            "regions": [
                {
                    "region_id": "roi-main",
                    "x": 0.08,
                    "y": 0.80,
                    "width": 0.84,
                    "height": 0.16,
                    "mask_enabled": True,
                }
            ],
        }

        res = client.post("/api/v1/projects/batch-create", headers=headers, json=batch_req)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]["title"], "Batch Ep 01")
        self.assertEqual(data[1]["title"], "Batch Ep 02")
        self.assertEqual(len(data[0]["regions"]), 1)
        self.assertEqual(data[0]["regions"][0]["y"], 0.80)

        # 2. Test pick-multiple-videos endpoint with mock
        with patch("subprocess.run") as mock_sub:
            mock_sub.return_value = MagicMock(
                stdout='["E:/videos/ep01.mp4", "E:/videos/ep02.mp4"]'
            )
            res_multi = client.post("/api/v1/system/pick-multiple-videos", headers=headers)
            self.assertEqual(res_multi.status_code, 200)
            multi_data = res_multi.json()
            self.assertEqual(len(multi_data.get("files", [])), 2)
            self.assertEqual(multi_data["files"][0]["filename"], "ep01.mp4")

        # 3. Test pick-folder endpoint with mock
        with patch("subprocess.run") as mock_sub:
            mock_sub.return_value = MagicMock(
                stdout='["E:/folder/ep01.mp4", "E:/folder/ep02.mp4", "E:/folder/ep03.mp4"]'
            )
            res_folder = client.post("/api/v1/system/pick-folder", headers=headers)
            self.assertEqual(res_folder.status_code, 200)
            folder_data = res_folder.json()
            self.assertEqual(len(folder_data.get("files", [])), 3)
            self.assertEqual(folder_data["files"][2]["filename"], "ep03.mp4")

    def test_voiceover_audio_stream_and_download(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        proj_id = "proj-vo-stream-test"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="VO Stream Test",
            source_video_path="E:/dummy_video.mp4",
            video_fingerprint="fp-vo-stream",
            source_language="zh",
        )
        self.repo.save_project(proj)

        # 404 when file does not exist
        res_404 = client.get(f"/api/v1/projects/{proj_id}/audio/voiceover", headers=headers)
        self.assertEqual(res_404.status_code, 404)

        # Create dummy voiceover MP3 file
        proj_out = self.output_root / proj_id
        proj_out.mkdir(parents=True, exist_ok=True)
        vo_file = proj_out / f"voiceover_{proj_id}.mp3"
        vo_file.write_bytes(b"MOCK_MP3_AUDIO_PAYLOAD")

        # Stream endpoint
        res_stream = client.get(f"/api/v1/projects/{proj_id}/audio/voiceover", headers=headers)
        self.assertEqual(res_stream.status_code, 200)
        self.assertEqual(res_stream.content, b"MOCK_MP3_AUDIO_PAYLOAD")
        self.assertIn("audio/mpeg", res_stream.headers.get("content-type", ""))

        # Download endpoint
        res_dl = client.get(f"/api/v1/projects/{proj_id}/audio/voiceover?download=true", headers=headers)
        self.assertEqual(res_dl.status_code, 200)
        self.assertIn("attachment", res_dl.headers.get("content-disposition", "").lower())

    def test_cue_audio_fallback_and_existing(self):
        """Kiểm tra phát audio câu lẻ cả khi có sẵn file hoặc khi fallback trích xuất từ master."""
        from fastapi.testclient import TestClient
        from subtitle_localizer.service.server import create_app
        app = create_app(database=self.db, repo=self.repo, auth_token="test-token", output_root=self.output_root)
        client = TestClient(app)
        headers = {"Authorization": "Bearer test-token"}

        proj_id = "proj-cue-audio-test"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="Cue Audio Test",
            source_video_path="E:/dummy.mp4",
            video_fingerprint="fp-cue-audio",
            source_language="zh",
        )
        self.repo.save_project(proj)
        cue = SubtitleCueV1(
            cue_id="cue_test_101",
            start_pts=1.0,
            end_pts=3.5,
            source_text="你好",
            translated_text="Xin chào",
        )
        self.repo.save_cues(proj_id, [cue])

        # 404 when neither cue file nor master voiceover exists
        res_404 = client.get(f"/api/v1/projects/{proj_id}/cues/cue_test_101/audio", headers=headers)
        self.assertEqual(res_404.status_code, 404)

        # When cue file exists directly
        cues_dir = self.output_root / proj_id / "cues"
        cues_dir.mkdir(parents=True, exist_ok=True)
        cue_file = cues_dir / "cue_test_101.mp3"
        cue_file.write_bytes(b"MOCK_CUE_MP3")

        res_direct = client.get(f"/api/v1/projects/{proj_id}/cues/cue_test_101/audio", headers=headers)
        self.assertEqual(res_direct.status_code, 200)
        self.assertEqual(res_direct.content, b"MOCK_CUE_MP3")




