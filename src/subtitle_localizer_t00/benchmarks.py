from __future__ import annotations

from typing import Any


REQUIRED_BENCHMARK_FIELDS = ("detector", "ocr", "translation", "timing", "memory", "disk", "utf8_gate")


def validate_benchmark_input(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if payload.get("schema_version") != "benchmark-input-v1":
        errors.append("schema_version must be benchmark-input-v1")
    for field in REQUIRED_BENCHMARK_FIELDS:
        if field not in payload:
            errors.append(f"missing required field: {field}")
        elif not isinstance(payload[field], dict):
            errors.append(f"{field} must be an object")
    return errors


def make_not_run_result(reason: str) -> dict[str, Any]:
    return {
        "schema_version": "benchmark-result-v1",
        "decision": "not_run",
        "reason": reason,
        "quality_metrics": None,
        "measurements": {"wall_seconds": None, "fps": None, "peak_ram_bytes": None, "peak_vram_bytes": None, "disk_bytes": None},
    }
