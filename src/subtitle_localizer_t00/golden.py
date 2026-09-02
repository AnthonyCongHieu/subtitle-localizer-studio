from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

REQUIRED_CLIP_FIELDS = {"id", "video_path", "sha256", "language", "orientation", "difficulty", "ground_truth_path", "pts_mode"}
VALID_LANGUAGES = {"zh", "ja", "ko", "en"}
VALID_ORIENTATIONS = {"portrait", "landscape"}
VALID_PTS_MODES = {"cfr", "vfr"}
VALID_DIFFICULTIES = {"clean", "difficult"}


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


def _is_hex_sha256(value: str) -> bool:
    return len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())


def validate_golden_manifest(manifest: dict[str, Any], repository_root: Path, verify_files: bool) -> list[str]:
    errors: list[str] = []
    if manifest.get("schema_version") != "golden-manifest-v1":
        errors.append("schema_version must be golden-manifest-v1")
    clips = manifest.get("clips")
    if not isinstance(clips, list) or not 4 <= len(clips) <= 8:
        errors.append("clips must contain 4 to 8 entries")
        return errors

    seen_ids: set[str] = set()
    found_languages: set[str] = set()
    found_orientations: set[str] = set()
    found_pts_modes: set[str] = set()

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

        raw_video_path = str(clip["video_path"])
        video_path = Path(raw_video_path)
        if not video_path.is_absolute() or _is_inside(video_path, repository_root):
            errors.append(f"{clip_id}: video_path must resolve outside the repository")

        raw_gt_path = str(clip["ground_truth_path"])
        gt_path = Path(raw_gt_path)
        if not gt_path.is_absolute() or _is_inside(gt_path, repository_root):
            errors.append(f"{clip_id}: ground_truth_path must resolve outside the repository")

        sha = str(clip["sha256"])
        if not _is_hex_sha256(sha):
            errors.append(f"{clip_id}: sha256 must be a 64-character lowercase hex digest")

        lang = clip.get("language")
        if lang not in VALID_LANGUAGES:
            errors.append(f"{clip_id}: unsupported language: {lang}")
        else:
            found_languages.add(lang)

        orientation = clip.get("orientation")
        if orientation not in VALID_ORIENTATIONS:
            errors.append(f"{clip_id}: orientation must be portrait or landscape")
        else:
            found_orientations.add(orientation)

        pts_mode = clip.get("pts_mode")
        if pts_mode not in VALID_PTS_MODES:
            errors.append(f"{clip_id}: pts_mode must be cfr or vfr")
        else:
            found_pts_modes.add(pts_mode)

        difficulty = clip.get("difficulty")
        if difficulty not in VALID_DIFFICULTIES:
            errors.append(f"{clip_id}: difficulty must be clean or difficult")

        if verify_files:
            if not video_path.exists():
                errors.append(f"{clip_id}: video_path does not exist")
            elif _sha256(video_path) != sha:
                errors.append(f"{clip_id}: sha256 mismatch")
            if not gt_path.exists():
                errors.append(f"{clip_id}: ground_truth_path does not exist")

    missing_langs = VALID_LANGUAGES - found_languages
    if missing_langs:
        errors.append(f"manifest missing required language coverage (must cover zh, ja, ko, en): {sorted(missing_langs)}")

    missing_orientations = VALID_ORIENTATIONS - found_orientations
    if missing_orientations:
        errors.append(f"manifest missing required orientation coverage (must cover both portrait and landscape): {sorted(missing_orientations)}")

    missing_pts = VALID_PTS_MODES - found_pts_modes
    if missing_pts:
        errors.append(f"manifest missing required pts_mode coverage (must cover both cfr and vfr): {sorted(missing_pts)}")

    return errors
