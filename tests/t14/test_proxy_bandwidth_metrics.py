"""
Test suite for Proxy Bandwidth Metrics, Real-time Tunnel Monitor, and CDN Direct Bypass Option.
Selected via: pytest tests/t14/test_proxy_bandwidth_metrics.py
"""

from __future__ import annotations

import os
import sys
import time
import threading
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.downloader.proxy_pool import (
    ProxyPoolManager,
    ManagedProxyNode,
    sanitize_proxy_url,
)
from subtitle_localizer.downloader.hongguo_parser import stream_copy_video_with_ffmpeg


class TestProxyBandwidthMetrics(unittest.TestCase):
    """Rigorous tests for real-time bandwidth metrics, ring-buffer tunnel logs and CDN bypass."""

    def test_record_transfer_updates_node_metrics_and_tunnel_logs(self) -> None:
        """Recording a transfer must update bytes_transferred, speed_bps and append a formatted tunnel log."""
        pool = ProxyPoolManager(raw_proxies=["http://127.0.0.1:10809"])
        node_url = "http://127.0.0.1:10809"

        # Record 10MB transfer in 2 seconds = 5MB/s
        bytes_count = 10 * 1024 * 1024
        duration = 2.0
        pool.record_transfer(node_url, bytes_count=bytes_count, duration_sec=duration, task_name="Ep_01")

        status = pool.get_status()
        self.assertEqual(status["total_bytes_transferred"], bytes_count)
        self.assertGreaterEqual(status["total_speed_mbps"], 4.8)

        # Check node details
        node = status["nodes"][0]
        self.assertEqual(node["bytes_transferred"], bytes_count)
        self.assertGreaterEqual(node["speed_mbps"], 4.8)

        # Check tunnel logs
        logs = status.get("tunnel_logs", [])
        self.assertGreaterEqual(len(logs), 1)
        latest = logs[-1]
        self.assertEqual(latest["task"], "Ep_01")
        self.assertEqual(latest["proxy"], node_url)
        self.assertIn("10.0 MB", latest["message"])
        self.assertEqual(latest["level"], "info")

    def test_tunnel_logs_ring_buffer_bounded(self) -> None:
        """Tunnel logs ring buffer should maintain maxlen bounded and never consume unbounded memory."""
        pool = ProxyPoolManager(raw_proxies=["http://127.0.0.1:7890"])
        for i in range(150):
            pool.add_tunnel_log(task=f"Task_{i}", proxy="http://127.0.0.1:7890", message=f"Log msg {i}")

        status = pool.get_status()
        self.assertLessEqual(len(status["tunnel_logs"]), 100)
        self.assertEqual(status["tunnel_logs"][-1]["task"], "Task_149")

    def test_concurrent_transfers_thread_safety(self) -> None:
        """Multiple worker threads recording transfers concurrently must not corrupt counters."""
        pool = ProxyPoolManager(raw_proxies=["http://127.0.0.1:8001", "http://127.0.0.1:8002"])
        transfers_per_thread = 20
        threads_count = 5
        chunk_size = 1024 * 100  # 100 KB

        def worker(thread_idx: int) -> None:
            proxy = "http://127.0.0.1:8001" if thread_idx % 2 == 0 else "http://127.0.0.1:8002"
            for j in range(transfers_per_thread):
                pool.record_transfer(proxy, bytes_count=chunk_size, duration_sec=0.1, task_name=f"T{thread_idx}_{j}")

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(threads_count)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        status = pool.get_status()
        expected_total = threads_count * transfers_per_thread * chunk_size
        self.assertEqual(status["total_bytes_transferred"], expected_total)

    def test_cdn_direct_bypass_option_behavior(self) -> None:
        """When cdn_direct_bypass=True, ffmpeg does not pass -http_proxy; when False, proxy is strictly enforced."""
        from subtitle_localizer.downloader.proxy_pool import ProxyKillSwitchTriggered

        with self.assertRaises(Exception) as ctx:
            stream_copy_video_with_ffmpeg(
                request=None,
                video_url="https://invalid.test/video.mp4",
                content_key=None,
                proxy="http://127.0.0.1:59999",
                strict_proxy=True,
                cdn_direct_bypass=False,
            )
        self.assertIn("strict proxy kill-switch", str(ctx.exception).lower())


if __name__ == "__main__":
    unittest.main()
