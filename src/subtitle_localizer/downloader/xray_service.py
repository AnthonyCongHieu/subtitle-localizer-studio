"""
Embedded Xray Service and Core Process Lifecycle Manager.
Handles automatic binary downloading, dynamic configuration generation,
headless execution with zero window popup, node switching, and auto-shutdown on idle.
"""

from __future__ import annotations

import os
import sys
import json
import time
import zipfile
import io
import logging
import urllib.request
import subprocess
import threading
from pathlib import Path
from typing import Dict, Any, Optional, List

logger = logging.getLogger("xray_service")

from .node_parser import (
    ParsedNode,
    parse_subscription_text,
    convert_node_to_xray_outbound,
)
from .node_benchmarker import (
    benchmark_nodes_concurrent,
    filter_and_rank_quality_nodes,
    NodeBenchmarkResult,
)


DEFAULT_SUBSCRIPTION_FEEDS = [
    "https://raw.githubusercontent.com/freefq/free/master/v2",
    "https://raw.githubusercontent.com/Pawdroid/Free-servers/main/sub",
]

XRAY_WINDOWS_64_RELEASE_URL = (
    "https://github.com/XTLS/Xray-core/releases/download/v26.3.27/Xray-windows-64.zip"
)


def generate_xray_config(
    node: ParsedNode,
    http_port: int = 10809,
    socks_port: int = 10808,
) -> Dict[str, Any]:
    """Generate a clean Xray-core configuration dictionary with HTTP and SOCKS inbounds."""
    outbound = convert_node_to_xray_outbound(node)

    return {
        "log": {
            "loglevel": "warning",
        },
        "inbounds": [
            {
                "tag": "http-in",
                "port": http_port,
                "listen": "127.0.0.1",
                "protocol": "http",
                "settings": {
                    "timeout": 60,
                },
            },
            {
                "tag": "socks-in",
                "port": socks_port,
                "listen": "127.0.0.1",
                "protocol": "socks",
                "settings": {
                    "auth": "noauth",
                    "udp": True,
                },
            },
        ],
        "outbounds": [
            outbound,
            {
                "tag": "direct",
                "protocol": "freedom",
                "settings": {},
            },
            {
                "tag": "blocked",
                "protocol": "blackhole",
                "settings": {},
            },
        ],
    }


