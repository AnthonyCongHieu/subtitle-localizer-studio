from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

EXPECTED_LANGUAGES = ["zh", "ja", "ko", "en", "vi"]
EXPECTED_VFR_PTS = [0.0, 0.7, 1.8, 2.4, 3.7, 4.9]


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


def _is_hex_sha256(value: str) -> bool:
    return len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())


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
        raw_path = str(entry.get("path", ""))
        relative_path = Path(raw_path)
        if relative_path.is_absolute() or ".." in relative_path.parts or ":\\" in raw_path or ":/" in raw_path:
            errors.append(f"{label}: path must be relative and portable")
            continue
        ffprobe = entry.get("ffprobe")
        if not isinstance(ffprobe, dict):
            errors.append(f"{label}: ffprobe metadata is required")
        else:
            format_info = ffprobe.get("format", {})
            if isinstance(format_info, dict):
                fmt_filename = str(format_info.get("filename", ""))
                if ":\\" in fmt_filename or ":/" in fmt_filename or Path(fmt_filename).is_absolute():
                    errors.append(f"{label}: ffprobe format.filename contains absolute machine path; must be portable")
        digest = str(entry.get("sha256", ""))
        if not _is_hex_sha256(digest):
            errors.append(f"{label}: sha256 must be a 64-character lowercase hex digest")

        timing = entry.get("timing")
        if timing == "vfr":
            if not isinstance(ffprobe, dict):
                errors.append(f"{label}: vfr fixture requires ffprobe object")
            else:
                pts_list = ffprobe.get("frame_pts_seconds")
                if not isinstance(pts_list, list) or len(pts_list) != len(EXPECTED_VFR_PTS):
                    errors.append(f"{label}: vfr fixture requires frame_pts_seconds matching expected PTS length {len(EXPECTED_VFR_PTS)}")
                else:
                    if not all(isinstance(val, (int, float)) and abs(val - exp) < 0.001 for val, exp in zip(pts_list, EXPECTED_VFR_PTS)):
                        errors.append(f"{label}: frame_pts_seconds must match expected VFR PTS {EXPECTED_VFR_PTS}")
                    if not has_variable_frame_intervals([float(x) for x in pts_list]):
                        errors.append(f"{label}: frame_pts_seconds must have variable frame intervals")

        path = root / relative_path
        if verify_files and not path.exists():
            errors.append(f"{label}: fixture does not exist")
        elif verify_files and _sha256(path) != digest:
            errors.append(f"{label}: sha256 mismatch")
    return errors
