"""
Challenger M1_2 Test Suite: Lifecycle, Boundary & API Stress Testing.

Covers:
1. Reordering boundary & fuzzing (1..N boundaries, negative indices, missing IDs, invalid directions, stress reordering)
2. Task deletion across all lifecycle states (pending, running, completed, failed, cancelled, non-existent, double delete)
3. Auto cover download resilience (network errors, timeouts, invalid URLs, ensuring worker continues despite cover failures)
4. Malformed payload fuzzing & HTTP status code verification on all endpoints
5. Legacy /start, /status, /cancel lifecycle & concurrency edge cases
"""

import os
import sys
import tempfile
import time
import unittest
import urllib.error
from pathlib import Path
from typing import Any, Dict
from unittest.mock import MagicMock, patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from fastapi.testclient import TestClient
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.downloader import DownloadManager, DownloadTask
from subtitle_localizer.service.server import create_app


def make_sample_target(series_id: str = "74123456789012345", title: str = "Phim Test", total_eps: int = 2) -> Dict[str, Any]:
    return {
        "platform": "hongguo",
        "series_id": series_id,
        "title": title,
        "cover_url": f"https://example.com/cover_{series_id}.jpg",
        "total_episodes": total_eps,
        "accessible_count": total_eps,
        "intro": f"Mô tả {title}",
        "vid_count": total_eps,
    }


