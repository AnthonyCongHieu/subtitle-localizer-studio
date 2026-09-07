"""
Red-First Test Suite for Embedded Xray Engine & Quality Node Benchmarker.
Verifies:
1. Node link parsing (VMess, VLESS, Trojan, Shadowsocks) into Xray outbounds.
2. Quality filtering and latency benchmarking (< 800ms threshold, drop dead nodes).
3. Dynamic config.json generation with HTTP 10809 & SOCKS 10808 inbounds.
4. XrayService process lifecycle and standby transitions.
"""

import os
import json
import base64
import pytest
from pathlib import Path

from subtitle_localizer.downloader.node_parser import (
    parse_node_url,
    convert_node_to_xray_outbound,
    ParsedNode,
)
from subtitle_localizer.downloader.node_benchmarker import (
    filter_and_rank_quality_nodes,
    NodeBenchmarkResult,
)
from subtitle_localizer.downloader.xray_service import (
    XrayService,
    generate_xray_config,
)


def test_parse_vmess_node():
    raw_vmess_data = {
        "v": "2",
        "ps": "Hong Kong Fast 01",
        "add": "hk01.example.com",
        "port": 443,
        "id": "11111111-2222-3333-4444-555555555555",
        "aid": 0,
        "scy": "auto",
        "net": "ws",
        "type": "none",
        "host": "hk01.example.com",
        "path": "/video-stream",
        "tls": "tls",
    }
    encoded = base64.b64encode(json.dumps(raw_vmess_data).encode("utf-8")).decode("utf-8")
    vmess_url = f"vmess://{encoded}"

    node = parse_node_url(vmess_url)
    assert node is not None
    assert node.protocol == "vmess"
    assert node.name == "Hong Kong Fast 01"
    assert node.host == "hk01.example.com"
    assert node.port == 443

    outbound = convert_node_to_xray_outbound(node)
    assert outbound["protocol"] == "vmess"
    assert outbound["settings"]["vnext"][0]["address"] == "hk01.example.com"
    assert outbound["settings"]["vnext"][0]["port"] == 443
    assert outbound["streamSettings"]["network"] == "ws"
    assert outbound["streamSettings"]["security"] == "tls"


def test_parse_vless_reality_node():
    vless_url = (
        "vless://22222222-3333-4444-5555-666666666666@sg01.example.com:443"
        "?type=tcp&security=reality&pbk=my_public_key&fp=chrome&sni=www.apple.com&sid=abcdef12#Singapore%20Reality%2001"
    )
    node = parse_node_url(vless_url)
    assert node is not None
    assert node.protocol == "vless"
    assert "Singapore" in node.name
    assert node.host == "sg01.example.com"
    assert node.port == 443

    outbound = convert_node_to_xray_outbound(node)
    assert outbound["protocol"] == "vless"
    assert outbound["settings"]["vnext"][0]["address"] == "sg01.example.com"
    assert outbound["streamSettings"]["security"] == "reality"
    assert outbound["streamSettings"]["realitySettings"]["serverName"] == "www.apple.com"


def test_parse_trojan_node():
    trojan_url = "trojan://secret_pass_123@jp01.example.com:443?security=tls&sni=jp01.example.com#Japan%20Trojan"
    node = parse_node_url(trojan_url)
    assert node is not None
    assert node.protocol == "trojan"
    assert node.host == "jp01.example.com"
    assert node.port == 443

    outbound = convert_node_to_xray_outbound(node)
    assert outbound["protocol"] == "trojan"
    assert outbound["settings"]["servers"][0]["address"] == "jp01.example.com"
    assert outbound["settings"]["servers"][0]["password"] == "secret_pass_123"


def test_parse_shadowsocks_node():
    # ss://[base64(method:password)]@host:port#name
    userinfo = base64.b64encode(b"aes-256-gcm:mypassword123").decode("utf-8")
    ss_url = f"ss://{userinfo}@us01.example.com:8388#US%20Shadowsocks"
    node = parse_node_url(ss_url)
    assert node is not None
    assert node.protocol == "shadowsocks"
    assert node.host == "us01.example.com"
    assert node.port == 8388

    outbound = convert_node_to_xray_outbound(node)
    assert outbound["protocol"] == "shadowsocks"
    assert outbound["settings"]["servers"][0]["address"] == "us01.example.com"
    assert outbound["settings"]["servers"][0]["method"] == "aes-256-gcm"


def test_quality_node_benchmarker_filtering():
    # Mock node benchmark results:
    nodes = [
        ParsedNode(name="Fast HK Node", protocol="vless", host="127.0.0.1", port=443),
        ParsedNode(name="Medium SG Node", protocol="vmess", host="127.0.0.1", port=443),
        ParsedNode(name="Slow US Node", protocol="trojan", host="127.0.0.1", port=443),
        ParsedNode(name="Dead Node", protocol="ss", host="127.0.0.1", port=443),
    ]

    mock_benchmark_results = [
        NodeBenchmarkResult(node=nodes[0], is_alive=True, latency_ms=145.0),
        NodeBenchmarkResult(node=nodes[1], is_alive=True, latency_ms=380.0),
        NodeBenchmarkResult(node=nodes[2], is_alive=True, latency_ms=1250.0),  # > 800ms threshold
        NodeBenchmarkResult(node=nodes[3], is_alive=False, latency_ms=9999.0), # Dead
    ]

    # Filter with max_latency_ms=800
    quality = filter_and_rank_quality_nodes(mock_benchmark_results, max_latency_ms=800.0)
    assert len(quality) == 2, "Must keep only nodes under 800ms"
    assert quality[0].node.name == "Fast HK Node"
    assert quality[0].latency_ms == 145.0
    assert quality[1].node.name == "Medium SG Node"
    assert quality[1].latency_ms == 380.0


