"""
Quality Node Benchmarker and Latency Engine.
Performs concurrent TCP handshake latency measurements, filters out dead or slow nodes,
and ranks the highest quality nodes for the embedded Xray engine.
"""

from __future__ import annotations

import time
import socket
from typing import List, Optional
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed

from .node_parser import ParsedNode


@dataclass
class NodeBenchmarkResult:
    node: ParsedNode
    is_alive: bool
    latency_ms: float
    error: Optional[str] = None

    def to_dict(self):
        return {
            "name": self.node.name,
            "protocol": self.node.protocol,
            "host": self.node.host,
            "port": self.node.port,
            "is_alive": self.is_alive,
            "latency_ms": round(self.latency_ms, 1) if self.is_alive else None,
            "error": self.error,
        }

    def to_cache_dict(self):
        return {
            "node": self.node.to_full_dict(),
            "is_alive": self.is_alive,
            "latency_ms": self.latency_ms,
            "error": self.error,
        }

    @classmethod
    def from_cache_dict(cls, data: dict) -> NodeBenchmarkResult:
        node = ParsedNode.from_full_dict(data["node"])
        return cls(
            node=node,
            is_alive=bool(data.get("is_alive", True)),
            latency_ms=float(data.get("latency_ms", 999.0)),
            error=data.get("error"),
        )


DISALLOWED_DOMAINS = {"gov.uk", "apple.com", "microsoft.com", "bing.com"}

def benchmark_single_node(node: ParsedNode, timeout: float = 1.5) -> NodeBenchmarkResult:
    """Benchmark a single proxy node via TCP socket connection."""
    host_lower = node.host.lower()
    if any(d in host_lower for d in DISALLOWED_DOMAINS):
        return NodeBenchmarkResult(node=node, is_alive=False, latency_ms=9999.0, error="Domain fronting fake host disallowed")

    t0 = time.perf_counter()
    try:
        with socket.create_connection((node.host, node.port), timeout=timeout):
            lat = (time.perf_counter() - t0) * 1000.0
            return NodeBenchmarkResult(node=node, is_alive=True, latency_ms=lat)
    except Exception as exc:
        return NodeBenchmarkResult(node=node, is_alive=False, latency_ms=9999.0, error=str(exc))


def benchmark_nodes_concurrent(
    nodes: List[ParsedNode],
    max_workers: int = 25,
    timeout: float = 1.5,
) -> List[NodeBenchmarkResult]:
    """Benchmark a list of nodes concurrently using a ThreadPoolExecutor."""
    results: List[NodeBenchmarkResult] = []
    if not nodes:
        return results

    with ThreadPoolExecutor(max_workers=min(max_workers, len(nodes))) as executor:
        future_map = {executor.submit(benchmark_single_node, n, timeout): n for n in nodes}
        for fut in as_completed(future_map):
            try:
                res = fut.result()
                results.append(res)
            except Exception as exc:
                n = future_map[fut]
                results.append(NodeBenchmarkResult(node=n, is_alive=False, latency_ms=9999.0, error=str(exc)))

    return results


def filter_and_rank_quality_nodes(
    benchmark_results: List[NodeBenchmarkResult],
    max_latency_ms: float = 800.0,
) -> List[NodeBenchmarkResult]:
    """
    Quality filter: Drops dead nodes and any nodes with latency exceeding max_latency_ms.
    Returns the surviving nodes sorted from fastest to slowest.
    """
    alive_quality = [
        r
        for r in benchmark_results
        if r.is_alive and r.latency_ms <= max_latency_ms
    ]

    # Sort ascending by latency
    alive_quality.sort(key=lambda r: r.latency_ms)
    return alive_quality
