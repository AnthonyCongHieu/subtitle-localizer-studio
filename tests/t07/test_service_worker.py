import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.ocr.mock import MockOcrProvider
from subtitle_localizer.service.server import create_app
from subtitle_localizer.service.worker import BackgroundWorker
from subtitle_localizer.translation.mock import MockTranslationProvider


class ServiceAndWorkerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.temp_dir.name) / "service_test.db"
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

    def test_health_check_endpoint(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        res = client.get("/api/v1/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "healthy")

    def test_project_crud_api_flow(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        # 1. Tạo project mới
        payload = {
            "title": "Dự án FastAPI Test",
            "source_video_path": "E:/test.mp4",
            "source_language": "zh",
            "target_language": "vi",
        }
        res = client.post("/api/v1/projects", json=payload, headers=headers)
        self.assertEqual(res.status_code, 200)
        project_id = res.json()["project_id"]

        # 2. Lấy thông tin project
        res = client.get(f"/api/v1/projects/{project_id}", headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["title"], "Dự án FastAPI Test")

        # 3. Lưu cues cho project
        cues_payload = [
            {"cue_id": "c1", "start_pts": 1.0, "end_pts": 2.0, "source_text": "你好", "translated_text": "Xin chào"},
        ]
        res = client.put(f"/api/v1/projects/{project_id}/cues", json=cues_payload, headers=headers)
        self.assertEqual(res.status_code, 200)

        # 4. Lấy cues
        res = client.get(f"/api/v1/projects/{project_id}/cues", headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 1)

    def test_background_worker_executes_pipeline(self) -> None:
        video_path = Path(self.temp_dir.name) / "worker-input.mp4"
        video_path.write_bytes(b"test-only-video-placeholder")
        # Khởi tạo project trong DB
        manifest = ProjectManifestV1(
            project_id="worker-proj-1",
            title="Dự án Worker Test",
            source_video_path=str(video_path),
            video_fingerprint="fp_worker",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(manifest)

        # Chạy pipeline bằng worker
        worker = BackgroundWorker(self.repo)
        worker.ocr_registry.register("rapidocr", MockOcrProvider())
        worker.translation_registry.register("real", MockTranslationProvider())
        with patch.object(
            worker.sampler,
            "sample_video_frames",
            return_value=([b"crop"] * 3, [0.0, 0.5, 1.0]),
        ):
            success = worker.run_pipeline_synchronous("worker-proj-1")
        self.assertTrue(success)

        # Kiểm tra cues đã được sinh ra
        cues = self.repo.get_cues("worker-proj-1")
        self.assertTrue(len(cues) > 0)
        self.assertTrue(len(cues[0].translated_text) > 0)

    def test_auth_token_rejection_on_wrong_token(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        res = client.get("/api/v1/projects", headers={"Authorization": "Bearer wrong-token"})
        self.assertEqual(res.status_code, 403)

    def test_optimistic_revision_conflict_via_api(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        # Tạo project
        res = client.post("/api/v1/projects", json={"title": "P1", "source_video_path": "E:/v.mp4"}, headers=headers)
        p_id = res.json()["project_id"]

        # Gửi command với revision sai (ví dụ 99 khi hiện tại là 1)
        cmd_payload = {"expected_revision": 99, "command_type": "update_title", "payload": {"title": "New Title"}}
        res = client.post(f"/api/v1/projects/{p_id}/commands", json=cmd_payload, headers=headers)
        self.assertEqual(res.status_code, 409)

    def test_mp4_export_renders_to_outputs_and_returns_real_path(self) -> None:
        from fastapi.testclient import TestClient

        source_path = Path(self.temp_dir.name) / "source.mp4"
        source_path.write_bytes(b"video-placeholder")
        manifest = ProjectManifestV1(
            project_id="mp4-project",
            title="Phim thử nghiệm",
            source_video_path=str(source_path),
            video_fingerprint="fp_mp4",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(manifest)
        self.repo.save_cues(
            manifest.project_id,
            [
                SubtitleCueV1(
                    cue_id="cue-1",
                    start_pts=1.0,
                    end_pts=2.5,
                    source_text="你好",
                    translated_text="Xin chào",
                )
            ],
        )

        def render_test_video(*, output_video_path, **_kwargs):
            rendered = Path(output_video_path)
            rendered.parent.mkdir(parents=True, exist_ok=True)
            rendered.write_bytes(b"rendered-mp4")
            return rendered

        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}
        with patch(
            "subtitle_localizer.render.export.VideoExporter.render_video",
            side_effect=render_test_video,
        ):
            response = client.post(
                "/api/v1/projects/mp4-project/export/mp4",
                json={"use_translated": True, "mask_mode": "box"},
                headers=headers,
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        output_path = Path(payload["output_path"])
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(output_path.parent, self.output_root / "mp4-project")
        self.assertEqual(output_path.name, "source-localized.mp4")
        self.assertEqual(output_path.read_bytes(), b"rendered-mp4")

    def test_mp4_export_reports_ass_generation_failure(self) -> None:
        from fastapi.testclient import TestClient

        source_path = Path(self.temp_dir.name) / "broken-export.mp4"
        source_path.write_bytes(b"video-placeholder")
        self.repo.save_project(
            ProjectManifestV1(
                project_id="broken-mp4-project",
                title="Broken export",
                source_video_path=str(source_path),
                video_fingerprint="fp_broken_mp4",
                source_language="zh",
            )
        )
        client = TestClient(self.app, raise_server_exceptions=False)
        with patch(
            "subtitle_localizer.render.ass.AssExporter.export_ass_text",
            side_effect=RuntimeError("ASS generation exploded"),
        ):
            response = client.post(
                "/api/v1/projects/broken-mp4-project/export/mp4",
                json={"use_translated": True, "mask_mode": "none"},
                headers={"Authorization": "Bearer test-token-123"},
            )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json()["detail"],
            "MP4 export failed: ASS generation exploded",
        )

    def test_pipeline_run_api_and_stages_endpoint(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        video_path = Path(self.temp_dir.name) / "run-input.mp4"
        video_path.write_bytes(b"test-video")
        self.repo.save_project(
            ProjectManifestV1(
                project_id="run-proj-1",
                title="Run Test",
                source_video_path=str(video_path),
                video_fingerprint="fp_run",
                source_language="zh",
                target_language="vi",
            )
        )

        with patch(
            "subtitle_localizer.service.worker.BackgroundWorker.run_pipeline_synchronous",
            return_value=True,
        ):
            # Test async call
            res_async = client.post(
                "/api/v1/projects/run-proj-1/pipeline/run",
                json={"max_duration_seconds": 180.0},
                headers=headers,
            )
            self.assertEqual(res_async.status_code, 200)
            self.assertEqual(res_async.json()["status"], "running")

            # Test sync call
            res_sync = client.post(
                "/api/v1/projects/run-proj-1/pipeline/run",
                json={"sync": True},
                headers=headers,
            )
            self.assertEqual(res_sync.status_code, 200)
            self.assertEqual(res_sync.json()["status"], "success")

        # Test stages endpoint
        res_stages = client.get("/api/v1/projects/run-proj-1/stages", headers=headers)
        self.assertEqual(res_stages.status_code, 200)
        stages = res_stages.json()
        self.assertIsInstance(stages, list)
        self.assertGreaterEqual(len(stages), 1)
        self.assertEqual(stages[0]["stage_name"], "detector")

    def test_rapid_ocr_deduplication_skips_identical_subtitle_boxes(self) -> None:
        import numpy as np
        from subtitle_localizer.ocr.rapid import RapidOcrProvider
        from subtitle_localizer.domain.models import OcrObservationV1

        provider = RapidOcrProvider()
        img1 = np.full((100, 200, 3), 50, dtype=np.uint8)
        img2 = np.full((100, 200, 3), 60, dtype=np.uint8)
        img1[20:50, 20:80] = 230
        img2[20:50, 20:80] = 230

        obs = OcrObservationV1(
            pts=1.0,
            boxes=[[20.0, 20.0, 80.0, 50.0]],
            raw_text="测试",
            normalized_text="测试",
            confidence=0.95,
        )

        is_dup = provider._is_duplicate_subtitle(obs, img1, img2, diff_threshold=1.5)
        self.assertTrue(is_dup)

        img3 = img1.copy()
        img3[20:50, 20:80] = 50
        is_dup_removed = provider._is_duplicate_subtitle(obs, img1, img3, diff_threshold=1.5)
        self.assertFalse(is_dup_removed)


if __name__ == "__main__":
    unittest.main()
