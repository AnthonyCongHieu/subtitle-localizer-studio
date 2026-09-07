import pytest
from subtitle_localizer.service.downloader import DownloadManager, DownloadTask
from subtitle_localizer.downloader.xray_service import XrayService
from subtitle_localizer.downloader.node_parser import ParsedNode
from subtitle_localizer.downloader.node_benchmarker import NodeBenchmarkResult

def test_instant_pause_stops_running_task():
    mgr = DownloadManager()
    mgr._is_paused = False
    
    task = DownloadTask(
        task_id="test_pause_task",
        title="Test Pause Series",
        platform="hongguo",
        total_eps=10,
    )
    task.status = "running"
    mgr._tasks = [task]
    mgr._active_task_id = task.task_id
    mgr._current_task = task.to_dict()

    res = mgr.pause_queue()
    assert res["success"] is True
    assert mgr._is_paused is True
    assert getattr(mgr, "_pause_requested", False) is True
    assert task.status == "paused"

    res2 = mgr.resume_queue()
    assert res2["success"] is True
    assert mgr._is_paused is False
    assert getattr(mgr, "_pause_requested", False) is False
    assert task.status == "pending"

def test_xray_service_auto_failover(monkeypatch):
    svc = XrayService.get_instance()
    
    def fake_start(node=None):
        svc.active_node = node
        return True

    monkeypatch.setattr(svc, "start", fake_start)

    n1 = ParsedNode(name="Node1", protocol="trojan", host="104.16.174.36", port=443, uuid_or_pass="p1")
    n2 = ParsedNode(name="Node2", protocol="trojan", host="104.18.152.230", port=443, uuid_or_pass="p2")
    
    svc.quality_nodes = [
        NodeBenchmarkResult(node=n1, is_alive=True, latency_ms=100.0),
        NodeBenchmarkResult(node=n2, is_alive=True, latency_ms=120.0),
    ]
    svc.active_node = n1

    next_node = svc.report_active_node_failure("Connection reset")
    assert next_node is not None
    assert next_node.host == "104.18.152.230"
    assert svc.active_node.host == "104.18.152.230"
    assert len(svc.quality_nodes) == 1
    assert svc.quality_nodes[0].node.host == "104.18.152.230"

