"""
Xray / V2Ray Node Link Parser and Converter.
Parses VMess, VLESS (Reality), Trojan, and Shadowsocks URLs into structured ParsedNode
and generates Xray core outbound configuration dictionaries.
"""

from __future__ import annotations

import json
import base64
import urllib.parse
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field


@dataclass
class ParsedNode:
    name: str
    protocol: str  # vmess, vless, trojan, shadowsocks
    host: str
    port: int
    uuid_or_pass: str = ""
    security: str = "none"  # tls, reality, none
    network: str = "tcp"    # tcp, ws, grpc, http
    path: str = ""
    sni: str = ""
    raw_params: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "protocol": self.protocol,
            "host": self.host,
            "port": self.port,
            "security": self.security,
            "network": self.network,
            "path": self.path,
            "sni": self.sni,
        }

    def to_full_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "protocol": self.protocol,
            "host": self.host,
            "port": self.port,
            "uuid_or_pass": self.uuid_or_pass,
            "security": self.security,
            "network": self.network,
            "path": self.path,
            "sni": self.sni,
            "raw_params": self.raw_params,
        }

    @classmethod
    def from_full_dict(cls, data: Dict[str, Any]) -> ParsedNode:
        return cls(
            name=data.get("name", ""),
            protocol=data.get("protocol", "vless"),
            host=data.get("host", ""),
            port=int(data.get("port", 443)),
            uuid_or_pass=data.get("uuid_or_pass", ""),
            security=data.get("security", "none"),
            network=data.get("network", "tcp"),
            path=data.get("path", ""),
            sni=data.get("sni", ""),
            raw_params=data.get("raw_params") or {},
        )


def _safe_b64decode(s: str) -> str:
    """Safely decode base64 strings with missing padding or URL-safe characters."""
    clean = s.strip().replace("-", "+").replace("_", "/")
    pad = len(clean) % 4
    if pad:
        clean += "=" * (4 - pad)
    return base64.b64decode(clean).decode("utf-8", errors="ignore")


def parse_vmess(url: str) -> Optional[ParsedNode]:
    """Parse vmess://base64_json format."""
    b64_part = url[8:].strip()
    try:
        decoded = _safe_b64decode(b64_part)
        data = json.loads(decoded)
    except Exception:
        return None

    if not isinstance(data, dict):
        return None

    host = str(data.get("add") or data.get("host") or "").strip()
    try:
        port = int(data.get("port", 443))
    except (ValueError, TypeError):
        port = 443

    if not host or port <= 0:
        return None

    name = str(data.get("ps") or f"VMess_{host}").strip()
    uuid = str(data.get("id") or "").strip()
    net = str(data.get("net") or "tcp").strip().lower()
    tls = str(data.get("tls") or "none").strip().lower()
    path = str(data.get("path") or "").strip()
    sni = str(data.get("sni") or data.get("host") or host).strip()

    return ParsedNode(
        name=name,
        protocol="vmess",
        host=host,
        port=port,
        uuid_or_pass=uuid,
        security="tls" if tls in ("tls", "1") else "none",
        network=net,
        path=path,
        sni=sni,
        raw_params=data,
    )


def parse_vless(url: str) -> Optional[ParsedNode]:
    """Parse vless://uuid@host:port?params#name format."""
    parsed = urllib.parse.urlparse(url)
    user_part = parsed.username or ""
    host = parsed.hostname or ""
    port = parsed.port or 443
    name = urllib.parse.unquote(parsed.fragment) or f"VLESS_{host}"

    if not host:
        return None

    query = dict(urllib.parse.parse_qsl(parsed.query))
    security = query.get("security", "none").lower()
    net = query.get("type", "tcp").lower()
    sni = query.get("sni", host)
    path = query.get("path", "")

    return ParsedNode(
        name=name,
        protocol="vless",
        host=host,
        port=port,
        uuid_or_pass=user_part,
        security=security,
        network=net,
        path=path,
        sni=sni,
        raw_params=query,
    )


def parse_trojan(url: str) -> Optional[ParsedNode]:
    """Parse trojan://password@host:port?params#name format."""
    parsed = urllib.parse.urlparse(url)
    password = parsed.username or ""
    host = parsed.hostname or ""
    port = parsed.port or 443
    name = urllib.parse.unquote(parsed.fragment) or f"Trojan_{host}"

    if not host:
        return None

    query = dict(urllib.parse.parse_qsl(parsed.query))
    security = query.get("security", "tls").lower()
    sni = query.get("sni", host)
    net = query.get("type", "tcp").lower()
    path = query.get("path", "")

    return ParsedNode(
        name=name,
        protocol="trojan",
        host=host,
        port=port,
        uuid_or_pass=password,
        security=security,
        network=net,
        path=path,
        sni=sni,
        raw_params=query,
    )


