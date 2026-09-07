"""
Zero-Leak Proxy Engine & Proxy Pool Manager.
Manages proxy lifecycle, per-thread concurrency leasing, remote DNS enforcement (Anti-DNS leak),
and Fail-Closed Kill-Switch protection.
"""

from __future__ import annotations

import time
import socket
import urllib.parse
import threading
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from contextlib import contextmanager
import collections


class ProxyKillSwitchTriggered(Exception):
    """Raised when strict kill-switch triggers to prevent any non-proxied outbound network traffic."""
    pass


class RealIPLeakException(Exception):
    """Raised when an attempt to route traffic through direct unproxied IP is detected in strict mode."""
    pass


def sanitize_proxy_url(url: str) -> str:
    """
    Sanitize and harden proxy URL.
    Enforces remote DNS resolution (socks5:// -> socks5h://) to prevent local DNS leaks via port 53 UDP.
    """
    clean = str(url).strip()
    if not clean:
        return ""
    if clean.startswith("socks5://"):
        return "socks5h://" + clean[len("socks5://"):]
    if clean.startswith("socks4://"):
        return "socks4a://" + clean[len("socks4://"):]
    if "://" not in clean:
        return f"http://{clean}"
    return clean


@dataclass
class ManagedProxyNode:
    url: str
    active_leases: int = 0
    is_alive: bool = True
    cooldown_until: float = 0.0
    failures: int = 0
    latency_ms: float = 0.0
    total_served: int = 0
    bytes_transferred: int = 0
    current_speed_bps: float = 0.0
    last_active_at: float = 0.0


