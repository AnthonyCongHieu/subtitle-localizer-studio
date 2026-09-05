"""
Opaque-box test suite for R4: Queue Scheduler Engine (Sequential Multi-Drama Download Queue).
Selected via: pytest tests/ -k queue

Covers:
- Tier 1: FIFO queue operations (add, list, pause, resume, delete, reorder).
- Tier 2: Boundary & edge cases (empty queue, duplicate add, reorder top/bottom limits,
          cancel active vs pending task, invalid task_id, corrupt payload).
- Tier 3: Cross-feature tests (auto-advance to next drama on completion,
          auto-advance on error/failure, device rotation between dramas,
          jitter delay application between queue tasks).
- Tier 4: Real-world 3-drama sequential queue workload.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, call, patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from fastapi.testclient import TestClient
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.downloader import DownloadManager
from subtitle_localizer.service.server import create_app

try:
    from subtitle_localizer.service.downloader import DownloadTask
except ImportError:
    DownloadTask = None


def make_sample_hongguo_target(series_id: str = "74123456789012345", title: str = "Chàng Rể Quyền Lực", total_eps: int = 3) -> Dict[str, Any]:
    return {
        "platform": "hongguo",
        "series_id": series_id,
        "title": title,
        "cover_url": f"https://p3.douyinpic.com/img/{series_id}.jpg",
        "total_episodes": total_eps,
        "accessible_count": total_eps,
        "intro": f"Mô tả phim {title}",
        "vid_count": total_eps,
    }


class TestDownloadQueueEngine(unittest.TestCase):
    """Tier 1 - Tier 4 test suite for Queue Scheduler Engine matching '-k queue'."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.temp_path = Path(self.temp_dir.name)
        self.db_path = self.temp_path / "queue_test.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.uploads_dir = self.temp_path / "uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.output_root = self.temp_path / "outputs"
        self.output_root.mkdir(parents=True, exist_ok=True)

        self.auth_token = "queue-test-token"
        self.app = create_app(
            database=self.db,
            repo=self.repo,
            auth_token=self.auth_token,
            output_root=self.output_root,
        )
        self.client = TestClient(self.app)
        self.headers = {"Authorization": f"Bearer {self.auth_token}"}

    def tearDown(self) -> None:
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    # =========================================================================
    # TIER 1: FIFO QUEUE OPERATIONS
    # =========================================================================

    def test_queue_add_task_fifo_order(self) -> None:
        """Tier 1: Verify adding multiple drama tasks places them in strict FIFO order."""
        t1 = make_sample_hongguo_target("series_001", "Phim Thứ Nhất", 2)
        t2 = make_sample_hongguo_target("series_002", "Phim Thứ Hai", 2)
        t3 = make_sample_hongguo_target("series_003", "Phim Thứ Ba", 2)

        res1 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": t1})
        self.assertEqual(res1.status_code, 200, f"Failed to add task 1: {res1.text}")
        data1 = res1.json()
        self.assertTrue(data1.get("success", False))
        task_id1 = data1.get("task_id")
        self.assertTrue(task_id1)
        self.assertEqual(data1.get("position", 1), 1)

        res2 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": t2})
        self.assertEqual(res2.status_code, 200, f"Failed to add task 2: {res2.text}")
        data2 = res2.json()
        task_id2 = data2.get("task_id")
        self.assertTrue(task_id2)
        self.assertEqual(data2.get("position", 2), 2)

        res3 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": t3})
        self.assertEqual(res3.status_code, 200, f"Failed to add task 3: {res3.text}")
        data3 = res3.json()
        task_id3 = data3.get("task_id")
        self.assertTrue(task_id3)
        self.assertEqual(data3.get("position", 3), 3)

        # Inspect queue list to verify FIFO sequence
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        self.assertEqual(list_res.status_code, 200)
        tasks = list_res.json().get("tasks", [])
        self.assertGreaterEqual(len(tasks), 3)
        task_ids = [t["task_id"] for t in tasks]
        self.assertEqual(task_ids[:3], [task_id1, task_id2, task_id3])

    def test_queue_list_endpoint_and_state(self) -> None:
        """Tier 1: Verify GET /api/v1/downloader/queue/list returns required schema and real-time fields."""
        t1 = make_sample_hongguo_target("series_list_01", "Kiểm Tra List Hàng Đợi", 5)
        add_res = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": t1})
        self.assertEqual(add_res.status_code, 200)

        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        self.assertEqual(list_res.status_code, 200)
        data = list_res.json()

        self.assertIn("tasks", data)
        self.assertIn("is_paused", data)
        self.assertIsInstance(data["tasks"], list)
        self.assertIsInstance(data["is_paused"], bool)

        task = data["tasks"][0]
        self.assertIn("task_id", task)
        self.assertIn("status", task)
        self.assertIn("target_info", task)
        self.assertIn("progress_percent", task)
        self.assertIn("speed_mbps", task)
        self.assertIn("message", task)
        self.assertIn("current_ep", task)
        self.assertIn("total_eps", task)

    def test_queue_pause_and_resume_scheduler(self) -> None:
        """Tier 1: Verify queue pause and resume toggles is_paused and halts/resumes dispatch."""
        pause_res = self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)
        self.assertEqual(pause_res.status_code, 200)
        p_data = pause_res.json()
        self.assertTrue(p_data.get("success", False))
        self.assertTrue(p_data.get("is_paused", False))

        # Check list confirms paused
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        self.assertTrue(list_res.json().get("is_paused"))

        # Resume queue
        resume_res = self.client.post("/api/v1/downloader/queue/resume", headers=self.headers)
        self.assertEqual(resume_res.status_code, 200)
        r_data = resume_res.json()
        self.assertTrue(r_data.get("success", False))
        self.assertFalse(r_data.get("is_paused", True))

        # Check list confirms unpaused
        list_res2 = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        self.assertFalse(list_res2.json().get("is_paused"))

    def test_queue_delete_pending_task(self) -> None:
        """Tier 1: Verify deleting a pending task removes it from the queue."""
        # Pause queue first so tasks remain pending
        self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)

        t1 = make_sample_hongguo_target("series_del_1", "Phim Giữ Lại", 2)
        t2 = make_sample_hongguo_target("series_del_2", "Phim Chuẩn Bị Xóa", 2)

        res1 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": t1})
        res2 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": t2})
        task_id2 = res2.json()["task_id"]

        # Delete task 2
        del_res = self.client.delete(f"/api/v1/downloader/queue/{task_id2}", headers=self.headers)
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json().get("success"))

        # List should not contain task_id2
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        ids = [t["task_id"] for t in list_res.json()["tasks"]]
        self.assertNotIn(task_id2, ids)

    def test_queue_reorder_up_down_top_bottom(self) -> None:
        """Tier 1: Verify reordering pending tasks via up, down, top, bottom."""
        # Pause queue so tasks remain in pending status
        self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)

        t1 = make_sample_hongguo_target("reorder_1", "Phim A", 2)
        t2 = make_sample_hongguo_target("reorder_2", "Phim B", 2)
        t3 = make_sample_hongguo_target("reorder_3", "Phim C", 2)

        id1 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": t1}).json()["task_id"]
        id2 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": t2}).json()["task_id"]
        id3 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": t3}).json()["task_id"]

        # Initial order: [id1, id2, id3]
        # Move id3 up -> should become [id1, id3, id2]
        res_up = self.client.post(
            "/api/v1/downloader/queue/reorder",
            headers=self.headers,
            json={"task_id": id3, "direction": "up"},
        )
        self.assertEqual(res_up.status_code, 200)
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        ids = [t["task_id"] for t in list_res.json()["tasks"]]
        self.assertEqual(ids[:3], [id1, id3, id2])

        # Move id3 top -> should become [id3, id1, id2]
        res_top = self.client.post(
            "/api/v1/downloader/queue/reorder",
            headers=self.headers,
            json={"task_id": id3, "direction": "top"},
        )
        self.assertEqual(res_top.status_code, 200)
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        ids = [t["task_id"] for t in list_res.json()["tasks"]]
        self.assertEqual(ids[:3], [id3, id1, id2])

        # Move id3 bottom -> should become [id1, id2, id3]
        res_bot = self.client.post(
            "/api/v1/downloader/queue/reorder",
            headers=self.headers,
            json={"task_id": id3, "direction": "bottom"},
        )
        self.assertEqual(res_bot.status_code, 200)
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        ids = [t["task_id"] for t in list_res.json()["tasks"]]
        self.assertEqual(ids[:3], [id1, id2, id3])

    # =========================================================================
    # TIER 2: BOUNDARY & EDGE CASES
    # =========================================================================

    def test_queue_empty_operations(self) -> None:
        """Tier 2: Verify queue operations on an empty queue do not raise 500 exceptions."""
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        self.assertEqual(list_res.status_code, 200)
        self.assertEqual(list_res.json().get("tasks"), [])

        pause_res = self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)
        self.assertEqual(pause_res.status_code, 200)

        resume_res = self.client.post("/api/v1/downloader/queue/resume", headers=self.headers)
        self.assertEqual(resume_res.status_code, 200)

    def test_queue_delete_non_existent_task(self) -> None:
        """Tier 2: Verify deleting a non-existent task returns 404 or safe error message."""
        del_res = self.client.delete("/api/v1/downloader/queue/non-existent-task-9999", headers=self.headers)
        self.assertIn(del_res.status_code, [200, 404])
        if del_res.status_code == 200:
            self.assertFalse(del_res.json().get("success", True))

    def test_queue_reorder_boundary_limits(self) -> None:
        """Tier 2: Moving top task 'up' or 'top' and moving bottom task 'down' or 'bottom' does not crash."""
        self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)

        t1 = make_sample_hongguo_target("bound_1", "Phim Đầu", 1)
        t2 = make_sample_hongguo_target("bound_2", "Phim Cuối", 1)
        id1 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": t1}).json()["task_id"]
        id2 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": t2}).json()["task_id"]

        # Move top item up
        res1 = self.client.post("/api/v1/downloader/queue/reorder", headers=self.headers, json={"task_id": id1, "direction": "up"})
        self.assertEqual(res1.status_code, 200)

        # Move bottom item down
        res2 = self.client.post("/api/v1/downloader/queue/reorder", headers=self.headers, json={"task_id": id2, "direction": "down"})
        self.assertEqual(res2.status_code, 200)

        # Order must remain stable [id1, id2]
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        ids = [t["task_id"] for t in list_res.json()["tasks"]]
        self.assertEqual(ids[:2], [id1, id2])

    def test_queue_cancel_active_downloading_task(self) -> None:
        """Tier 2: Deleting or cancelling an actively running task halts it gracefully."""
        # Add task and allow it to start running
        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        if not hasattr(manager, "add_to_queue"):
            self.fail("DownloadManager does not implement add_to_queue")

        t = make_sample_hongguo_target("cancel_test", "Phim Bị Hủy", 5)
        task = manager.add_to_queue(target_info=t, episodes=[1, 2, 3, 4, 5])
        self.assertTrue(task.task_id)

        # Cancel or remove active task
        removed = manager.remove_from_queue(task.task_id)
        self.assertTrue(removed)
        # Check task status transitioned to cancelled or removed
        status_info = manager.get_queue()
        for tsk in status_info.get("tasks", []):
            if tsk["task_id"] == task.task_id:
                self.assertIn(tsk["status"], ["cancelled", "failed"])

    def test_queue_add_with_invalid_payload(self) -> None:
        """Tier 2: Adding task with invalid or missing fields returns validation error (400 or 422)."""
        # Empty body
        res1 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={})
        self.assertIn(res1.status_code, [400, 422])

        # Missing title or series_id in target_info
        res2 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": {}})
        self.assertIn(res2.status_code, [400, 422])

    # =========================================================================
    # TIER 3: CROSS-FEATURE TESTS
    # =========================================================================

    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    @patch("urllib.request.urlopen")
    def test_queue_auto_advance_on_drama_completion(self, mock_urlopen, mock_resolve) -> None:
        """Tier 3: When drama 1 finishes all episodes, worker automatically starts drama 2."""
        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        if not hasattr(manager, "add_to_queue"):
            self.fail("DownloadManager does not implement add_to_queue")

        # Mock resolve_video_url and file creation
        def fake_resolve(vid, proxy=None, device_keys=None):
            fake_file = self.uploads_dir / f"mock_{vid}.mp4"
            fake_file.write_bytes(b"0" * 150000)
            return {"url": f"http://fake.com/{vid}.mp4"}
        mock_resolve.side_effect = fake_resolve

        t1 = make_sample_hongguo_target("series_auto_1", "Phim Hoàn Thành Trước", 1)
        t2 = make_sample_hongguo_target("series_auto_2", "Phim Kế Tiếp Tự Động Chạy", 1)

        task1 = manager.add_to_queue(target_info=t1, episodes=[1], auto_create_project=False)
        task2 = manager.add_to_queue(target_info=t2, episodes=[1], auto_create_project=False)

        # Wait with timeout for queue scheduler to process both tasks
        start_wait = time.time()
        completed_both = False
        while time.time() - start_wait < 10.0:
            q_info = manager.get_queue()
            statuses = {t["task_id"]: t["status"] for t in q_info.get("tasks", [])}
            if statuses.get(task1.task_id) == "completed" and statuses.get(task2.task_id) == "completed":
                completed_both = True
                break
            time.sleep(0.2)

        self.assertTrue(
            completed_both,
            f"Queue did not auto-advance to complete both tasks within timeout. Statuses: {statuses}",
        )

    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    def test_queue_auto_advance_on_drama_failure(self, mock_resolve) -> None:
        """Tier 3: When drama 1 fails, status becomes 'failed' and drama 2 auto-starts without deadlock."""
        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        if not hasattr(manager, "add_to_queue"):
            self.fail("DownloadManager does not implement add_to_queue")

        # Drama 1 throws an unrecoverable decoding error
        call_count = [0]
        def mock_worker_behavior(vid, proxy=None, device_keys=None):
            call_count[0] += 1
            if "fail_ep" in str(vid):
                raise RuntimeError("ByteDance Decryption Error: Bad key")
            fake_file = self.uploads_dir / f"mock_{vid}.mp4"
            fake_file.write_bytes(b"0" * 150000)
            return {"url": f"http://fake.com/{vid}.mp4"}

        mock_resolve.side_effect = mock_worker_behavior

        t1 = make_sample_hongguo_target("series_fail_1", "Phim Bị Lỗi Mạng", 1)
        t2 = make_sample_hongguo_target("series_success_2", "Phim Chạy Bình Thường", 1)

        task1 = manager.add_to_queue(target_info=t1, episodes=[1], auto_create_project=False)
        task2 = manager.add_to_queue(target_info=t2, episodes=[1], auto_create_project=False)

        start_wait = time.time()
        recovered = False
        while time.time() - start_wait < 10.0:
            q_info = manager.get_queue()
            statuses = {t["task_id"]: t["status"] for t in q_info.get("tasks", [])}
            if statuses.get(task1.task_id) == "failed" and statuses.get(task2.task_id) == "completed":
                recovered = True
                break
            time.sleep(0.2)

        self.assertTrue(
            recovered,
            f"Queue failed to auto-advance past error to drama 2. Statuses: {statuses}",
        )

    @patch("subtitle_localizer.downloader.hongguo_parser.rotate_device")
    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    def test_queue_cross_drama_device_rotation(self, mock_resolve, mock_rotate) -> None:
        """Tier 3: Device rotation is invoked when transitioning between different dramas."""
        mock_rotate.return_value = {"device_id": "new_dev_999", "install_id": "new_ins_999"}
        mock_resolve.return_value = {"url": "http://fake.com/v.mp4"}

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        if not hasattr(manager, "add_to_queue"):
            self.fail("DownloadManager does not implement add_to_queue")

        t1 = make_sample_hongguo_target("series_rot_1", "Phim A Xoay Thiết Bị", 1)
        t2 = make_sample_hongguo_target("series_rot_2", "Phim B Nhận Thiết Bị Mới", 1)

        manager.add_to_queue(target_info=t1, episodes=[1], rotate_device_each_ep=False)
        manager.add_to_queue(target_info=t2, episodes=[1], rotate_device_each_ep=False)

        # Wait for completion
        start_wait = time.time()
        while time.time() - start_wait < 8.0:
            if mock_rotate.call_count >= 1:
                break
            time.sleep(0.1)
        # Verify rotate_device was invoked at cross-drama transition
        self.assertGreaterEqual(mock_rotate.call_count, 1, "Expected parser.rotate_device() call during cross-drama transition")

    def test_queue_jitter_delay_applied_between_dramas(self) -> None:
        """Tier 3: Jitter delay / rate limit delay parameter is tracked and applied across queue tasks."""
        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        if not hasattr(manager, "add_to_queue"):
            self.fail("DownloadManager does not implement add_to_queue")

        t = make_sample_hongguo_target("series_jitter_1", "Phim Test Jitter", 2)
        task = manager.add_to_queue(target_info=t, rate_limit_delay=1.5)
        self.assertEqual(task.rate_limit_delay, 1.5)

    # =========================================================================
    # TIER 4: REAL-WORLD 3-DRAMA SEQUENTIAL WORKLOAD
    # =========================================================================

    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    @patch("subtitle_localizer.downloader.hongguo_parser.rotate_device")
    def test_queue_three_drama_sequential_workload(self, mock_rotate, mock_resolve) -> None:
        """Tier 4: End-to-end simulation of 3 distinct dramas queued and executed sequentially."""
        mock_rotate.return_value = {"device_id": "workload_dev", "install_id": "workload_ins"}
        
        # Setup mock files
        def fake_resolve(vid, proxy=None, device_keys=None):
            f = self.uploads_dir / f"workload_{vid}.mp4"
            f.write_bytes(b"X" * 120000)
            return {"url": f"http://fake.com/{vid}.mp4"}
        mock_resolve.side_effect = fake_resolve

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        if not hasattr(manager, "add_to_queue"):
            self.fail("DownloadManager does not implement add_to_queue")

        d1 = make_sample_hongguo_target("drama_A", "Chàng Rể Quyền Lực", 2)
        d2 = make_sample_hongguo_target("drama_B", "Cô Vợ Hào Môn", 2)
        d3 = make_sample_hongguo_target("drama_C", "Bá Đạo Tổng Tài", 1)

        task_a = manager.add_to_queue(target_info=d1, episodes=[1, 2], auto_create_project=True)
        task_b = manager.add_to_queue(target_info=d2, episodes=[1, 2], auto_create_project=True)
        task_c = manager.add_to_queue(target_info=d3, episodes=[1], auto_create_project=True)

        # Monitor sequential completion
        start_time = time.time()
        all_completed = False
        while time.time() - start_time < 15.0:
            q_info = manager.get_queue()
            statuses = [t["status"] for t in q_info.get("tasks", [])]
            if len(statuses) == 3 and all(s == "completed" for s in statuses):
                all_completed = True
                break
            time.sleep(0.3)

        self.assertTrue(
            all_completed,
            f"Sequential 3-drama queue workload failed to complete all tasks. Statuses: {statuses}",
        )

        # Verify projects were created in repo for each completed episode
        projects = self.repo.list_projects()
        self.assertGreaterEqual(len(projects), 5, f"Expected 5 projects created for 2+2+1 episodes, got {len(projects)}")


if __name__ == "__main__":
    unittest.main()
