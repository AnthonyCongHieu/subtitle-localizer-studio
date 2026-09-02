from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any


EXPECTED_LANGUAGES = ["zh", "ja", "ko", "en", "vi"]


def has_variable_frame_intervals(timestamps: list[float], tolerance: float = 0.000001) -> bool:
    if len(timestamps) < 3:
        return False
    intervals = [right - left for left, right in zip(timestamps, timestamps[1:])]
    return any(abs(interval - intervals[0]) > tolerance for interval in intervals[1:])


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_fixture_manifest(manifest: dict[str, Any], root: Path, verify_files: bool) -> list[str]:
    errors: list[str] = []
    if manifest.get("schema_version") != "synthetic-fixture-manifest-v1":
        errors.append("schema_version must be synthetic-fixture-manifest-v1")
    fixtures = manifest.get("fixtures")
    if not isinstance(fixtures, list):
        return [*errors, "fixtures must be a list"]
    timings = {entry.get("timing") for entry in fixtures if isinstance(entry, dict)}
    if timings != {"cfr", "vfr"}:
        errors.append("fixtures must contain exactly one cfr and one vfr fixture")
    for entry in fixtures:
        if not isinstance(entry, dict):
            errors.append("fixture entry must be an object")
            continue
        label = str(entry.get("id", "unknown"))
        if entry.get("languages") != EXPECTED_LANGUAGES:
            errors.append(f"{label}: languages must be {EXPECTED_LANGUAGES}")
        relative_path = Path(str(entry.get("path", "")))
        if relative_path.is_absolute() or ".." in relative_path.parts:
            errors.append(f"{label}: path must be relative to the fixture directory")
            continue
        if not isinstance(entry.get("ffprobe"), dict):
            errors.append(f"{label}: ffprobe metadata is required")
        digest = str(entry.get("sha256", ""))
        if len(digest) != 64:
            errors.append(f"{label}: sha256 is required")
        path = root / relative_path
        if verify_files and not path.exists():
            errors.append(f"{label}: fixture does not exist")
        elif verify_files and _sha256(path) != digest:
            errors.append(f"{label}: sha256 mismatch")
    return errors
