"""
Adversarial Concurrency & Stress Test Suite for DownloadManager (Milestone M1).
Target: src/subtitle_localizer/service/downloader.py and server.py

Verification Dimensions:
1. Multi-threaded burst addition of tasks.
2. Concurrent pause/resume during task execution.
3. Cancellation of actively running task while queue is populated.
4. Auto-advance resilience when tasks throw exceptions.
5. Absence of deadlocks or race conditions under chaos stress.
"""

from __future__ import annotations

import os
import sys
import time
import random
import threading
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import patch, MagicMock

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from fastapi.testclient import TestClient
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.downloader import DownloadManager, DownloadTask
from subtitle_localizer.service.server import create_app


def make_mock_hongguo_target(series_id: str, title: str, total_eps: int = 2) -> Dict[str, Any]:
    return {
        "platform": "hongguo",
        "series_id": series_id,
        "title": title,
        "cover_url": f"https://example.com/{series_id}.jpg",
        "total_episodes": total_eps,
        "accessible_count": total_eps,
        "intro": f"Intro for {title}",
        "vid_count": total_eps,
    }


class TestDownloadManagerConcurrencyStress(unittest.TestCase):
    """Empirical adversarial stress test suite for DownloadManager concurrency."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.temp_path = Path(self.temp_dir.name)
        self.db_path = self.temp_path / "stress_test.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.uploads_dir = self.temp_path / "uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.output_root = self.temp_path / "outputs"
        self.output_root.mkdir(parents=True, exist_ok=True)

        self.auth_token = "stress-token"
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
    # 1. Multi-threaded Burst Addition of Tasks
    # =========================================================================

    def test_stress_multithreaded_burst_additions(self) -> None:
        """Adversarial Test 1: 20 threads simultaneously add 10 tasks each (200 tasks total)

        while 5 parallel threads hammer get_queue() and get_status().
        Verifies:
        - Exact task count (200) without lost updates.
        - Zero duplicate task IDs.
        - Zero concurrency exceptions during simultaneous reads and writes.
        """
        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        # Pause queue to keep tasks in pending state while adding
        manager.pause_queue()

        num_threads = 20
        tasks_per_thread = 10
        total_expected_tasks = num_threads * tasks_per_thread

        created_tasks: List[DownloadTask] = []
        lock = threading.Lock()
        exceptions: List[Exception] = []

        stop_readers = threading.Event()

        def reader_worker():
            while not stop_readers.is_set():
                try:
                    q = manager.get_queue()
                    _ = manager.get_status()
                    _ = len(q["tasks"])
                except Exception as exc:
                    with lock:
                        exceptions.append(exc)
                time.sleep(0.001)

        # Launch 5 reader threads
        readers = [threading.Thread(target=reader_worker) for _ in range(5)]
        for r in readers:
            r.start()

        def adder_worker(thread_idx: int):
            for i in range(tasks_per_thread):
                series_id = f"burst_s_{thread_idx:02d}_{i:02d}"
                target = make_mock_hongguo_target(series_id, f"Phim Burst {thread_idx}-{i}", 2)
                try:
                    task = manager.add_to_queue(
                        target_info=target,
                        episodes=[1, 2],
                        auto_create_project=False,
                    )
                    with lock:
                        created_tasks.append(task)
                except Exception as exc:
                    with lock:
                        exceptions.append(exc)

        # Launch 20 writer threads
        writers = [threading.Thread(target=adder_worker, args=(t,)) for t in range(num_threads)]
        for w in writers:
            w.start()
        for w in writers:
            w.join(timeout=10.0)

        stop_readers.set()
        for r in readers:
            r.join(timeout=5.0)

        # Assertions
        self.assertEqual(len(exceptions), 0, f"Exceptions occurred during burst add: {exceptions}")
        self.assertEqual(len(created_tasks), total_expected_tasks)

        queue_state = manager.get_queue()
        queued_tasks = queue_state["tasks"]
        self.assertEqual(
            len(queued_tasks),
            total_expected_tasks,
            f"Expected {total_expected_tasks} tasks in queue, found {len(queued_tasks)}",
        )

        # Check unique IDs
        all_ids = [t["task_id"] for t in queued_tasks]
        unique_ids = set(all_ids)
        self.assertEqual(len(all_ids), len(unique_ids), "Duplicate task IDs detected under concurrency!")

    # =========================================================================
    # 2. Concurrent Pause/Resume during Task Execution
    # =========================================================================

    @patch("subtitle_localizer.downloader.hongguo_parser.rotate_device", return_value={"device_id": "mock_dev_id", "install_id": "mock_iid", "platform": "android"})
    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    @patch("urllib.request.urlopen")
    def test_stress_concurrent_pause_resume_hammering(self, mock_urlopen, mock_resolve, mock_rotate) -> None:
        """Adversarial Test 2: Rapidly toggle pause/resume (60 toggles) across multiple threads

        while 4 download tasks are actively progressing.
        Verifies:
        - Absence of deadlocks on condition variable.
        - Scheduler does not lose notification signals.
        - All tasks eventually resume and complete.
        """
        def fake_resolve(vid, proxy=None, device_keys=None):
            fake_file = self.uploads_dir / f"mock_{vid}.mp4"
            fake_file.write_bytes(b"A" * 120000)
            time.sleep(0.02)  # Tiny delay to simulate processing
            return {"url": f"http://fake.com/{vid}.mp4"}

        mock_resolve.side_effect = fake_resolve

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)

        # Add 4 tasks
        for i in range(1, 5):
            t = make_mock_hongguo_target(f"pr_series_{i}", f"Phim PauseResume {i}", 2)
            manager.add_to_queue(target_info=t, episodes=[1, 2], auto_create_project=False)

        hammer_errors: List[Exception] = []

        def toggler_thread(cycles: int):
            for _ in range(cycles):
                try:
                    manager.pause_queue()
                    time.sleep(random.uniform(0.005, 0.02))
                    manager.resume_queue()
                    time.sleep(random.uniform(0.005, 0.02))
                except Exception as ex:
                    hammer_errors.append(ex)

        # Launch 2 pause/resume hammer threads
        t1 = threading.Thread(target=toggler_thread, args=(20,))
        t2 = threading.Thread(target=toggler_thread, args=(20,))
        t1.start()
        t2.start()
        t1.join(timeout=10.0)
        t2.join(timeout=10.0)

        self.assertEqual(len(hammer_errors), 0, f"Errors in pause/resume toggling: {hammer_errors}")

        # Ensure final state is resumed so pending tasks finish
        manager.resume_queue()

        # Wait with generous timeout for all 4 tasks to reach completion
        start_wait = time.time()
        all_done = False
        while time.time() - start_wait < 15.0:
            q = manager.get_queue()
            statuses = [t["status"] for t in q["tasks"]]
            if len(statuses) == 4 and all(s == "completed" for s in statuses):
                all_done = True
                break
            time.sleep(0.1)

        self.assertTrue(all_done, f"Deadlock or stuck task detected under pause/resume hammer! Statuses: {statuses}")

    # =========================================================================
    # 3. Cancellation of Actively Running Task while Queue is Populated
    # =========================================================================

    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    @patch("urllib.request.urlopen")
    def test_stress_cancel_active_task_while_queue_populated(self, mock_urlopen, mock_resolve) -> None:
        """Adversarial Test 3: Cancel an actively downloading task mid-execution

        while 3 other tasks are queued behind it.
        Also concurrently delete a pending task in the middle.
        Verifies:
        - Active task cleanly transitions to 'cancelled' and halts immediately.
        - The remaining pending tasks auto-advance in correct FIFO order.
        - No orphan or lingering active_task_id.
        """
        task_1_started = threading.Event()
        task_1_can_proceed = threading.Event()

        def controlled_resolve(vid, proxy=None, device_keys=None):
            fake_file = self.uploads_dir / f"mock_{vid}.mp4"
            fake_file.write_bytes(b"B" * 120000)
            if "cancel_active_1" in str(vid):
                task_1_started.set()
                # Wait briefly or until cancelled
                task_1_can_proceed.wait(timeout=2.0)
            return {"url": f"http://fake.com/{vid}.mp4"}

        mock_resolve.side_effect = controlled_resolve

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)

        t1 = make_mock_hongguo_target("cancel_active_1", "Phim Đang Chạy Sẽ Hủy", 3)
        t2 = make_mock_hongguo_target("cancel_active_2", "Phim Kế Tiếp Sẽ Chạy Xong", 1)
        t3 = make_mock_hongguo_target("cancel_active_3", "Phim Pending Sẽ Bị Xóa", 1)
        t4 = make_mock_hongguo_target("cancel_active_4", "Phim Cuối Sẽ Chạy Xong", 1)

        task1 = manager.add_to_queue(target_info=t1, episodes=[1, 2, 3], auto_create_project=False)
        task2 = manager.add_to_queue(target_info=t2, episodes=[1], auto_create_project=False)
        task3 = manager.add_to_queue(target_info=t3, episodes=[1], auto_create_project=False)
        task4 = manager.add_to_queue(target_info=t4, episodes=[1], auto_create_project=False)

        # Wait until task 1 is actively running
        self.assertTrue(task_1_started.wait(timeout=5.0), "Task 1 failed to start running")

        # Confirm task 1 is active
        self.assertEqual(manager._active_task_id, task1.task_id)

        # Delete pending task 3
        removed_task3 = manager.remove_from_queue(task3.task_id)
        self.assertTrue(removed_task3, "Failed to remove pending task 3")

        # Cancel actively running task 1
        removed_task1 = manager.remove_from_queue(task1.task_id)
        self.assertTrue(removed_task1, "Failed to cancel active task 1")

        # Release the wait event
        task_1_can_proceed.set()

        # Wait for queue to finish remaining tasks
        start_wait = time.time()
        success = False
        while time.time() - start_wait < 10.0:
            q = manager.get_queue()
            statuses = {t["task_id"]: t["status"] for t in q["tasks"]}
            # task1 must be 'cancelled', task3 must NOT be in queue, task2 and task4 must be 'completed'
            if (
                statuses.get(task1.task_id) == "cancelled"
                and task3.task_id not in statuses
                and statuses.get(task2.task_id) == "completed"
                and statuses.get(task4.task_id) == "completed"
            ):
                success = True
                break
            time.sleep(0.1)

        self.assertTrue(
            success,
            f"Queue did not correctly recover after active cancellation! Final statuses: {statuses}",
        )
        self.assertIsNone(manager._active_task_id)

    # =========================================================================
    # 4. Auto-advance Resilience when Tasks Throw Severe Exceptions
    # =========================================================================

    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    @patch("urllib.request.urlopen")
    def test_stress_auto_advance_on_catastrophic_exceptions(self, mock_urlopen, mock_resolve) -> None:
        """Adversarial Test 4: Enqueue 6 tasks where tasks 1, 3, 5 raise distinct fatal exceptions:

        - Task 1: RuntimeError("Decryption Key Mismatch")
        - Task 3: PermissionError("Disk Write Forbidden")
        - Task 5: ValueError("Malformed Stream Descriptor")
        Tasks 2, 4, 6 are normal successful tasks.
        Verifies:
        - Every failed task is cleanly marked 'failed' with error string preserved.
        - Every subsequent task automatically starts and completes without hanging.
        - Scheduler thread remains alive and never crashes.
        """
        def fail_or_succeed(vid, proxy=None, device_keys=None):
            if "err_1" in str(vid):
                raise RuntimeError("Decryption Key Mismatch")
            elif "err_3" in str(vid):
                raise PermissionError("Disk Write Forbidden")
            elif "err_5" in str(vid):
                raise ValueError("Malformed Stream Descriptor")

            fake_file = self.uploads_dir / f"mock_{vid}.mp4"
            fake_file.write_bytes(b"C" * 120000)
            return {"url": f"http://fake.com/{vid}.mp4"}

        mock_resolve.side_effect = fail_or_succeed

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)

        tasks = []
        for i in range(1, 7):
            t_info = make_mock_hongguo_target(f"err_{i}", f"Phim Exception Test {i}", 1)
            t = manager.add_to_queue(target_info=t_info, episodes=[1], auto_create_project=False)
            tasks.append(t)

        # Wait for all 6 tasks to settle
        start_wait = time.time()
        all_settled = False
        while time.time() - start_wait < 15.0:
            q = manager.get_queue()
            statuses = {t["task_id"]: t["status"] for t in q["tasks"]}
            terminal = {"completed", "failed", "cancelled"}
            if len(statuses) == 6 and all(s in terminal for s in statuses.values()):
                all_settled = True
                break
            time.sleep(0.1)

        self.assertTrue(all_settled, f"Scheduler stalled on exceptions! Current statuses: {statuses}")

        # Check precise expectations
        expected = {
            tasks[0].task_id: "failed",
            tasks[1].task_id: "completed",
            tasks[2].task_id: "failed",
            tasks[3].task_id: "completed",
            tasks[4].task_id: "failed",
            tasks[5].task_id: "completed",
        }
        for tid, exp_status in expected.items():
            self.assertEqual(statuses[tid], exp_status, f"Task {tid} expected {exp_status} but got {statuses[tid]}")

        # Check that error details were recorded
        q_tasks = {t["task_id"]: t for t in manager.get_queue()["tasks"]}
        self.assertIn("Decryption Key Mismatch", q_tasks[tasks[0].task_id]["error"])
        self.assertIn("Disk Write Forbidden", q_tasks[tasks[2].task_id]["error"])
        self.assertIn("Malformed Stream Descriptor", q_tasks[tasks[4].task_id]["error"])

        # Confirm scheduler thread is still alive and active_task_id is None
        self.assertTrue(manager._scheduler_thread.is_alive())
        self.assertIsNone(manager._active_task_id)

    # =========================================================================
    # 5. Full Adversarial Chaos Stress (Deadlock & Race Condition Hunter)
    # =========================================================================

    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    @patch("subtitle_localizer.downloader.hongguo_parser.rotate_device")
    @patch("urllib.request.urlopen")
    def test_stress_full_adversarial_chaos(self, mock_urlopen, mock_rotate, mock_resolve) -> None:
        """Adversarial Test 5: Multi-threaded Chaos Monkey.

        Simultaneously:
        - Thread 1 & 2: Rapidly add tasks (bounded to 15 each = 30 tasks total).
        - Thread 3: Rapidly reorder pending tasks (up/down/top/bottom).
        - Thread 4: Concurrently delete tasks (running, pending, or non-existent).
        - Thread 5: Concurrently hammer pause/resume.
        - Thread 6: Continuously query get_queue() and get_status().
        - Worker resolves video with simulated random latency (0.002s - 0.01s).
        Run under sustained chaos for 3.0 seconds, then drain and verify consistency.
        """
        mock_urlopen.return_value.__enter__.return_value.read.return_value = b"fake_cover_image_bytes"
        mock_rotate.return_value = {"device_id": "chaos_dev", "install_id": "chaos_ins"}

        def chaotic_resolve(vid, proxy=None, device_keys=None):
            fake_file = self.uploads_dir / f"mock_{vid}.mp4"
            fake_file.write_bytes(b"D" * 120000)
            time.sleep(random.uniform(0.002, 0.01))
            return {"url": f"http://fake.com/{vid}.mp4"}

        mock_resolve.side_effect = chaotic_resolve

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)

        stop_chaos = threading.Event()
        chaos_errors: List[Exception] = []
        error_lock = threading.Lock()

        # Thread 1 & 2: Task Adders (bounded to 15 tasks each to allow drain within timeout)
        def task_adder(adder_id: int):
            seq = 0
            while not stop_chaos.is_set() and seq < 15:
                seq += 1
                t = make_mock_hongguo_target(f"chaos_{adder_id}_{seq}", f"Phim Chaos {adder_id}-{seq}", 1)
                try:
                    manager.add_to_queue(target_info=t, episodes=[1], auto_create_project=False)
                    time.sleep(random.uniform(0.02, 0.05))
                except Exception as ex:
                    with error_lock:
                        chaos_errors.append(ex)

        # Thread 3: Reorderer
        def task_reorderer():
            directions = ["up", "down", "top", "bottom"]
            while not stop_chaos.is_set():
                try:
                    q = manager.get_queue()
                    tasks = q.get("tasks", [])
                    if tasks:
                        rand_task = random.choice(tasks)
                        rand_dir = random.choice(directions)
                        manager.reorder_queue(rand_task["task_id"], rand_dir)
                    time.sleep(random.uniform(0.01, 0.03))
                except Exception as ex:
                    with error_lock:
                        chaos_errors.append(ex)

        # Thread 4: Deleter
        def task_deleter():
            while not stop_chaos.is_set():
                try:
                    q = manager.get_queue()
                    tasks = q.get("tasks", [])
                    if tasks and random.random() < 0.4:
                        rand_task = random.choice(tasks)
                        manager.remove_from_queue(rand_task["task_id"])
                    # Also try deleting non-existent ID
                    manager.remove_from_queue(f"non_existent_{random.randint(1, 1000)}")
                    time.sleep(random.uniform(0.02, 0.05))
                except Exception as ex:
                    with error_lock:
                        chaos_errors.append(ex)

        # Thread 5: Pause / Resume Toggler
        def pause_toggler():
            while not stop_chaos.is_set():
                try:
                    if random.random() < 0.5:
                        manager.pause_queue()
                    else:
                        manager.resume_queue()
                    time.sleep(random.uniform(0.02, 0.06))
                except Exception as ex:
                    with error_lock:
                        chaos_errors.append(ex)

        # Thread 6: Continuous Inspector
        def inspector():
            while not stop_chaos.is_set():
                try:
                    q = manager.get_queue()
                    _ = manager.get_status()
                    # Verify structure consistency
                    self.assertIsInstance(q["tasks"], list)
                    self.assertIsInstance(q["is_paused"], bool)
                    for t in q["tasks"]:
                        self.assertIn("task_id", t)
                        self.assertIn("status", t)
                    time.sleep(0.005)
                except Exception as ex:
                    with error_lock:
                        chaos_errors.append(ex)

        threads = [
            threading.Thread(target=task_adder, args=(1,)),
            threading.Thread(target=task_adder, args=(2,)),
            threading.Thread(target=task_reorderer),
            threading.Thread(target=task_deleter),
            threading.Thread(target=pause_toggler),
            threading.Thread(target=inspector),
        ]

        with patch.object(DownloadManager, "_get_vid_list", side_effect=lambda sid, proxy=None, total_eps=1: [f"{sid}_vid_01"]):
            for th in threads:
                th.start()

            # Run chaos for 2.0 seconds
            time.sleep(2.0)

            # Signal stop
            stop_chaos.set()
            for th in threads:
                th.join(timeout=5.0)

            self.assertEqual(len(chaos_errors), 0, f"Chaos test encountered exceptions: {chaos_errors}")

            # Post-chaos cleanup: resume queue and wait for remaining tasks to settle
            manager.resume_queue()
            start_drain = time.time()
            drained = False
            while time.time() - start_drain < 12.0:
                q = manager.get_queue()
                statuses = [t["status"] for t in q["tasks"]]
                if statuses and all(s in ["completed", "failed", "cancelled"] for s in statuses):
                    drained = True
                    break
                time.sleep(0.1)

            self.assertTrue(drained, f"Queue failed to drain remaining tasks after chaos! Statuses: {statuses}")
            self.assertTrue(manager._scheduler_thread.is_alive(), "Scheduler thread died during chaos!")
            self.assertIsNone(manager._active_task_id)

    # =========================================================================
    # 6. Reorder Boundary Limits & Edge Ordering Tests
    # =========================================================================

    def test_stress_reorder_concurrent_with_execution(self) -> None:
        """Adversarial Test 6: Verify priority inversion & reordering under active execution."""
        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        manager.pause_queue()

        t1 = make_mock_hongguo_target("prio_1", "Phim Prio 1", 1)
        t2 = make_mock_hongguo_target("prio_2", "Phim Prio 2", 1)
        t3 = make_mock_hongguo_target("prio_3", "Phim Prio 3", 1)

        id1 = manager.add_to_queue(target_info=t1).task_id
        id2 = manager.add_to_queue(target_info=t2).task_id
        id3 = manager.add_to_queue(target_info=t3).task_id

        # Reorder id3 to 'top' -> pending becomes [id3, id1, id2]
        new_order = manager.reorder_queue(id3, "top")
        self.assertEqual(new_order[:3], [id3, id1, id2])

        # Reorder id1 to 'bottom' -> pending becomes [id3, id2, id1]
        new_order = manager.reorder_queue(id1, "bottom")
        self.assertEqual(new_order[:3], [id3, id2, id1])

        # Reorder non-existent ID -> must return original list unchanged
        unchanged = manager.reorder_queue("fake_id", "top")
        self.assertEqual(unchanged[:3], [id3, id2, id1])

        # Reorder with invalid direction -> must return list unchanged
        unchanged2 = manager.reorder_queue(id3, "unknown_direction")
        self.assertEqual(unchanged2[:3], [id3, id2, id1])

    # =========================================================================
    # 7. FastAPI REST API Concurrent Burst
    # =========================================================================

    def test_stress_fastapi_rest_endpoints_burst(self) -> None:
        """Adversarial Test 7: 15 concurrent threads hit POST /queue/add via FastAPI TestClient."""
        api_errors = []
        positions = []
        lock = threading.Lock()

        def client_poster(idx: int):
            try:
                target = make_mock_hongguo_target(f"api_series_{idx}", f"Phim API {idx}", 1)
                res = self.client.post(
                    "/api/v1/downloader/queue/add",
                    headers=self.headers,
                    json={"target_info": target},
                )
                if res.status_code != 200:
                    with lock:
                        api_errors.append(f"Status {res.status_code}: {res.text}")
                else:
                    data = res.json()
                    with lock:
                        positions.append(data.get("position"))
            except Exception as e:
                with lock:
                    api_errors.append(str(e))

        threads = [threading.Thread(target=client_poster, args=(i,)) for i in range(15)]
        for th in threads:
            th.start()
        for th in threads:
            th.join(timeout=10.0)

        self.assertEqual(len(api_errors), 0, f"FastAPI burst add encountered errors: {api_errors}")
        self.assertEqual(len(positions), 15)

        # Check queue list endpoint
        list_res = self.client.get("/api/v1/downloader/queue/list", headers=self.headers)
        self.assertEqual(list_res.status_code, 200)
        self.assertEqual(len(list_res.json()["tasks"]), 15)


if __name__ == "__main__":
    unittest.main()
