from __future__ import annotations

from typing import Any

REQUIRED_BENCHMARK_INPUT_FIELDS = (
    "detector",
    "ocr",
    "translation",
    "timing",
    "memory",
    "disk",
    "utf8_gate",
)

VALID_DECISIONS = {"not_run", "measured", "failed"}
REQUIRED_MEASUREMENT_KEYS = {"wall_seconds", "fps", "peak_ram_bytes", "peak_vram_bytes", "disk_bytes"}
REQUIRED_QUALITY_KEYS = {"cue_recall", "timing_median_ms", "timing_p95_ms", "ocr_cer", "translation_score"}


def _is_non_empty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_positive_num(value: Any) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)) and value > 0


def _is_non_negative_num(value: Any) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)) and value >= 0


def validate_benchmark_input(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if payload.get("schema_version") != "benchmark-input-v1":
        errors.append("schema_version must be benchmark-input-v1")

    for field in REQUIRED_BENCHMARK_INPUT_FIELDS:
        if field not in payload:
            errors.append(f"missing required field: {field}")
        elif not isinstance(payload[field], dict):
            errors.append(f"{field} must be an object")

    # If top-level fields are missing or not dicts, return early for those
    if errors:
        return errors

    detector = payload.get("detector", {})
    if not _is_non_empty_str(detector.get("candidate")):
        errors.append("detector.candidate must be a non-empty string")
    if not _is_non_empty_str(detector.get("version")):
        errors.append("detector.version must be a non-empty string")

    ocr = payload.get("ocr", {})
    if not _is_non_empty_str(ocr.get("candidate")):
        errors.append("ocr.candidate must be a non-empty string")
    if not _is_non_empty_str(ocr.get("model")):
        errors.append("ocr.model must be a non-empty string")

    translation = payload.get("translation", {})
    if not _is_non_empty_str(translation.get("candidate")):
        errors.append("translation.candidate must be a non-empty string")
    if not _is_non_empty_str(translation.get("runtime")):
        errors.append("translation.runtime must be a non-empty string")

    timing = payload.get("timing", {})
    if not isinstance(timing.get("pts_required"), bool):
        errors.append("timing.pts_required must be a boolean")
    if not _is_positive_num(timing.get("median_error_ms")):
        errors.append("timing.median_error_ms must be a positive number")
    if not _is_positive_num(timing.get("p95_error_ms")):
        errors.append("timing.p95_error_ms must be a positive number")

    memory = payload.get("memory", {})
    if not _is_positive_num(memory.get("peak_ram_bytes")):
        errors.append("memory.peak_ram_bytes must be a positive number")
    if not _is_positive_num(memory.get("peak_vram_bytes")):
        errors.append("memory.peak_vram_bytes must be a positive number")

    disk = payload.get("disk", {})
    if not _is_positive_num(disk.get("cache_bytes")):
        errors.append("disk.cache_bytes must be a positive number")
    if not _is_positive_num(disk.get("output_bytes")):
        errors.append("disk.output_bytes must be a positive number")

    utf8_gate = payload.get("utf8_gate", {})
    if not isinstance(utf8_gate.get("reject_replacement_character"), bool):
        errors.append("utf8_gate.reject_replacement_character must be a boolean")
    if not isinstance(utf8_gate.get("reject_mojibake"), bool):
        errors.append("utf8_gate.reject_mojibake must be a boolean")

    return errors


def validate_benchmark_result(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if payload.get("schema_version") != "benchmark-result-v1":
        errors.append("schema_version must be benchmark-result-v1")

    decision = payload.get("decision")
    if decision not in VALID_DECISIONS:
        errors.append(f"decision must be one of {sorted(VALID_DECISIONS)}")

    reason = payload.get("reason")
    if not _is_non_empty_str(reason):
        errors.append("reason must be a non-empty string")

    measurements = payload.get("measurements")
    if not isinstance(measurements, dict):
        errors.append("measurements must be an object")
    else:
        missing_meas = REQUIRED_MEASUREMENT_KEYS - set(measurements.keys())
        if missing_meas:
            errors.append(f"measurements missing required keys: {sorted(missing_meas)}")
        elif decision == "measured":
            for key in REQUIRED_MEASUREMENT_KEYS:
                val = measurements.get(key)
                if not _is_non_negative_num(val):
                    errors.append(f"measurements.{key} must be a non-negative number for measured decision")

    quality_metrics = payload.get("quality_metrics")
    if decision == "measured":
        if not isinstance(quality_metrics, dict):
            errors.append("quality_metrics must be an object for measured decision")
        else:
            missing_qual = REQUIRED_QUALITY_KEYS - set(quality_metrics.keys())
            if missing_qual:
                errors.append(f"quality_metrics missing required keys: {sorted(missing_qual)}")
            else:
                for key in REQUIRED_QUALITY_KEYS:
                    val = quality_metrics.get(key)
                    if not _is_non_negative_num(val):
                        errors.append(f"quality_metrics.{key} must be a non-negative number")
    elif decision == "not_run":
        if quality_metrics is not None and not isinstance(quality_metrics, dict):
            errors.append("quality_metrics must be null or an object for not_run decision")

    return errors


def make_not_run_result(reason: str) -> dict[str, Any]:
    trimmed = reason.strip() if isinstance(reason, str) else ""
    return {
        "schema_version": "benchmark-result-v1",
        "decision": "not_run",
        "reason": trimmed if trimmed else "benchmark not run",
        "quality_metrics": None,
        "measurements": {
            "wall_seconds": None,
            "fps": None,
            "peak_ram_bytes": None,
            "peak_vram_bytes": None,
            "disk_bytes": None,
        },
    }
