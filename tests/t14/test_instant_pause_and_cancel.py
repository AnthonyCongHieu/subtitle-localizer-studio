import time
import threading
import pytest
from pathlib import Path
from subtitle_localizer.downloader.proxy_pool import (
    ProxyPoolManager,
    ProxyKillSwitchTriggered,
)
from subtitle_localizer.service.downloader import (
    DownloadManager,
    DownloadTask,
    TaskCancelledException,
    TaskPausedException,
)

def test_proxy_pool_lease_aborts_immediately_when_deactivated():
    """Verify that threads waiting in lease_proxy abort immediately when pool is deactivated, without granting zombie leases."""
    mgr = ProxyPoolManager(raw_proxies=["http://127.0.0.1:10809"], max_leases_per_node=1)
    mgr.activate()
    assert mgr.is_active is True

    # Take the 1 lease
    leased = mgr.lease_proxy(task_name="Worker_1", timeout=1.0)
    cm = leased.__enter__()
    assert cm == "http://127.0.0.1:10809"

    # Worker 2 tries to lease in a background thread and should wait
    worker2_result = {"error": None, "leased": None}
    def worker2_proc():
        try:
            with mgr.lease_proxy(task_name="Worker_2", timeout=5.0) as p:
                worker2_result["leased"] = p
        except Exception as e:
            worker2_result["error"] = e

    t = threading.Thread(target=worker2_proc)
    t.start()
    time.sleep(0.1)

    # Now simulate Pause/Cancel calling deactivate()
    mgr.deactivate()
    assert mgr.is_active is False

    t.join(timeout=2.0)
    assert not t.is_alive(), "Worker 2 thread must exit promptly after deactivate"

    # Worker 2 should NOT have leased the proxy after deactivation
    assert worker2_result["leased"] is None
    assert worker2_result["error"] is not None
    assert isinstance(worker2_result["error"], (TaskCancelledException, TaskPausedException, ProxyKillSwitchTriggered))
    # Crucially, mgr.is_active must REMAIN False, not reactivated by worker2!
    assert mgr.is_active is False

    leased.__exit__(None, None, None)

def test_download_manager_instant_pause_flags():
    """Verify that pause_queue immediately sets _pause_requested and marks tasks paused."""
    dm = DownloadManager()
    task = DownloadTask(task_id="task_pause_test", title="Test Drama")
    task.status = "running"
    dm._tasks = [task]
    dm._active_task_id = task.task_id
    dm._current_task = task.to_dict()

    res = dm.pause_queue()
    assert res["success"] is True
    assert dm._is_paused is True
    assert getattr(dm, "_pause_requested", False) is True
    assert task.status == "paused"
    assert dm._current_task["status"] == "paused"

def test_download_manager_cancel_stops_running_task():
    """Verify that cancel() sets _cancel_requested and marks tasks cancelled."""
    dm = DownloadManager()
    task = DownloadTask(task_id="task_cancel_test", title="Test Drama")
    task.status = "running"
    dm._tasks = [task]
    dm._active_task_id = task.task_id
    dm._current_task = task.to_dict()

    dm.cancel()
    assert getattr(dm, "_cancel_requested", False) is True
    assert task.status == "cancelled"
    assert dm._current_task["status"] in ("cancelling", "cancelled")

def test_sliding_window_stops_immediately_on_pause(tmp_path, monkeypatch):
    """Verify that during a multi-episode run, calling pause_queue halts execution immediately without submitting remainder."""
    from unittest.mock import MagicMock
    dm = DownloadManager(uploads_dir=tmp_path)
    
    executed_eps = []
    def mock_single_ep(task, series_dir, ep_num, vid, clean_title, title, device_keys=None, proxy=None):
        executed_eps.append(ep_num)
        time.sleep(0.05)
        # Create a mock file
        p = series_dir / f"{clean_title}_Tap_{ep_num:02d}.mp4"
        p.write_bytes(b"dummy" * 25000)
        return p.stat().st_size, None

    monkeypatch.setattr(dm, "_download_hongguo_single_episode", mock_single_ep)

    task = DownloadTask(
        task_id="task_slide_test",
        title="Slide Drama",
        platform="hongguo",
        total_eps=20,
        concurrency=2,
    )
    task.episodes = list(range(1, 21))
    
    def background_pause():
        time.sleep(0.12)
        dm.pause_queue()

    t = threading.Thread(target=background_pause)
    t.start()

    series_dir = tmp_path / "Slide Drama"
    series_dir.mkdir(parents=True, exist_ok=True)
    dm._download_hongguo_task(task, series_dir)
    t.join(timeout=2.0)

    assert task.status == "paused"
    # Should only have executed a few episodes, far less than all 20!
    assert len(executed_eps) < 10, f"Expected instant stop but executed {len(executed_eps)} episodes"

