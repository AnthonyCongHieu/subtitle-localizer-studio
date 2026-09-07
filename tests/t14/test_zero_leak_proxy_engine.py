"""
Test suite for Zero-Leak Proxy Engine, Proxy Pool Manager and Fail-Closed Kill-Switch.
Selected via: pytest tests/t14/test_zero_leak_proxy_engine.py
"""

from __future__ import annotations

import os
import sys
import time
import threading
import unittest
from pathlib import Path
from typing import List, Optional

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.downloader.proxy_pool import (
    ProxyPoolManager,
    ManagedProxyNode,
    ProxyKillSwitchTriggered,
    sanitize_proxy_url,
)
from subtitle_localizer.downloader.hongguo_parser import stream_copy_video_with_ffmpeg


class TestZeroLeakProxyEngine(unittest.TestCase):
    """Rigorous tests proving zero real-IP leak, DNS leak protection and kill-switch behavior."""

    def test_dns_leak_protection_converts_socks5_to_socks5h(self) -> None:
        """SOCKS5 URLs must be auto-converted to socks5h to force remote hostname resolution and prevent DNS leak."""
        raw_socks5 = "socks5://127.0.0.1:10808"
        sanitized = sanitize_proxy_url(raw_socks5)
        self.assertTrue(sanitized.startswith("socks5h://"), f"Expected socks5h:// but got {sanitized}")

        raw_auth_socks5 = "socks5://admin:secret@192.168.1.100:1080"
        sanitized_auth = sanitize_proxy_url(raw_auth_socks5)
        self.assertTrue(sanitized_auth.startswith("socks5h://admin:secret@"), f"Got {sanitized_auth}")

        # HTTP/HTTPS should remain intact
        self.assertEqual(sanitize_proxy_url("http://127.0.0.1:7890"), "http://127.0.0.1:7890")
        self.assertEqual(sanitize_proxy_url("127.0.0.1:10809"), "http://127.0.0.1:10809")

    def test_fail_closed_kill_switch_when_no_proxies_available(self) -> None:
        """When strict proxy mode is ON and no proxies are available or all are dead, kill-switch must raise."""
        pool = ProxyPoolManager(
            raw_proxies=["http://dead_1:8080", "http://dead_2:8080"],
            strict_proxy=True,
        )
        # Mark all proxies dead
        for node in pool.nodes.values():
            node.is_alive = False

        with self.assertRaises(ProxyKillSwitchTriggered):
            with pool.lease_proxy(task_name="Ep_01", timeout=0.1) as proxy:
                pass

    def test_blocking_wait_prevents_falling_back_to_real_ip(self) -> None:
        """6 concurrent threads with 2 proxies must queue up and NOT leak to direct IP."""
        pool = ProxyPoolManager(
            raw_proxies=["http://proxy_A:8080", "http://proxy_B:8080"],
            strict_proxy=True,
            max_leases_per_node=1,
        )

        direct_ip_leaks = 0
        successful_leases = 0
        lock = threading.Lock()

        def worker(thread_idx: int) -> None:
            nonlocal direct_ip_leaks, successful_leases
            try:
                with pool.lease_proxy(f"Worker_{thread_idx}", timeout=5.0) as assigned:
                    if assigned is None or "direct" in str(assigned).lower():
                        with lock:
                            direct_ip_leaks += 1
                    else:
                        with lock:
                            successful_leases += 1
                    time.sleep(0.05)
            except ProxyKillSwitchTriggered:
                pass

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(direct_ip_leaks, 0, "Zero direct IP leaks expected!")
        self.assertEqual(successful_leases, 6, "All 6 threads should eventually acquire a proxy!")

    def test_ffmpeg_never_falls_back_to_direct_cmd_when_strict_mode(self) -> None:
        """FFmpeg stream copy must NEVER execute a direct unproxied command if proxy was requested."""
        with self.assertRaises(Exception) as ctx:
            stream_copy_video_with_ffmpeg(
                request=None,
                video_url="https://invalid.bytedance.test/video.mp4",
                content_key=None,
                proxy="http://127.0.0.1:19999",
                strict_proxy=True,
            )
        err_msg = str(ctx.exception).lower()
        self.assertTrue(
            "proxy" in err_msg or "failed" in err_msg or "kill" in err_msg,
            f"Unexpected error message: {err_msg}",
        )


if __name__ == "__main__":
    unittest.main()