def parse_shadowsocks(url: str) -> Optional[ParsedNode]:
    """Parse ss://base64@host:port#name format."""
    parsed = urllib.parse.urlparse(url)
    name = urllib.parse.unquote(parsed.fragment) or "Shadowsocks"
    host = parsed.hostname or ""
    port = parsed.port or 8388
    method = "aes-256-gcm"
    password = ""

    # Legacy or SIP002 format
    if parsed.username:
        user_raw = parsed.username
        try:
            decoded = _safe_b64decode(user_raw)
            if ":" in decoded:
                method, password = decoded.split(":", 1)
        except Exception:
            method = user_raw
            password = parsed.password or ""
    else:
        # Whole authority might be base64
        netloc = parsed.netloc
        if "@" in netloc:
            part1, part2 = netloc.split("@", 1)
            try:
                dec = _safe_b64decode(part1)
                if ":" in dec:
                    method, password = dec.split(":", 1)
            except Exception:
                pass
            if ":" in part2:
                host, port_str = part2.split(":", 1)
                try:
                    port = int(port_str)
                except ValueError:
                    port = 8388
            else:
                host = part2
        else:
            try:
                dec = _safe_b64decode(netloc)
                if "@" in dec:
                    creds, server = dec.split("@", 1)
                    if ":" in creds:
                        method, password = creds.split(":", 1)
                    if ":" in server:
                        host, port_str = server.split(":", 1)
                        port = int(port_str)
            except Exception:
                pass

    if not host:
        return None

    return ParsedNode(
        name=name,
        protocol="shadowsocks",
        host=host,
        port=port,
        uuid_or_pass=password,
        raw_params={"method": method, "password": password},
    )


def parse_node_url(url: str) -> Optional[ParsedNode]:
    """Parse any supported proxy node protocol URL."""
    clean = str(url).strip()
    if not clean:
        return None
    if clean.startswith("vmess://"):
        return parse_vmess(clean)
    if clean.startswith("vless://"):
        return parse_vless(clean)
    if clean.startswith("trojan://"):
        return parse_trojan(clean)
    if clean.startswith("ss://"):
        return parse_shadowsocks(clean)
    return None


def convert_node_to_xray_outbound(node: ParsedNode) -> Dict[str, Any]:
    """Convert a ParsedNode into an Xray core outbound configuration dictionary."""
    stream_settings: Dict[str, Any] = {
        "network": node.network or "tcp",
    }

    if node.security == "tls":
        stream_settings["security"] = "tls"
        stream_settings["tlsSettings"] = {
            "serverName": node.sni or node.host,
            "allowInsecure": False,
        }
    elif node.security == "reality":
        stream_settings["security"] = "reality"
        stream_settings["realitySettings"] = {
            "serverName": node.sni or node.raw_params.get("sni") or node.host,
            "publicKey": node.raw_params.get("pbk", ""),
            "fingerprint": node.raw_params.get("fp", "chrome"),
            "shortId": node.raw_params.get("sid", ""),
            "spiderX": node.raw_params.get("spx", "/"),
        }

    if node.network == "ws":
        stream_settings["wsSettings"] = {
            "path": node.path or "/",
            "headers": {"Host": node.sni or node.host},
        }
    elif node.network == "grpc":
        stream_settings["grpcSettings"] = {
            "serviceName": node.raw_params.get("serviceName", ""),
        }

    if node.protocol == "vmess":
        return {
            "tag": "proxy",
            "protocol": "vmess",
            "settings": {
                "vnext": [
                    {
                        "address": node.host,
                        "port": node.port,
                        "users": [
                            {
                                "id": node.uuid_or_pass,
                                "alterId": 0,
                                "security": "auto",
                            }
                        ],
                    }
                ]
            },
            "streamSettings": stream_settings,
        }

    elif node.protocol == "vless":
        return {
            "tag": "proxy",
            "protocol": "vless",
            "settings": {
                "vnext": [
                    {
                        "address": node.host,
                        "port": node.port,
                        "users": [
                            {
                                "id": node.uuid_or_pass,
                                "encryption": "none",
                                "flow": node.raw_params.get("flow", ""),
                            }
                        ],
                    }
                ]
            },
            "streamSettings": stream_settings,
        }

    elif node.protocol == "trojan":
        return {
            "tag": "proxy",
            "protocol": "trojan",
            "settings": {
                "servers": [
                    {
                        "address": node.host,
                        "port": node.port,
                        "password": node.uuid_or_pass,
                    }
                ]
            },
            "streamSettings": stream_settings,
        }

    elif node.protocol == "shadowsocks":
        return {
            "tag": "proxy",
            "protocol": "shadowsocks",
            "settings": {
                "servers": [
                    {
                        "address": node.host,
                        "port": node.port,
                        "method": node.raw_params.get("method", "aes-256-gcm"),
                        "password": node.raw_params.get("password", node.uuid_or_pass),
                    }
                ]
            },
            "streamSettings": stream_settings,
        }

    raise ValueError(f"Unsupported proxy protocol: {node.protocol}")


def parse_subscription_text(raw_text: str) -> List[ParsedNode]:
    """Parse raw subscription content (plain or base64) into a list of valid ParsedNodes."""
    text = raw_text.strip()
    if not text:
        return []

    lines = []
    # Check if whole content is base64 encoded
    if not any(text.startswith(p) for p in ["vmess://", "vless://", "trojan://", "ss://"]):
        try:
            decoded = _safe_b64decode(text)
            lines = [l.strip() for l in decoded.splitlines() if l.strip()]
        except Exception:
            lines = [l.strip() for l in text.splitlines() if l.strip()]
    else:
        lines = [l.strip() for l in text.splitlines() if l.strip()]

    nodes = []
    seen = set()
    for line in lines:
        node = parse_node_url(line)
        if node and (node.host, node.port) not in seen:
            seen.add((node.host, node.port))
            nodes.append(node)

    return nodes
