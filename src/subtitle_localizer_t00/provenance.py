from __future__ import annotations

import re
from typing import Any


REQUIRED_SOURCE_FIELDS = ("id", "official_url", "evidence_type", "pinned_ref", "license", "languages", "runtime", "hardware_notes", "verification_status")
HEX_COMMIT = re.compile(r"^[0-9a-f]{40}$")


def validate_source_matrix(matrix: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if matrix.get("schema_version") != "source-matrix-v1":
        errors.append("schema_version must be source-matrix-v1")
    sources = matrix.get("sources")
    if not isinstance(sources, list) or not sources:
        return [*errors, "sources must be a non-empty list"]
    ids: set[str] = set()
    for source in sources:
        if not isinstance(source, dict):
            errors.append("source entry must be an object")
            continue
        source_id = str(source.get("id", "unknown"))
        if source_id in ids:
            errors.append(f"duplicate source id: {source_id}")
        ids.add(source_id)
        missing = [field for field in REQUIRED_SOURCE_FIELDS if not source.get(field) and field != "pinned_ref"]
        if missing:
            errors.append(f"{source_id}: missing required fields: {', '.join(missing)}")
        status = source.get("verification_status")
        evidence_type = source.get("evidence_type")
        pinned_ref = str(source.get("pinned_ref", ""))
        if status == "verified" and evidence_type == "remote_git" and not HEX_COMMIT.fullmatch(pinned_ref):
            errors.append(f"{source_id}: verified remote_git source requires a 40-character pinned_ref")
        if status not in {"verified", "verification_failed", "pending"}:
            errors.append(f"{source_id}: verification_status must be verified, verification_failed, or pending")
        if status == "verification_failed" and not source.get("verification_error"):
            errors.append(f"{source_id}: verification_failed source requires verification_error")
    return errors