class XrayService:
    """Singleton service managing headless Xray-core process and quality node pool."""

    _instance: Optional[XrayService] = None

    @classmethod
    def get_instance(cls) -> XrayService:
        if cls._instance is None:
            cls._instance = XrayService()
        return cls._instance

    def __init__(self, base_dir: Optional[Path] = None):
        self.lock = threading.RLock()
        root = base_dir or Path(__file__).resolve().parents[3]
        self.bin_dir = root / "bin" / "xray"
        self.xray_exe = self.bin_dir / "xray.exe"
        self.config_path = self.bin_dir / "config.json"
        self.cache_dir = root / "cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.quality_cache_file = self.cache_dir / "quality_nodes.json"

        self.http_port = 10809
        self.socks_port = 10808
        self.process: Optional[subprocess.Popen] = None
        self.active_node: Optional[ParsedNode] = None
        self.active_node_latency_ms: Optional[float] = None
        self.quality_nodes: List[NodeBenchmarkResult] = []
        self.is_enabled: bool = True
        self.is_downloading_binary: bool = False
        self.is_benchmarking: bool = False
        self.last_benchmarked_at: float = 0.0
        self.load_cached_nodes()

    def is_running(self) -> bool:
        """Check if xray.exe process is currently active."""
        with self.lock:
            if self.process is None:
                return False
            ret = self.process.poll()
            return ret is None

    def ensure_binary_installed(self, timeout: int = 45) -> bool:
        """Verify xray.exe exists, or auto-download from official GitHub release."""
        if self.xray_exe.exists() and self.xray_exe.stat().st_size > 1_000_000:
            return True

        with self.lock:
            if self.xray_exe.exists() and self.xray_exe.stat().st_size > 1_000_000:
                return True
            self.is_downloading_binary = True

        try:
            self.bin_dir.mkdir(parents=True, exist_ok=True)
            logger.info("Tự động tải Xray Core (%s)...", XRAY_WINDOWS_64_RELEASE_URL)
            req = urllib.request.Request(
                XRAY_WINDOWS_64_RELEASE_URL,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                zip_data = resp.read()

            with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
                for member in zf.namelist():
                    if member.lower() in ("xray.exe", "geoip.dat", "geosite.dat", "license"):
                        zf.extract(member, path=self.bin_dir)

            if self.xray_exe.exists():
                logger.info("Cài đặt Xray Core portable thành công!")
                return True
            return False
        except Exception as exc:
            logger.warning("Lỗi khi tải Xray Core: %s", exc)
            return False
        finally:
            with self.lock:
                self.is_downloading_binary = False

    def fetch_nodes_from_feeds(self, feeds: Optional[List[str]] = None) -> List[ParsedNode]:
        """Fetch and parse candidate proxy nodes from feeds."""
        feed_urls = feeds or DEFAULT_SUBSCRIPTION_FEEDS
        all_nodes: List[ParsedNode] = []
        seen = set()

        for u in feed_urls:
            try:
                req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=8) as resp:
                    raw = resp.read().decode("utf-8", errors="ignore")
                parsed = parse_subscription_text(raw)
                for n in parsed:
                    if (n.host, n.port) not in seen:
                        seen.add((n.host, n.port))
                        all_nodes.append(n)
            except Exception as exc:
                logger.warning("Lỗi đọc feed %s: %s", u, exc)

        return all_nodes

    def refresh_quality_nodes(
        self,
        custom_feed_or_nodes: Optional[str] = None,
        max_latency_ms: float = 800.0,
    ) -> List[NodeBenchmarkResult]:
        """Benchmark all candidates, strictly filter quality nodes (< 800ms), and pick fastest."""
        with self.lock:
            self.is_benchmarking = True

        try:
            candidates: List[ParsedNode] = []
            if custom_feed_or_nodes and custom_feed_or_nodes.strip():
                candidates = parse_subscription_text(custom_feed_or_nodes.strip())

            if not candidates:
                candidates = self.fetch_nodes_from_feeds()

            if not candidates:
                return []

            # Benchmark
            raw_results = benchmark_nodes_concurrent(candidates, max_workers=20, timeout=1.5)
            # Filter strictly by quality
            quality = filter_and_rank_quality_nodes(raw_results, max_latency_ms=max_latency_ms)

            with self.lock:
                self.quality_nodes = quality
                self.last_benchmarked_at = time.time()
                # Save to cache with full node credentials
                try:
                    cache_payload = [r.to_cache_dict() for r in quality[:20]]
                    self.quality_cache_file.write_text(json.dumps(cache_payload, indent=2, ensure_ascii=False), encoding="utf-8")
                except Exception as exc:
                    logger.warning("Không thể lưu cache node: %s", exc)

            return quality
        finally:
            with self.lock:
                self.is_benchmarking = False

    def load_cached_nodes(self) -> bool:
        """Load quality node pool from disk cache if available."""
        with self.lock:
            if not self.quality_cache_file.exists():
                return False
            try:
                raw = self.quality_cache_file.read_text(encoding="utf-8")
                data = json.loads(raw)
                loaded: List[NodeBenchmarkResult] = []
                for item in data:
                    if isinstance(item, dict) and "node" in item:
                        loaded.append(NodeBenchmarkResult.from_cache_dict(item))
                if loaded:
                    self.quality_nodes = loaded
                    try:
                        self.last_benchmarked_at = self.quality_cache_file.stat().st_mtime
                    except Exception:
                        self.last_benchmarked_at = time.time()
                    return True
            except Exception as exc:
                logger.warning("Không thể nạp danh sách node từ cache: %s", exc)
            return False

    def start(self, node: Optional[ParsedNode] = None) -> bool:
        """Start the headless Xray-core process with selected high-quality node."""
        with self.lock:
            if not self.ensure_binary_installed():
                return False

            chosen_node = node
            chosen_latency = None
            if chosen_node is None:
                if not self.quality_nodes:
                    self.refresh_quality_nodes()
                if self.quality_nodes:
                    chosen_node = self.quality_nodes[0].node
                    chosen_latency = self.quality_nodes[0].latency_ms

            if chosen_node is None:
                logger.warning("Không có node chất lượng nào khả dụng.")
                return False

            self.active_node = chosen_node
            self.active_node_latency_ms = chosen_latency

            # Generate config.json
            config_dict = generate_xray_config(
                chosen_node,
                http_port=self.http_port,
                socks_port=self.socks_port,
            )
            self.config_path.write_text(json.dumps(config_dict, indent=2), encoding="utf-8")

            # Stop existing process if running
            self._terminate_process()

            # Launch headless process with CREATE_NO_WINDOW
            creation_flags = 0x08000000 if sys.platform == "win32" else 0
            self.process = subprocess.Popen(
                [str(self.xray_exe), "run", "-c", str(self.config_path)],
                cwd=str(self.bin_dir),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creation_flags,
            )

            # Wait briefly to confirm it doesn't immediately crash
            time.sleep(0.5)
            if self.process.poll() is not None:
                logger.warning("Tiến trình Xray thoát sớm với exit code: %s", self.process.poll())
                return False

            logger.info("Xray Core đang chạy ngầm trên cổng %s (Node: %s - %sms)", self.http_port, chosen_node.name, chosen_latency or "?")
            return True

    def stop(self) -> bool:
        """Stop the background Xray process and return to standby."""
        with self.lock:
            self._terminate_process()
            self.active_node = None
            self.active_node_latency_ms = None
            return True

    def _terminate_process(self) -> None:
        if self.process is not None:
            try:
                self.process.terminate()
                self.process.wait(timeout=2.0)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
            self.process = None

    def get_status(self) -> Dict[str, Any]:
        """Return current real-time status of embedded Xray engine."""
        with self.lock:
            running = self.is_running()
            node_info = None
            if self.active_node:
                node_info = {
                    "name": self.active_node.name,
                    "protocol": self.active_node.protocol,
                    "host": self.active_node.host,
                    "port": self.active_node.port,
                    "latency_ms": round(self.active_node_latency_ms, 1) if self.active_node_latency_ms else None,
                }

            return {
                "installed": self.xray_exe.exists(),
                "running": running,
                "is_enabled": self.is_enabled,
                "is_downloading": self.is_downloading_binary,
                "is_benchmarking": self.is_benchmarking,
                "http_port": self.http_port,
                "socks_port": self.socks_port,
                "active_node": node_info,
                "quality_nodes_count": len(self.quality_nodes),
                "quality_nodes": [r.to_dict() for r in self.quality_nodes[:10]],
                "last_benchmarked_at": self.last_benchmarked_at,
            }

    def toggle_enabled(self, enabled: bool) -> bool:
        """Toggle Auto-Xray engine on or off."""
        with self.lock:
            self.is_enabled = bool(enabled)
            if not self.is_enabled and self.is_running():
                self.stop()
            return self.is_enabled

    def switch_node_by_name(self, name_or_host: str) -> bool:
        """Switch active Xray outbound to a specific node by name or host."""
        with self.lock:
            target_res = None
            for r in self.quality_nodes:
                if r.node.name == name_or_host or r.node.host == name_or_host:
                    target_res = r
                    break
            if not target_res:
                logger.warning("Không tìm thấy node phù hợp: %s", name_or_host)
                return False
            return self.start(node=target_res.node)

    def switch_to_fastest(self) -> bool:
        """Switch to the lowest latency node in quality node pool."""
        with self.lock:
            if not self.quality_nodes:
                self.refresh_quality_nodes()
            if self.quality_nodes:
                return self.start(node=self.quality_nodes[0].node)
            return False

    def get_active_node(self) -> Optional[ParsedNode]:
        """Return currently active node or fastest quality node if available."""
        with self.lock:
            if self.active_node:
                return self.active_node
            if self.quality_nodes:
                return self.quality_nodes[0].node
            return None

    def switch_to_next_quality_node(self) -> Optional[ParsedNode]:
        """Auto-Failover: Switch to the next available quality node when current one fails."""
        with self.lock:
            if not self.quality_nodes:
                return None
            cur_host = self.active_node.host if self.active_node else None
            next_res = None
            if cur_host:
                for idx, r in enumerate(self.quality_nodes):
                    if r.node.host == cur_host:
                        if idx + 1 < len(self.quality_nodes):
                            next_res = self.quality_nodes[idx + 1]
                        else:
                            next_res = self.quality_nodes[0]
                        break
            if not next_res:
                next_res = self.quality_nodes[0]

            logger.info("Auto-Failover: Chuyển sang node chất lượng tiếp theo: %s (%s)", next_res.node.name, next_res.node.host)
            ok = self.start(node=next_res.node)
            return next_res.node if ok else None

    def report_active_node_failure(self, reason: str = "") -> Optional[ParsedNode]:
        """Report failure on current active node, remove/penalize it, and failover immediately."""
        with self.lock:
            cur_host = self.active_node.host if self.active_node else None
            if cur_host and self.quality_nodes:
                self.quality_nodes = [r for r in self.quality_nodes if r.node.host != cur_host]
                logger.warning("Node '%s' bị lỗi (%s). Đã loại bỏ khỏi danh sách ưu tiên.", cur_host, reason)
            return self.switch_to_next_quality_node()