class ProxyPoolManager:
    """
    Thread-safe Proxy Pool Manager with per-thread concurrency leasing,
    health tracking, circuit-breaker cooldown, realtime tunnel monitor and fail-closed kill-switch.
    """

    def __init__(
        self,
        raw_proxies: Optional[List[str]] = None,
        strict_proxy: bool = True,
        max_leases_per_node: int = 1,
    ):
        self.lock = threading.RLock()
        self.cond = threading.Condition(self.lock)
        self.strict_proxy = strict_proxy
        self.max_leases_per_node = max(1, int(max_leases_per_node))
        self.is_active: bool = False
        self.is_deactivated: bool = False
        self.nodes: Dict[str, ManagedProxyNode] = {}
        self.tunnel_logs: collections.deque = collections.deque(maxlen=100)

        if raw_proxies:
            self.load_proxies(raw_proxies)

    def load_proxies(self, raw_proxies: List[str]) -> None:
        """Parse, sanitize and register proxy list."""
        with self.cond:
            self.nodes.clear()
            for p in raw_proxies:
                sanitized = sanitize_proxy_url(p)
                if sanitized and sanitized not in self.nodes:
                    self.nodes[sanitized] = ManagedProxyNode(url=sanitized)
            self.cond.notify_all()

    def add_proxy(self, proxy_url: str) -> str:
        """Add a single proxy URL to pool."""
        sanitized = sanitize_proxy_url(proxy_url)
        if not sanitized:
            return ""
        with self.cond:
            if sanitized not in self.nodes:
                self.nodes[sanitized] = ManagedProxyNode(url=sanitized)
                self.cond.notify_all()
        return sanitized

    def activate(self) -> None:
        """Activate proxy pool for an active download session."""
        with self.lock:
            self.is_deactivated = False
            if not self.is_active:
                self.is_active = True
                self.add_tunnel_log(
                    task="Downloader",
                    proxy="SYSTEM",
                    message="Proxy Pool đã kích hoạt cho phiên tải video",
                    level="info",
                )

    def deactivate(self) -> None:
        """Deactivate proxy pool and return to standby mode when downloads finish or stop."""
        with self.lock:
            self.is_active = False
            self.is_deactivated = True
            for n in self.nodes.values():
                n.active_leases = 0
                n.current_speed_bps = 0.0
            self.add_tunnel_log(
                task="Downloader",
                proxy="SYSTEM",
                message="Phiên tải kết thúc/nghỉ. Proxy chuyển sang chế độ chờ (Standby)",
                level="info",
            )
            with self.cond:
                self.cond.notify_all()

    def add_tunnel_log(
        self,
        task: str,
        proxy: str,
        message: str,
        level: str = "info",
        speed_mbps: float = 0.0,
        bytes_transferred: int = 0,
    ) -> None:
        """Add an event to the real-time tunnel logs ring buffer."""
        with self.lock:
            self.tunnel_logs.append({
                "timestamp": time.time(),
                "time_str": time.strftime("%H:%M:%S"),
                "task": str(task),
                "proxy": str(proxy),
                "message": str(message),
                "level": level,
                "speed_mbps": round(speed_mbps, 2),
                "bytes_transferred": bytes_transferred,
            })

    def record_transfer(
        self,
        proxy_url: str,
        bytes_count: int,
        duration_sec: float,
        task_name: str = "",
    ) -> None:
        """Record transferred bytes, compute speed, update node metrics, and append a tunnel log."""
        if not proxy_url:
            return
        sanitized = sanitize_proxy_url(proxy_url)
        duration = max(0.001, float(duration_sec))
        speed_bps = float(bytes_count) / duration
        speed_mbps = round(speed_bps / (1024 * 1024), 2)
        with self.lock:
            if not self.is_active:
                self.is_active = True
            node = self.nodes.get(sanitized)
            if node:
                node.bytes_transferred += bytes_count
                node.current_speed_bps = speed_bps
                node.last_active_at = time.time()

        mb_str = f"{bytes_count / (1024 * 1024):.1f} MB"
        self.add_tunnel_log(
            task=task_name or "Transfer",
            proxy=sanitized,
            message=f"Đã truyền {mb_str} trong {duration:.1f}s ({speed_mbps} MB/s)",
            level="info",
            speed_mbps=speed_mbps,
            bytes_transferred=bytes_count,
        )

    def has_proxies(self) -> bool:
        """Check if pool contains at least one proxy node."""
        with self.lock:
            return len(self.nodes) > 0

    @contextmanager
    def lease_proxy(self, task_name: str = "", timeout: float = 30.0):
        """
        Lease a proxy for a worker thread.
        If all proxies are currently busy, threads block and wait up to timeout seconds.
        If no proxy is available after timeout:
          - If strict_proxy=True: raises ProxyKillSwitchTriggered to guarantee zero real-IP leak.
          - If strict_proxy=False: yields None (direct connection fallback).
        """
        start_wait = time.time()
        selected_node: Optional[ManagedProxyNode] = None

        with self.cond:
            while True:
                # Nếu pool đã bị deactivate (Standby/Tạm dừng/Hủy), lập tức hủy bỏ không cấp lease
                if self.is_deactivated:
                    raise ProxyKillSwitchTriggered(
                        f"[{task_name or 'Worker'}] Proxy Pool đã chuyển sang chế độ Standby/Tạm dừng. Hủy yêu cầu cấp tunnel."
                    )

                now = time.time()
                candidates = [
                    node
                    for node in self.nodes.values()
                    if node.is_alive and node.cooldown_until <= now and node.active_leases < self.max_leases_per_node
                ]
                if candidates:
                    # Pick candidate with least active leases, then lowest latency
                    candidates.sort(key=lambda n: (n.active_leases, n.latency_ms))
                    selected_node = candidates[0]
                    selected_node.active_leases += 1
                    selected_node.total_served += 1
                    if not self.is_active:
                        self.is_active = True
                    break

                elapsed = time.time() - start_wait
                remaining = timeout - elapsed
                if remaining <= 0:
                    break
                self.cond.wait(timeout=min(0.25, remaining))

        # Check outcome
        if selected_node is None:
            if self.strict_proxy:
                self.add_tunnel_log(
                    task=task_name or "Worker",
                    proxy="NONE",
                    message=f"Kill-Switch kích hoạt: Hết proxy khả dụng sau {timeout:.1f}s",
                    level="error",
                )
                raise ProxyKillSwitchTriggered(
                    f"[{task_name}] KILL-SWITCH KÍCH HOẠT: Không có proxy khả dụng sau {timeout:.1f}s! "
                    f"Hàng đợi tạm dừng để bảo vệ tuyệt đối IP thật (Zero Real-IP Leak)."
                )
            else:
                self.add_tunnel_log(
                    task=task_name or "Worker",
                    proxy="DIRECT",
                    message="Không có proxy, chuyển sang kết nối trực tiếp (Fallback)",
                    level="warn",
                )
                yield None
                return

        self.add_tunnel_log(
            task=task_name or "Worker",
            proxy=selected_node.url,
            message=f"Đã cấp quyền tunnel cho {task_name or 'worker'}",
            level="info",
        )

        try:
            yield selected_node.url
            with self.lock:
                selected_node.failures = 0
        except Exception as op_err:
            with self.lock:
                selected_node.failures += 1
                if selected_node.failures >= 2:
                    # Cooldown for 30s
                    selected_node.cooldown_until = time.time() + 30.0
            self.add_tunnel_log(
                task=task_name or "Worker",
                proxy=selected_node.url,
                message=f"Lỗi tunnel ({task_name}): {op_err}",
                level="error",
            )
            raise op_err
        finally:
            with self.cond:
                selected_node.active_leases = max(0, selected_node.active_leases - 1)
                self.cond.notify_all()

    def test_all_nodes(self, timeout: float = 3.0) -> List[Dict[str, Any]]:
        """Test TCP connectivity and latency for all registered nodes."""
        results = []
        with self.lock:
            nodes_copy = list(self.nodes.values())

        for node in nodes_copy:
            parsed = urllib.parse.urlparse(node.url)
            host = parsed.hostname or "127.0.0.1"
            port = parsed.port or (10808 if "socks" in parsed.scheme else 80)

            t0 = time.time()
            alive = False
            lat = 999.0
            try:
                with socket.create_connection((host, port), timeout=timeout):
                    alive = True
                    lat = round((time.time() - t0) * 1000, 1)
            except Exception:
                alive = False

            with self.lock:
                node.is_alive = alive
                node.latency_ms = lat if alive else 999.0

            results.append({
                "url": node.url,
                "is_alive": alive,
                "latency_ms": lat if alive else None,
            })

        return results

    def get_status(self) -> Dict[str, Any]:
        """Return aggregate health status of proxy pool, including bandwidth metrics and tunnel logs."""
        with self.lock:
            total = len(self.nodes)
            alive = sum(1 for n in self.nodes.values() if n.is_alive)
            active_leases = sum(n.active_leases for n in self.nodes.values()) if self.is_active else 0
            total_bytes = sum(n.bytes_transferred for n in self.nodes.values())
            now = time.time()
            total_speed_bps = (
                sum(n.current_speed_bps for n in self.nodes.values() if (now - n.last_active_at < 15.0))
                if self.is_active
                else 0.0
            )
            return {
                "status": "active" if self.is_active else "standby",
                "is_active": self.is_active,
                "total_nodes": total,
                "alive_nodes": alive,
                "active_leases": active_leases,
                "total_bytes_transferred": total_bytes,
                "total_speed_mbps": round(total_speed_bps / (1024 * 1024), 2) if self.is_active else 0.0,
                "strict_proxy": self.strict_proxy,
                "nodes": [
                    {
                        "url": n.url,
                        "is_alive": n.is_alive,
                        "latency_ms": n.latency_ms,
                        "active_leases": n.active_leases if self.is_active else 0,
                        "total_served": n.total_served,
                        "bytes_transferred": n.bytes_transferred,
                        "speed_mbps": round(n.current_speed_bps / (1024 * 1024), 2)
                        if (self.is_active and now - n.last_active_at < 15.0)
                        else 0.0,
                        "last_active_at": n.last_active_at,
                    }
                    for n in self.nodes.values()
                ],
                "tunnel_logs": list(self.tunnel_logs),
            }
