import json
import sys
import tempfile
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1, StageRunV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.server import create_app


class PipelineCancelAndDedupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.temp_dir.name) / "test_cancel.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.output_root = Path(self.temp_dir.name) / "outputs"
        self.app = create_app(
            database=self.db,
            repo=self.repo,
            auth_token="test-token-cancel",
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

    def test_stop_pipeline_clears_stale_running_stages(self) -> None:
        from fastapi.testclient import TestClient

        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-cancel"}

        proj_id = "proj-cancel-test-1"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="Cancel Test",
            source_video_path="E:/dummy.mp4",
            video_fingerprint="fp-cancel",
            source_language="zh",
        )
        self.repo.save_project(proj)

        # Giả lập stage đang chạy trước đó
        st_running = StageRunV1(
            stage_name="detector",
            status="running",
            progress=0.15,
            metrics={"label": "Đang chạy detector..."},
        )
        self.repo.save_stage_run(proj_id, st_running)

        stages_before = self.repo.get_stage_runs(proj_id)
        self.assertEqual(len(stages_before), 1)
        self.assertEqual(stages_before[0].status, "running")

        # Gọi stop pipeline
        res = client.post(f"/api/v1/projects/{proj_id}/pipeline/stop", headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "cancelled")

        # Kiểm tra: clear_stage_runs đã xóa stage running cũ, chỉ còn DUY NHẤT stage cancelled
        stages_after = self.repo.get_stage_runs(proj_id)
        self.assertEqual(len(stages_after), 1)
        self.assertEqual(stages_after[0].stage_name, "cancelled")
        self.assertEqual(stages_after[0].status, "cancelled")

    def test_frontend_cancel_dedup_and_f5_contracts(self) -> None:
        app_file = REPOSITORY_ROOT / "web" / "src" / "App.tsx"
        self.assertTrue(app_file.exists())
        app_content = app_file.read_text(encoding="utf-8")

        # Cờ cancelRequestedRef phải tồn tại
        self.assertIn("cancelRequestedRef", app_content)

        # Phải kiểm tra latest.status === 'running' thay vì stages.find(running)
        self.assertIn("latest.status === 'running'", app_content)

        # WebSocket handler phải chặn toast trùng khi cancelRequestedRef.current
        self.assertIn("!cancelRequestedRef.current", app_content)

    def test_worker_guards_running_stages_against_cancel(self) -> None:
        worker_file = REPOSITORY_ROOT / "src" / "subtitle_localizer" / "service" / "worker.py"
        self.assertTrue(worker_file.exists())
        worker_content = worker_file.read_text(encoding="utf-8")

        # Kiểm tra guard is_cancelled trước các save_stage_run
        self.assertIn("if not self.is_cancelled(project_id):", worker_content)

    def test_server_records_failed_stage_on_worker_exception(self) -> None:
        import time
        from unittest.mock import MagicMock
        from fastapi.testclient import TestClient
        from subtitle_localizer.service.worker import BackgroundWorker

        mock_worker = MagicMock(spec=BackgroundWorker)
        mock_worker.run_pipeline_synchronous.side_effect = RuntimeError("Simulated OCR engine failure")
        mock_worker.is_cancelled.return_value = False

        app = create_app(
            database=self.db,
            repo=self.repo,
            auth_token="test-token-cancel",
            output_root=self.output_root,
            worker=mock_worker,
        )
        client = TestClient(app)
        headers = {"Authorization": "Bearer test-token-cancel"}

        proj_id = "proj-fail-test"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="Fail Test",
            source_video_path="E:/dummy.mp4",
            video_fingerprint="fp-fail",
            source_language="zh",
        )
        self.repo.save_project(proj)

        # Khởi chạy pipeline
        run_res = client.post(f"/api/v1/projects/{proj_id}/pipeline/run", headers=headers)
        self.assertEqual(run_res.status_code, 200)

        # Chờ background thread hoàn thành ghi nhận exception
        time.sleep(0.3)

        # Kiểm tra API /stages trả về stage failed
        stages_res = client.get(f"/api/v1/projects/{proj_id}/stages", headers=headers)
        self.assertEqual(stages_res.status_code, 200)
        stages_data = stages_res.json()
        self.assertTrue(len(stages_data) > 0)

        # Stage cuối cùng phải là failed, tuyệt đối không được kẹt running
        latest = stages_data[-1]
        self.assertEqual(latest["status"], "failed")
        self.assertTrue(any("Simulated OCR engine failure" in err for err in latest.get("errors", [])))

    def test_reveal_export_guards_explorer_in_tests(self) -> None:
        from fastapi.testclient import TestClient

        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-cancel"}

        proj_id = "proj-reveal-test"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="Reveal Test",
            source_video_path="E:/dummy.mp4",
            video_fingerprint="fp-reveal",
            source_language="zh",
        )
        self.repo.save_project(proj)

        res = client.post(f"/api/v1/projects/{proj_id}/reveal-export", headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["success"])

    def test_frontend_progress_and_cancel_immediate_contracts(self) -> None:
        app_file = REPOSITORY_ROOT / "web" / "src" / "App.tsx"
        self.assertTrue(app_file.exists())
        app_content = app_file.read_text(encoding="utf-8")

        # handleStopScan phải gọi setIsScanning(false) ngay lập tức
        stop_scan_idx = app_content.find("const handleStopScan = async () => {")
        self.assertGreater(stop_scan_idx, -1)
        sub_stop = app_content[stop_scan_idx:stop_scan_idx + 120]
        self.assertIn("setIsScanning(false);", sub_stop)

        # App.tsx phải truyền statusMessage cho LeftMediaSidebar và RightInspectorPanel
        self.assertIn("<LeftMediaSidebar", app_content)
        self.assertIn("statusMessage={statusMessage}", app_content)

        # StudioHeader phải hiển thị dynamic statusMessage thay vì static "Đang Quét..."
        header_file = REPOSITORY_ROOT / "web" / "src" / "components" / "layout" / "StudioHeader.tsx"
        header_content = header_file.read_text(encoding="utf-8")
        self.assertIn("{statusMessage ||", header_content)

        # LeftMediaSidebar phải hỗ trợ trạng thái quét khi cues rỗng
        sidebar_file = REPOSITORY_ROOT / "web" / "src" / "components" / "sidebar" / "LeftMediaSidebar.tsx"
        sidebar_content = sidebar_file.read_text(encoding="utf-8")
        self.assertIn("isScanning ? (", sidebar_content)
        self.assertIn("animate-spin", sidebar_content)


if __name__ == "__main__":
    unittest.main()