def test_generate_xray_config():
    node = ParsedNode(name="Selected Fast Node", protocol="trojan", host="jp.example.com", port=443, raw_params={"password": "pwd"})
    cfg = generate_xray_config(node, http_port=10809, socks_port=10808)

    assert "inbounds" in cfg
    inbound_ports = [ib["port"] for ib in cfg["inbounds"]]
    assert 10809 in inbound_ports
    assert 10808 in inbound_ports

    assert "outbounds" in cfg
    assert len(cfg["outbounds"]) >= 2
    assert cfg["outbounds"][0]["protocol"] == "trojan"
    tags = [ob["tag"] for ob in cfg["outbounds"]]
    assert "direct" in tags


def test_parsed_node_serialization_and_cache():
    node = ParsedNode(
        name="Test HK VLESS",
        protocol="vless",
        host="hk.example.com",
        port=443,
        uuid_or_pass="1111-2222-3333",
        security="reality",
        network="tcp",
        sni="hk.example.com",
        raw_params={"pbk": "test_key"},
    )
    d = node.to_full_dict()
    restored = ParsedNode.from_full_dict(d)
    assert restored.name == node.name
    assert restored.protocol == "vless"
    assert restored.uuid_or_pass == "1111-2222-3333"
    assert restored.raw_params["pbk"] == "test_key"

    bench = NodeBenchmarkResult(node=node, is_alive=True, latency_ms=68.5)
    cache_d = bench.to_cache_dict()
    restored_bench = NodeBenchmarkResult.from_cache_dict(cache_d)
    assert restored_bench.is_alive is True
    assert restored_bench.latency_ms == 68.5
    assert restored_bench.node.name == "Test HK VLESS"


def test_xray_service_status_and_cache_loading(tmp_path):
    svc = XrayService(base_dir=tmp_path)
    # Seed cache
    node = ParsedNode(name="Fast Cached Node", protocol="trojan", host="127.0.0.1", port=443)
    bench = NodeBenchmarkResult(node=node, is_alive=True, latency_ms=55.0)
    svc.quality_cache_file.write_text(json.dumps([bench.to_cache_dict()]), encoding="utf-8")

    assert svc.load_cached_nodes() is True
    assert len(svc.quality_nodes) == 1
    assert svc.quality_nodes[0].node.name == "Fast Cached Node"

    status = svc.get_status()
    assert status["quality_nodes_count"] == 1
    assert status["http_port"] == 10809
    assert status["socks_port"] == 10808


def test_download_manager_auto_xray_integration(tmp_path):
    from subtitle_localizer.service.downloader import DownloadManager
    mgr = DownloadManager(uploads_dir=tmp_path)
    mgr._is_paused = True
    target = {"title": "Test Drama", "series_id": "999888777", "platform": "hongguo"}

    task = mgr.add_to_queue(
        target_info=target,
        output_dir=str(tmp_path),
        auto_xray=True,
    )
    assert task.auto_xray is True
    assert task.proxy == "http://127.0.0.1:10809"
    d = task.to_dict()
    assert d["auto_xray"] is True
    mgr.pause_queue()


def test_server_xray_endpoints(tmp_path):
    from fastapi.testclient import TestClient
    from subtitle_localizer.service.server import create_app
    from subtitle_localizer.persistence.database import Database
    from subtitle_localizer.persistence.repository import ProjectRepository

    db = Database(tmp_path / "test.db")
    db.migrate()
    repo = ProjectRepository(db)
    app = create_app(database=db, repo=repo, output_root=tmp_path)

    client = TestClient(app)
    resp = client.get("/api/v1/downloader/xray/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "installed" in data
    assert "running" in data
    assert "http_port" in data
    assert data["http_port"] == 10809

    toggle_resp = client.post("/api/v1/downloader/xray/toggle", json={"enabled": True})
    assert toggle_resp.status_code == 200
    assert toggle_resp.json()["is_enabled"] is True
    db.close()


def test_proxy_status_auto_xray_standby_awareness():
    from subtitle_localizer.service.downloader import check_proxy_status, test_proxy_connection
    from subtitle_localizer.downloader.xray_service import XrayService

    svc = XrayService.get_instance()
    svc.stop()
    svc.toggle_enabled(True)

    status = check_proxy_status("http://127.0.0.1:10809")
    assert status["enabled"] is True
    assert status["is_alive"] is True
    assert status.get("is_standby") is True
    assert status["mode"] == "auto_xray_standby"

    # Testing test_proxy_connection on 10809 during standby should return ok=True with standby note instead of WinError 10061
    result = test_proxy_connection("http://127.0.0.1:10809")
    assert result["ok"] is True
    assert result.get("is_standby") is True
    assert "Standby" in result.get("note", "")

