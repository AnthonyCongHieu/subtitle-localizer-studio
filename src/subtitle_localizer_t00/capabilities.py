from __future__ import annotations

import ctypes
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def parse_tool_version(output: str, tool_name: str) -> str | None:
    match = re.search(rf"\b{re.escape(tool_name)}\s+(?:version\s+)?([^\s]+)", output, re.IGNORECASE)
    return match.group(1) if match else None


def _command_output(command: list[str]) -> dict[str, Any]:
    try:
        completed = subprocess.run(command, check=False, capture_output=True, text=True, timeout=20)
    except (FileNotFoundError, subprocess.SubprocessError) as error:
        return {"available": False, "error": str(error)}
    output = (completed.stdout + "\n" + completed.stderr).strip()
    return {"available": completed.returncode == 0, "exit_code": completed.returncode, "output": output}


def _memory_bytes() -> int | None:
    if os.name != "nt":
        return None

    class MemoryStatus(ctypes.Structure):
        _fields_ = [
            ("dwLength", ctypes.c_ulong),
            ("dwMemoryLoad", ctypes.c_ulong),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    status = MemoryStatus()
    status.dwLength = ctypes.sizeof(status)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return int(status.ullTotalPhys)
    return None


def _gpu_probe() -> dict[str, Any]:
    report = _command_output(["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"])
    if not report.get("available"):
        return {"available": False, "error": report.get("error") or report.get("output", "nvidia-smi unavailable")}
    rows = [line.strip() for line in str(report["output"]).splitlines() if line.strip()]
    return {"available": True, "query": "name,memory.total,driver_version", "rows": rows}


def canonical_probe_payload(observed: dict[str, Any]) -> dict[str, Any]:
    runtime = observed.get("runtime", {})
    if "python" in observed:
        runtime = {**runtime, "python": observed["python"]}
    disk = observed.get("disk", {"available": False, "reason": "not probed"})
    return {"schema_version": "runtime-probe-v1", "runtime": runtime, "disk": disk, **{key: value for key, value in observed.items() if key not in {"runtime", "python", "disk"}}}


def collect_runtime_probe(workspace: Path) -> dict[str, Any]:
    ffmpeg = _command_output(["ffmpeg", "-hide_banner", "-version"])
    ffmpeg_output = str(ffmpeg.get("output", ""))
    ffmpeg_configuration = next((line for line in ffmpeg_output.splitlines() if line.startswith("configuration:")), "")
    ffmpeg_codecs = _command_output(["ffmpeg", "-hide_banner", "-codecs"])
    ffmpeg_encoders = _command_output(["ffmpeg", "-hide_banner", "-encoders"])
    node = _command_output(["node", "--version"])
    disk_usage = shutil.disk_usage(workspace)
    return canonical_probe_payload(
        {
            "collected_at_utc": datetime.now(UTC).isoformat(),
            "os": {"system": platform.system(), "release": platform.release(), "version": platform.version(), "machine": platform.machine()},
            "cpu": {"logical_cores": os.cpu_count(), "processor": platform.processor() or None},
            "memory": {"total_bytes": _memory_bytes()},
            "gpu": _gpu_probe(),
            "python": {"version": platform.python_version(), "executable": sys.executable},
            "runtime": {
                "node": {"available": node.get("available", False), "version": str(node.get("output", "")).strip() or None},
                "ffmpeg": {
                    "available": ffmpeg.get("available", False),
                    "version": parse_tool_version(ffmpeg_output, "ffmpeg"),
                    "libass_enabled": "--enable-libass" in ffmpeg_configuration,
                    "nvenc_compiled": "--enable-nvenc" in ffmpeg_configuration,
                    "h264_nvenc_encoder_listed": "h264_nvenc" in str(ffmpeg_encoders.get("output", "")),
                    "codec_list_available": ffmpeg_codecs.get("available", False),
                },
            },
            "disk": {"path": str(workspace), "total_bytes": disk_usage.total, "free_bytes": disk_usage.free},
        }
    )


def write_runtime_probe(destination: Path, workspace: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(collect_runtime_probe(workspace), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
