"""
Test suite for Proxy Lifecycle Isolation and Standby Mode.
Verifies that proxy functionality only activates during active download execution
and automatically returns to Standby when idle, cancelled, or completed.
"""

from __future__ import annotations

import os
import sys
import time
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.downloader.proxy_pool import (
    ProxyPoolManager,
    ManagedProxyNode,
)
from subtitle_localizer.service.downloader import DownloadManager


class TestProxyLifecycleStandby(unittest.TestCase):
    """Rigorous tests proving proxy is strictly scoped to active downloads."""

    def test_proxy_pool_defaults_to_standby(self) -> None:
        """When initialized, ProxyPoolManager must be in standby mode with 0 active leases."""
        pool = ProxyPoolManager(raw_proxies=["http://127.0.0.1:10809"])
        self.assertFalse(pool.is_active, "Proxy pool must default to inactive (standby)")
        
        status = pool.get_status()
        self.assertEqual(status.get("status"), "standby")
        self.assertFalse(status.get("is_active"))
        self.assertEqual(status.get("active_leases"), 0)
        self.assertEqual(status.get("total_speed_mbps"), 0.0)

    def test_activate_and_deactivate_lifecycle(self) -> None:
        """Calling activate() enables live mode; calling deactivate() clears active leases and restores standby."""
        pool = ProxyPoolManager(raw_proxies=["http://127.0.0.1:10809"])
        
        pool.activate()
        self.assertTrue(pool.is_active)
        status_active = pool.get_status()
        self.assertEqual(status_active.get("status"), "active")
        self.assertTrue(status_active.get("is_active"))

        # Simulate transfer and active leases
        node = pool.nodes["http://127.0.0.1:10809"]
        node.active_leases = 2
        node.current_speed_bps = 5 * 1024 * 1024
        node.last_active_at = time.time()

        # Deactivate
        pool.deactivate()
        self.assertFalse(pool.is_active)
        status_idle = pool.get_status()
        self.assertEqual(status_idle.get("status"), "standby")
        self.assertFalse(status_idle.get("is_active"))
        self.assertEqual(status_idle.get("active_leases"), 0)
        self.assertEqual(status_idle.get("total_speed_mbps"), 0.0)
        self.assertEqual(node.active_leases, 0)
        self.assertEqual(node.current_speed_bps, 0.0)

        # Check tunnel logs recorded the lifecycle events
        logs = status_idle.get("tunnel_logs", [])
        log_messages = [l.get("message", "") for l in logs]
        self.assertTrue(any("kích hoạt" in m for m in log_messages))
        self.assertTrue(any("chế độ chờ" in m.lower() or "standby" in m.lower() for m in log_messages))

    def test_download_manager_reports_standby_when_idle(self) -> None:
        """DownloadManager must report standby mode when no download is actively running."""
        manager = DownloadManager(uploads_dir="uploads")
        manager.get_or_create_proxy_pool(raw_proxies=["http://127.0.0.1:10809"])
        
        # When no active task is executing
        status = manager.get_proxy_pool_status()
        self.assertEqual(status.get("status"), "standby")
        self.assertFalse(status.get("is_active"))
        self.assertEqual(status.get("active_leases"), 0)
        self.assertEqual(status.get("total_speed_mbps"), 0.0)

    def test_zero_system_proxy_side_effects(self) -> None:
        """Verify that running proxy pool never pollutes OS or process-level proxy environment variables."""
        env_keys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
        # Snapshot before
        before_env = {k: os.environ.get(k) for k in env_keys}

        pool = ProxyPoolManager(raw_proxies=["http://127.0.0.1:10809"])
        pool.activate()
        pool.record_transfer("http://127.0.0.1:10809", 1024 * 1024, 1.0, "TestTask")
        pool.deactivate()

        # Snapshot after
        after_env = {k: os.environ.get(k) for k in env_keys}
        self.assertEqual(before_env, after_env, "Environment variables must remain untouched by ProxyPool!")


if __name__ == "__main__":
    unittest.main()