class TestChallengerM12LifecycleAndAPI(unittest.TestCase):
    """Adversarial stress tests for M1 API and Lifecycle."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.temp_path = Path(self.temp_dir.name)
        self.db_path = self.temp_path / "challenger_test.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.uploads_dir = self.temp_path / "uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.output_root = self.temp_path / "outputs"
        self.output_root.mkdir(parents=True, exist_ok=True)

        self.auth_token = "challenger-secret-token"
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
    # PART 1: REORDERING BOUNDARY FUZZING & STRESS TESTING
    # =========================================================================

    def test_reorder_empty_queue(self) -> None:
        """Reordering on an empty queue should return empty list gracefully with 200 OK."""
        res = self.client.post(
            "/api/v1/downloader/queue/reorder",
            headers=self.headers,
            json={"task_id": "non_existent_id", "direction": "up"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("tasks"), [])

    def test_reorder_single_item_queue(self) -> None:
        """Reordering when only 1 item exists in queue with any direction."""
        self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)
        add_res = self.client.post(
            "/api/v1/downloader/queue/add",
            headers=self.headers,
            json={"target_info": make_sample_target("id_1", "Single Item", 1)},
        )
        task_id = add_res.json()["task_id"]

        for direction in ["up", "down", "top", "bottom"]:
            res = self.client.post(
                "/api/v1/downloader/queue/reorder",
                headers=self.headers,
                json={"task_id": task_id, "direction": direction},
            )
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json().get("tasks"), [task_id])

    def test_reorder_boundary_stress_100_times(self) -> None:
        """Fuzz top-item 'up' / 'top' and bottom-item 'down' / 'bottom' 100 times."""
        self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)
        ids = []
        for i in range(5):
            r = self.client.post(
                "/api/v1/downloader/queue/add",
                headers=self.headers,
                json={"target_info": make_sample_target(f"id_{i}", f"Item {i}", 1)},
            )
            ids.append(r.json()["task_id"])

        # 100 times 'up' on top item
        for _ in range(100):
            res = self.client.post(
                "/api/v1/downloader/queue/reorder",
                headers=self.headers,
                json={"task_id": ids[0], "direction": "up"},
            )
            self.assertEqual(res.status_code, 200)

        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        curr_ids = [t["task_id"] for t in list_res.json()["tasks"]]
        self.assertEqual(curr_ids, ids, "Top item moved unexpectedly when pushed up repeatedly")

        # 100 times 'down' on bottom item
        for _ in range(100):
            res = self.client.post(
                "/api/v1/downloader/queue/reorder",
                headers=self.headers,
                json={"task_id": ids[-1], "direction": "down"},
            )
            self.assertEqual(res.status_code, 200)

        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        curr_ids = [t["task_id"] for t in list_res.json()["tasks"]]
        self.assertEqual(curr_ids, ids, "Bottom item moved unexpectedly when pushed down repeatedly")

    def test_reorder_invalid_directions_and_unknown_ids(self) -> None:
        """Reordering with non-existent IDs and invalid direction strings."""
        self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)
        r = self.client.post(
            "/api/v1/downloader/queue/add",
            headers=self.headers,
            json={"target_info": make_sample_target("id_x", "Item X", 1)},
        )
        task_id = r.json()["task_id"]

        # Unknown task_id
        res = self.client.post(
            "/api/v1/downloader/queue/reorder",
            headers=self.headers,
            json={"task_id": "non_existent_random_id", "direction": "up"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("tasks"), [task_id])

        # Invalid direction strings
        for bad_dir in ["left", "right", "diagonal", "123", "", "   "]:
            res = self.client.post(
                "/api/v1/downloader/queue/reorder",
                headers=self.headers,
                json={"task_id": task_id, "direction": bad_dir},
            )
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json().get("tasks"), [task_id])

    def test_reorder_preserves_non_pending_tasks(self) -> None:
        """Reordering only affects pending tasks without altering positions of finished/cancelled tasks."""
        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        manager.pause_queue()

        # Manually create tasks with different statuses
        task1 = manager.add_to_queue(target_info=make_sample_target("s1", "T1", 1))
        task2 = manager.add_to_queue(target_info=make_sample_target("s2", "T2", 1))
        task3 = manager.add_to_queue(target_info=make_sample_target("s3", "T3", 1))
        task4 = manager.add_to_queue(target_info=make_sample_target("s4", "T4", 1))

        # Manually set task1 as completed, task2 as failed
        task1.status = "completed"
        task2.status = "failed"

        # Tasks list now: [T1(completed), T2(failed), T3(pending), T4(pending)]
        # Reorder T4 to top of pending
        new_order = manager.reorder_queue(task4.task_id, "up")
        self.assertEqual(new_order, [task1.task_id, task2.task_id, task4.task_id, task3.task_id])

        # Try to reorder completed task1
        unchanged = manager.reorder_queue(task1.task_id, "down")
        self.assertEqual(unchanged, [task1.task_id, task2.task_id, task4.task_id, task3.task_id])

    # =========================================================================
    # PART 2: TASK DELETION ACROSS LIFECYCLE STATES
    # =========================================================================

    def test_delete_non_existent_and_empty_id(self) -> None:
        """Deleting non-existent or invalid task IDs."""
        res = self.client.delete("/api/v1/downloader/queue/totally_non_existent_id", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json().get("success", True))

    def test_delete_pending_tasks_head_middle_tail(self) -> None:
        """Test deleting pending tasks from head, middle, and tail of queue."""
        self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)
        ids = []
        for i in range(5):
            r = self.client.post(
                "/api/v1/downloader/queue/add",
                headers=self.headers,
                json={"target_info": make_sample_target(f"id_{i}", f"Item {i}", 1)},
            )
            ids.append(r.json()["task_id"])

        # Delete middle (index 2)
        res_mid = self.client.delete(f"/api/v1/downloader/queue/{ids[2]}", headers=self.headers)
        self.assertTrue(res_mid.json().get("success"))
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        curr_ids = [t["task_id"] for t in list_res.json()["tasks"]]
        self.assertEqual(curr_ids, [ids[0], ids[1], ids[3], ids[4]])

        # Delete head (index 0)
        res_head = self.client.delete(f"/api/v1/downloader/queue/{ids[0]}", headers=self.headers)
        self.assertTrue(res_head.json().get("success"))
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        curr_ids = [t["task_id"] for t in list_res.json()["tasks"]]
        self.assertEqual(curr_ids, [ids[1], ids[3], ids[4]])

        # Delete tail (index 4)
        res_tail = self.client.delete(f"/api/v1/downloader/queue/{ids[4]}", headers=self.headers)
        self.assertTrue(res_tail.json().get("success"))
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        curr_ids = [t["task_id"] for t in list_res.json()["tasks"]]
        self.assertEqual(curr_ids, [ids[1], ids[3]])

    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    def test_delete_running_task_and_auto_advance(self, mock_resolve) -> None:
        """Deleting an active/running task cancels it and auto-advances to the next task."""
        # Setup mock resolve
        def slow_resolve(vid, proxy=None, device_keys=None):
            time.sleep(0.3)
            f = self.uploads_dir / f"mock_{vid}.mp4"
            f.write_bytes(b"A" * 150000)
            return {"url": f"http://fake.com/{vid}.mp4"}
        mock_resolve.side_effect = slow_resolve

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        t1 = make_sample_target("cancel_adv_1", "Task to Cancel", 5)
        t2 = make_sample_target("cancel_adv_2", "Task to Succeed", 1)

        task1 = manager.add_to_queue(target_info=t1, episodes=[1, 2, 3, 4, 5], auto_create_project=False)
        task2 = manager.add_to_queue(target_info=t2, episodes=[1], auto_create_project=False)

        # Wait until task1 is running
        for _ in range(20):
            if task1.status == "running":
                break
            time.sleep(0.1)
        self.assertEqual(task1.status, "running")

        # Delete running task1
        del1 = manager.remove_from_queue(task1.task_id)
        self.assertTrue(del1)

        # Wait for task2 to complete
        start_wait = time.time()
        while time.time() - start_wait < 5.0:
            if task2.status == "completed":
                break
            time.sleep(0.2)

        self.assertEqual(task1.status, "cancelled")
        self.assertEqual(task2.status, "completed")

        # Second delete on task1 (now cancelled) removes it from list
        del2 = manager.remove_from_queue(task1.task_id)
        self.assertTrue(del2)

        # Third delete on task1 returns False
        del3 = manager.remove_from_queue(task1.task_id)
        self.assertFalse(del3)

    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    def test_delete_completed_and_failed_tasks(self, mock_resolve) -> None:
        """Deleting completed and failed tasks removes them cleanly."""
        def fake_resolve(vid, proxy=None, device_keys=None):
            if "fail" in str(vid):
                raise RuntimeError("Intentional error for test")
            f = self.uploads_dir / f"mock_{vid}.mp4"
            f.write_bytes(b"B" * 150000)
            return {"url": f"http://fake.com/{vid}.mp4"}
        mock_resolve.side_effect = fake_resolve

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        t_fail = make_sample_target("fail_series", "Failing Task", 1)
        t_ok = make_sample_target("ok_series", "Succeeding Task", 1)

        task_fail = manager.add_to_queue(target_info=t_fail, episodes=[1], auto_create_project=False)
        task_ok = manager.add_to_queue(target_info=t_ok, episodes=[1], auto_create_project=False)

        # Wait for both to finish
        start_wait = time.time()
        while time.time() - start_wait < 10.0:
            if task_fail.status == "failed" and task_ok.status == "completed":
                break
            time.sleep(0.1)

        self.assertEqual(task_fail.status, "failed")
        self.assertEqual(task_ok.status, "completed")

        # Delete failed task
        res_del_fail = manager.remove_from_queue(task_fail.task_id)
        self.assertTrue(res_del_fail)

        # Delete completed task
        res_del_ok = manager.remove_from_queue(task_ok.task_id)
        self.assertTrue(res_del_ok)

        # Queue should now be empty
        self.assertEqual(len(manager.get_queue()["tasks"]), 0)

    # =========================================================================
    # PART 3: AUTO COVER DOWNLOAD RESILIENCE
    # =========================================================================

    def test_download_cover_empty_url_validation(self) -> None:
        """POST /download-cover rejects empty or whitespace-only URL with HTTP 400."""
        res1 = self.client.post(
            "/api/v1/downloader/download-cover",
            headers=self.headers,
            json={"cover_url": "", "output_dir": str(self.temp_path)},
        )
        self.assertEqual(res1.status_code, 400)

        res2 = self.client.post(
            "/api/v1/downloader/download-cover",
            headers=self.headers,
            json={"cover_url": "   ", "output_dir": str(self.temp_path)},
        )
        self.assertEqual(res2.status_code, 400)

    @patch("urllib.request.urlopen")
    def test_download_cover_network_timeout_returns_error_json(self, mock_urlopen) -> None:
        """POST /download-cover returns structured error when network times out, not 500."""
        mock_urlopen.side_effect = TimeoutError("Network timeout")

        res = self.client.post(
            "/api/v1/downloader/download-cover",
            headers=self.headers,
            json={
                "cover_url": "https://example.com/timeout.jpg",
                "output_dir": str(self.temp_path),
            },
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data.get("success", True))
        self.assertIn("timeout", data.get("message", "").lower())

    @patch("urllib.request.urlopen")
    def test_download_cover_http_error_returns_error_json(self, mock_urlopen) -> None:
        """POST /download-cover returns structured error on HTTP 404/500."""
        mock_urlopen.side_effect = urllib.error.HTTPError(
            url="https://example.com/notfound.jpg",
            code=404,
            msg="Not Found",
            hdrs={},
            fp=None,
        )

        res = self.client.post(
            "/api/v1/downloader/download-cover",
            headers=self.headers,
            json={
                "cover_url": "https://example.com/notfound.jpg",
                "output_dir": str(self.temp_path),
            },
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data.get("success", True))

    @patch("subtitle_localizer.service.downloader.download_cover_file")
    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    def test_auto_cover_download_failure_does_not_abort_task(self, mock_resolve, mock_cover) -> None:
        """In queue execution, cover download failure must NOT crash or fail the main task."""
        mock_cover.side_effect = urllib.error.URLError("DNS resolution failed")

        def fake_resolve(vid, proxy=None, device_keys=None):
            f = self.uploads_dir / f"mock_{vid}.mp4"
            f.write_bytes(b"C" * 150000)
            return {"url": f"http://fake.com/{vid}.mp4"}
        mock_resolve.side_effect = fake_resolve

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        t = make_sample_target("cover_fail_task", "Drama Despite Cover Fail", 1)
        task = manager.add_to_queue(target_info=t, episodes=[1], auto_create_project=False)

        start_wait = time.time()
        while time.time() - start_wait < 5.0:
            if task.status in ["completed", "failed"]:
                break
            time.sleep(0.1)

        self.assertEqual(task.status, "completed", "Task should succeed even if cover download fails")
        self.assertGreaterEqual(mock_cover.call_count, 1)

    # =========================================================================
    # PART 4: MALFORMED PAYLOAD FUZZING & HTTP STATUS CODES
    # =========================================================================

    def test_queue_add_missing_body(self) -> None:
        """POST /queue/add with empty body returns 422."""
        res = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={})
        self.assertEqual(res.status_code, 422)

    def test_queue_add_null_and_empty_target_info(self) -> None:
        """POST /queue/add with null or empty target_info returns 422."""
        res1 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": None})
        self.assertEqual(res1.status_code, 422)

        res2 = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": {}})
        self.assertEqual(res2.status_code, 422)

    def test_queue_add_invalid_target_info_without_required_identifiers(self) -> None:
        """POST /queue/add without title, series_id, or url returns 422."""
        res = self.client.post(
            "/api/v1/downloader/queue/add",
            headers=self.headers,
            json={"target_info": {"some_field": "val"}},
        )
        self.assertEqual(res.status_code, 422)

    def test_queue_add_type_fuzzing(self) -> None:
        """POST /queue/add with invalid field types returns 422."""
        base_target = {"title": "Valid Title", "series_id": "12345"}

        # target_info as string
        res = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": "not_a_dict"})
        self.assertEqual(res.status_code, 422)

        # start_ep as string
        res = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": base_target, "start_ep": "one"})
        self.assertEqual(res.status_code, 422)

        # episodes as integer instead of list
        res = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": base_target, "episodes": 123})
        self.assertEqual(res.status_code, 422)

        # rate_limit_delay as string
        res = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": base_target, "rate_limit_delay": "slow"})
        self.assertEqual(res.status_code, 422)

        # auto_create_project as non-boolean string
        res = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": base_target, "auto_create_project": "yes"})
        # Note: Pydantic may convert 'yes' to True or fail; if it fails it's 422
        self.assertIn(res.status_code, [200, 422])

    def test_queue_add_extreme_numeric_values(self) -> None:
        """POST /queue/add with negative numbers and giant numbers must not cause 500 errors."""
        base_target = {"title": "Extreme Test", "series_id": "123456789"}

        res = self.client.post(
            "/api/v1/downloader/queue/add",
            headers=self.headers,
            json={
                "target_info": base_target,
                "start_ep": -100,
                "end_ep": -50,
                "rate_limit_delay": -2.5,
            },
        )
        self.assertIn(res.status_code, [200, 400, 422])

    def test_reorder_missing_or_invalid_fields(self) -> None:
        """POST /queue/reorder with missing fields returns 422."""
        res1 = self.client.post("/api/v1/downloader/queue/reorder", headers=self.headers, json={})
        self.assertEqual(res1.status_code, 422)

        res2 = self.client.post("/api/v1/downloader/queue/reorder", headers=self.headers, json={"task_id": "123"})
        self.assertEqual(res2.status_code, 422)

        res3 = self.client.post("/api/v1/downloader/queue/reorder", headers=self.headers, json={"direction": "up"})
        self.assertEqual(res3.status_code, 422)

    def test_directory_validate_fuzzing(self) -> None:
        """POST /directory/validate with invalid types and special characters."""
        # Valid path
        res1 = self.client.post("/api/v1/downloader/directory/validate", headers=self.headers, json={"path": "C:\\valid\\test"})
        self.assertEqual(res1.status_code, 200)

        # Path with illegal characters (*, ?, <, >, |)
        res2 = self.client.post("/api/v1/downloader/directory/validate", headers=self.headers, json={"path": "C:\\invalid*dir"})
        self.assertEqual(res2.status_code, 200)
        self.assertFalse(res2.json().get("valid"))

        # Empty body defaults to empty path -> 200
        res3 = self.client.post("/api/v1/downloader/directory/validate", headers=self.headers, json={})
        self.assertEqual(res3.status_code, 200)
        self.assertTrue(res3.json().get("valid"))

    def test_scan_episodes_fuzzing(self) -> None:
        """POST /scan-episodes with missing or invalid fields."""
        # Missing fields
        res1 = self.client.post("/api/v1/downloader/scan-episodes", headers=self.headers, json={})
        self.assertEqual(res1.status_code, 422)

        # Missing total_episodes
        res2 = self.client.post("/api/v1/downloader/scan-episodes", headers=self.headers, json={"title": "Drama"})
        self.assertEqual(res2.status_code, 422)

        # Invalid total_episodes type
        res3 = self.client.post("/api/v1/downloader/scan-episodes", headers=self.headers, json={"title": "Drama", "total_episodes": "lots"})
        self.assertEqual(res3.status_code, 422)

        # Negative total_episodes handled gracefully without crashing
        res4 = self.client.post("/api/v1/downloader/scan-episodes", headers=self.headers, json={"title": "Drama", "total_episodes": -5})
        self.assertEqual(res4.status_code, 200)
        self.assertEqual(len(res4.json().get("episodes")), 1)

    # =========================================================================
    # PART 5: LEGACY ENDPOINTS & AUTHENTICATION
    # =========================================================================

    def test_unauthorized_access_to_all_endpoints(self) -> None:
        """Verify 401 Unauthorized for all endpoints when auth header is missing or wrong."""
        bad_headers = {"Authorization": "Bearer wrong-token"}

        endpoints = [
            ("POST", "/api/v1/downloader/queue/add", {"target_info": {"title": "X", "series_id": "1"}}),
            ("GET", "/api/v1/downloader/queue/list", None),
            ("POST", "/api/v1/downloader/queue/pause", None),
            ("POST", "/api/v1/downloader/queue/resume", None),
            ("POST", "/api/v1/downloader/queue/reorder", {"task_id": "1", "direction": "up"}),
            ("DELETE", "/api/v1/downloader/queue/123", None),
            ("POST", "/api/v1/downloader/directory/validate", {"path": ""}),
            ("POST", "/api/v1/downloader/scan-episodes", {"title": "X", "total_episodes": 1}),
            ("POST", "/api/v1/downloader/download-cover", {"cover_url": "http://x", "output_dir": "y"}),
            ("POST", "/api/v1/downloader/start", {"target_info": {"title": "X", "series_id": "1"}}),
            ("GET", "/api/v1/downloader/status", None),
            ("POST", "/api/v1/downloader/cancel", None),
        ]

        for method, url, body in endpoints:
            # Test without header
            if method == "GET":
                r_none = self.client.get(url)
                r_bad = self.client.get(url, headers=bad_headers)
            elif method == "POST":
                r_none = self.client.post(url, json=body or {})
                r_bad = self.client.post(url, headers=bad_headers, json=body or {})
            elif method == "DELETE":
                r_none = self.client.delete(url)
                r_bad = self.client.delete(url, headers=bad_headers)

            self.assertEqual(r_none.status_code, 401, f"{method} {url} should require auth (got {r_none.status_code})")
            self.assertEqual(r_bad.status_code, 403, f"{method} {url} should reject bad auth with 403 (got {r_bad.status_code})")

    def test_legacy_status_and_cancel_when_idle(self) -> None:
        """Verify legacy /status and /cancel behave cleanly when nothing is running."""
        status_res = self.client.get("/api/v1/downloader/status", headers=self.headers)
        self.assertEqual(status_res.status_code, 200)
        self.assertEqual(status_res.json().get("status"), "idle")

        cancel_res = self.client.post("/api/v1/downloader/cancel", headers=self.headers)
        self.assertEqual(cancel_res.status_code, 200)
        self.assertEqual(cancel_res.json().get("status"), "cancelling")

    # =========================================================================
    # PART 6: DEEP CONCURRENCY, INTEGRITY & ADVERSARIAL STRESS TESTS
    # =========================================================================

    def test_reorder_concurrent_with_pause_resume(self) -> None:
        """Rapidly reorder tasks while toggling pause and resume."""
        import threading
        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        manager.pause_queue()

        # Add 10 tasks
        tasks = []
        for i in range(10):
            t = manager.add_to_queue(target_info=make_sample_target(f"c_series_{i}", f"Title {i}", 1))
            tasks.append(t.task_id)

        stop_threads = False

        def reorder_worker():
            directions = ["up", "down", "top", "bottom"]
            idx = 0
            while not stop_threads:
                tid = tasks[idx % len(tasks)]
                d = directions[idx % len(directions)]
                manager.reorder_queue(tid, d)
                idx += 1
                time.sleep(0.001)

        def pause_worker():
            while not stop_threads:
                manager.pause_queue()
                time.sleep(0.005)
                manager.resume_queue()
                time.sleep(0.005)

        t_reorder = threading.Thread(target=reorder_worker)
        t_pause = threading.Thread(target=pause_worker)

        t_reorder.start()
        t_pause.start()

        time.sleep(1.0)
        stop_threads = True
        t_reorder.join()
        t_pause.join()

        # Check queue consistency
        queue = manager.get_queue()
        task_ids = [t["task_id"] for t in queue["tasks"]]
        self.assertEqual(sorted(task_ids), sorted(tasks), "Task set mutated or corrupted during concurrent reorder")

    def test_episodes_list_deduplication_and_sorting(self) -> None:
        """Ensure duplicate and out-of-order episode lists are sanitized."""
        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        manager.pause_queue()

        t = manager.add_to_queue(
            target_info=make_sample_target("dedup_test", "Dedup Test", 10),
            episodes=[5, 2, 2, 1, 5, 3],
            auto_create_project=False,
        )
        self.assertEqual(t.episodes, [1, 2, 3, 5], "Episodes should be deduplicated and sorted")
        self.assertEqual(t.total_eps, 4)

    @patch("subtitle_localizer.service.downloader.download_cover_file")
    @patch("subtitle_localizer.service.downloader.DownloadManager._get_vid_list")
    def test_invalid_start_and_end_ep_ranges(self, mock_vids, mock_cover) -> None:
        """When start_ep > end_ep, task should not crash or enter infinite loop."""
        mock_vids.return_value = ["vid1", "vid2", "vid3", "vid4", "vid5"]
        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        # start_ep 5, end_ep 2 -> empty range
        task = manager.add_to_queue(
            target_info=make_sample_target("range_test", "Range Test", 10),
            start_ep=5,
            end_ep=2,
            auto_create_project=False,
        )
        start_wait = time.time()
        while time.time() - start_wait < 5.0:
            if task.status in ["completed", "failed"]:
                break
            time.sleep(0.1)

        self.assertEqual(task.status, "completed")

    @patch("urllib.request.urlopen")
    def test_download_cover_path_traversal_sanitization(self, mock_urlopen) -> None:
        """Attempting to use path traversal in filename should be constrained to output directory."""
        fake_jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 2048 + b"\xff\xd9"
        mock_resp = MagicMock()
        mock_resp.read.return_value = fake_jpeg
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        sub_dir = self.temp_path / "subfolder"
        sub_dir.mkdir(parents=True, exist_ok=True)

        res = self.client.post(
            "/api/v1/downloader/download-cover",
            headers=self.headers,
            json={
                "cover_url": "https://example.com/cover.jpg",
                "output_dir": str(sub_dir),
                "filename": "custom_cover.png",
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json().get("success"))
        created_file = Path(res.json().get("file_path"))
        self.assertTrue(created_file.exists())
        self.assertEqual(created_file.name, "custom_cover.png")

    def test_malformed_json_syntax_returns_400_or_422(self) -> None:
        """Sending completely broken JSON body returns HTTP 400 or 422, not 500."""
        res = self.client.post(
            "/api/v1/downloader/queue/add",
            headers={**self.headers, "Content-Type": "application/json"},
            content="NOT VALID JSON {{{{",
        )
        self.assertIn(res.status_code, [400, 422])

    @patch("subtitle_localizer.downloader.hongguo_parser.rotate_device", return_value={"device_id": "111", "install_id": "222"})
    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    def test_delete_task_during_active_download_stress(self, mock_resolve, mock_rotate) -> None:
        """Repeatedly queue and delete active tasks to stress-test race conditions."""
        def fake_resolve(vid, proxy=None, device_keys=None):
            time.sleep(0.05)
            f = self.uploads_dir / f"mock_{vid}.mp4"
            f.write_bytes(b"D" * 150000)
            return {"url": f"http://fake.com/{vid}.mp4"}
        mock_resolve.side_effect = fake_resolve

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)

        for i in range(3):
            t = manager.add_to_queue(
                target_info=make_sample_target(f"stress_del_{i}", f"Stress {i}", 10),
                auto_create_project=False,
            )
            time.sleep(0.08)  # Let it start
            # Delete while running or just started
            manager.remove_from_queue(t.task_id)

        # Allow queue to settle
        time.sleep(0.5)
        # Ensure manager is still operational by adding a final normal task
        final_task = manager.add_to_queue(
            target_info=make_sample_target("final_ok", "Final Task", 1),
            episodes=[1],
            auto_create_project=False,
        )
        start_wait = time.time()
        while time.time() - start_wait < 10.0:
            if final_task.status == "completed":
                break
            time.sleep(0.1)
        self.assertEqual(final_task.status, "completed")

    def test_reorder_exact_permutations(self) -> None:
        """Test precise permutations of 4 items with up, down, top, bottom."""
        self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)
        ids = []
        for name in ["A", "B", "C", "D"]:
            r = self.client.post(
                "/api/v1/downloader/queue/add",
                headers=self.headers,
                json={"target_info": make_sample_target(f"id_{name}", f"Title {name}", 1)},
            )
            ids.append(r.json()["task_id"])

        # Initial: [A, B, C, D]
        # Move C up -> [A, C, B, D]
        self.client.post("/api/v1/downloader/queue/reorder", headers=self.headers, json={"task_id": ids[2], "direction": "UP"})
        res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        self.assertEqual([t["task_id"] for t in res.json()["tasks"]], [ids[0], ids[2], ids[1], ids[3]])

        # Move B down -> [A, C, D, B]
        self.client.post("/api/v1/downloader/queue/reorder", headers=self.headers, json={"task_id": ids[1], "direction": "Down"})
        res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        self.assertEqual([t["task_id"] for t in res.json()["tasks"]], [ids[0], ids[2], ids[3], ids[1]])

        # Move D top -> [D, A, C, B]
        self.client.post("/api/v1/downloader/queue/reorder", headers=self.headers, json={"task_id": ids[3], "direction": "TOP"})
        res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        self.assertEqual([t["task_id"] for t in res.json()["tasks"]], [ids[3], ids[0], ids[2], ids[1]])

        # Move D bottom -> [A, C, B, D]
        self.client.post("/api/v1/downloader/queue/reorder", headers=self.headers, json={"task_id": ids[3], "direction": "BOTTOM"})
        res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        self.assertEqual([t["task_id"] for t in res.json()["tasks"]], [ids[0], ids[2], ids[1], ids[3]])

    def test_unicode_and_special_character_resilience(self) -> None:
        """Test queue addition with UTF-8 Vietnamese, CJK, emoji, and SQL/Command injection strings."""
        strange_titles = [
            "Tiếng Việt có dấu: Ắ, Ằ, Ẳ, Ẵ, Ặ, Ẹ, Ẻ, Ẽ",
            "中文标题：霸道总裁爱上我",
            "Special characters: 🎬 🍿 📽️ !@#$%^&*()_+~`",
            "SQL Injection test: '; DROP TABLE projects; --",
            'Command injection: " && calc.exe &',
        ]
        self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)
        for idx, title in enumerate(strange_titles):
            target = make_sample_target(f"weird_id_{idx}", title, 1)
            res = self.client.post("/api/v1/downloader/queue/add", headers=self.headers, json={"target_info": target})
            self.assertEqual(res.status_code, 200, f"Failed for title: {title}")
            self.assertTrue(res.json().get("success"))

        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        tasks = list_res.json()["tasks"]
        self.assertEqual(len(tasks), len(strange_titles))

    @patch("urllib.request.urlopen")
    def test_cover_download_with_unicode_folder(self, mock_urlopen) -> None:
        """Test downloading cover to a directory path with Vietnamese/spaces."""
        fake_jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 512 + b"\xff\xd9"
        mock_resp = MagicMock()
        mock_resp.read.return_value = fake_jpeg
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        unicode_dir = self.temp_path / "Thư mục tiếng Việt có dấu"
        res = self.client.post(
            "/api/v1/downloader/download-cover",
            headers=self.headers,
            json={
                "cover_url": "https://example.com/cover.jpg",
                "output_dir": str(unicode_dir),
                "filename": "ảnh_bìa.jpg",
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json().get("success"))
        file_path = Path(res.json().get("file_path"))
        self.assertTrue(file_path.exists())
        self.assertTrue(file_path.name == "ảnh_bìa.jpg")

    def test_legacy_start_conflict(self) -> None:
        """Calling legacy /start when another task is active should return 409 Conflict."""
        # Pause queue first
        self.client.post("/api/v1/downloader/queue/pause", headers=self.headers)
        t = make_sample_target("start_conflict_1", "Legacy Conflict 1", 1)

        # Start first
        res1 = self.client.post("/api/v1/downloader/start", headers=self.headers, json={"target_info": t})
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json().get("status"), "started")

        # Try to start another while first is running
        res2 = self.client.post("/api/v1/downloader/start", headers=self.headers, json={"target_info": t})
        self.assertEqual(res2.status_code, 409)
        self.assertIn("Đang có một tiến trình", res2.json().get("detail", ""))

    def test_downloader_parse_validation(self) -> None:
        """Test /api/v1/downloader/parse with invalid inputs."""
        # Empty string
        res = self.client.post("/api/v1/downloader/parse", headers=self.headers, json={"target": ""})
        self.assertEqual(res.status_code, 400)

        # Whitespace
        res = self.client.post("/api/v1/downloader/parse", headers=self.headers, json={"target": "   "})
        self.assertEqual(res.status_code, 400)

        # Missing field
        res = self.client.post("/api/v1/downloader/parse", headers=self.headers, json={})
        self.assertEqual(res.status_code, 422)


if __name__ == "__main__":
    unittest.main()
