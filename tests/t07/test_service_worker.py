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
        self.app = create_app(database=self.db, repo=self.repo, auth_token="test-token-123")

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


if __name__ == "__main__":
    unittest.main()
