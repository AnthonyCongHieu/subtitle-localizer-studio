from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any


REQUIRED_CLIP_FIELDS = {"id", "video_path", "sha256", "language", "orientation", "difficulty", "ground_truth_path", "pts_mode"}
VALID_LANGUAGES = {"zh", "ja", "ko", "en"}
VALID_ORIENTATIONS = {"portrait", "landscape"}
VALID_PTS_MODES = {"cfr", "vfr"}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_inside(path: Path, repository_root: Path) -> bool:
    try:
        path.resolve().relative_to(repository_root.resolve())
    except ValueError:
        return False
    return True


def validate_golden_manifest(manifest: dict[str, Any], repository_root: Path, verify_files: bool) -> list[str]:
    errors: list[str] = []
    if manifest.get("schema_version") != "golden-manifest-v1":
        errors.append("schema_version must be golden-manifest-v1")
    clips = manifest.get("clips")
    if not isinstance(clips, list) or not 4 <= len(clips) <= 8:
        errors.append("clips must contain 4 to 8 entries")
        return errors
    seen_ids: set[str] = set()
    for index, clip in enumerate(clips):
        label = f"clips[{index}]"
        if not isinstance(clip, dict):
            errors.append(f"{label} must be an object")
            continue
        missing = REQUIRED_CLIP_FIELDS - set(clip)
        if missing:
            errors.append(f"{label} missing required fields: {', '.join(sorted(missing))}")
            continue
        clip_id = str(clip["id"])
        if clip_id in seen_ids:
            errors.append(f"duplicate clip id: {clip_id}")
        seen_ids.add(clip_id)
        video_path = Path(str(clip["video_path"]))
        if not video_path.is_absolute() or _is_inside(video_path, repository_root):
            errors.append(f"{clip_id}: video_path must resolve outside the repository")
        if len(str(clip["sha256"])) != 64 or any(character not in "0123456789abcdef" for character in str(clip["sha256"]).lower()):
            errors.append(f"{clip_id}: sha256 must be a lowercase hexadecimal digest")
        if clip["language"] not in VALID_LANGUAGES:
            errors.append(f"{clip_id}: unsupported language")
        if clip["orientation"] not in VALID_ORIENTATIONS:
            errors.append(f"{clip_id}: orientation must be portrait or landscape")
        if clip["pts_mode"] not in VALID_PTS_MODES:
            errors.append(f"{clip_id}: pts_mode must be cfr or vfr")
        if verify_files and video_path.exists() and _sha256(video_path) != clip["sha256"]:
            errors.append(f"{clip_id}: sha256 mismatch")
        if verify_files and not video_path.exists():
            errors.append(f"{clip_id}: video_path does not exist")
        ground_truth_path = Path(str(clip["ground_truth_path"]))
        if verify_files and not ground_truth_path.exists():
            errors.append(f"{clip_id}: ground_truth_path does not exist")
    return errors
