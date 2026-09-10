"""Versioned wire contracts for coordinator/worker artifact exchange."""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

PROTOCOL_VERSION = "lan-worker-v1"
DEFAULT_STAGE_PLAN = ["download", "prepare", "ocr", "translate", "publish"]
ALL_STAGES = {"download", "prepare", "ocr", "translate", "dub", "export", "publish"}
_SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class ProtocolError(ValueError):
    """Raised when an artifact package violates the LAN wire contract."""


def safe_artifact_name(name: str) -> str:
    value = str(name or "")
    if not _SAFE_NAME.fullmatch(value) or value in {".", ".."}:
        raise ProtocolError("unsafe artifact name")
    return value


def sha256_file(path: Path | str, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class ArtifactMetadata:
    name: str
    kind: str
    size_bytes: int
    sha256: str
    content_type: str = "application/octet-stream"
    download_url: Optional[str] = None

    def __post_init__(self) -> None:
        safe_artifact_name(self.name)
        if self.size_bytes < 0:
            raise ProtocolError("artifact size must be non-negative")
        if not re.fullmatch(r"[0-9a-f]{64}", self.sha256):
            raise ProtocolError("artifact sha256 is invalid")

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ArtifactMetadata":
        return cls(
            name=str(data["name"]), kind=str(data.get("kind") or "file"),
            size_bytes=int(data["size_bytes"]), sha256=str(data["sha256"]).lower(),
            content_type=str(data.get("content_type") or "application/octet-stream"),
            download_url=data.get("download_url"),
        )


@dataclass
class JobPackage:
    job_id: str
    project_id: str
    project: Dict[str, Any]
    settings: Dict[str, Any] = field(default_factory=dict)
    cues: List[Dict[str, Any]] = field(default_factory=list)
    regions: List[Dict[str, Any]] = field(default_factory=list)
    stage_plan: List[str] = field(default_factory=lambda: list(DEFAULT_STAGE_PLAN))
    artifacts: List[ArtifactMetadata] = field(default_factory=list)
    protocol_version: str = PROTOCOL_VERSION

    def validate(self) -> None:
        if self.protocol_version != PROTOCOL_VERSION:
            raise ProtocolError(f"unsupported protocol_version: {self.protocol_version}")
        if not self.job_id or not self.project_id:
            raise ProtocolError("job_id and project_id are required")
        unknown = set(self.stage_plan) - ALL_STAGES
        if unknown:
            raise ProtocolError(f"unsupported stages: {sorted(unknown)}")
        if len(set(self.stage_plan)) != len(self.stage_plan):
            raise ProtocolError("stage plan contains duplicates")
        if not self.stage_plan:
            raise ProtocolError("stage plan must not be empty")

    def to_dict(self) -> Dict[str, Any]:
        self.validate()
        value = asdict(self)
        value["artifacts"] = [item.to_dict() for item in self.artifacts]
        return value

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "JobPackage":
        package = cls(
            job_id=str(data["job_id"]), project_id=str(data["project_id"]),
            project=dict(data.get("project") or {}), settings=dict(data.get("settings") or {}),
            cues=list(data.get("cues") or []), regions=list(data.get("regions") or []),
            stage_plan=list(data.get("stage_plan") or DEFAULT_STAGE_PLAN),
            artifacts=[ArtifactMetadata.from_dict(item) for item in data.get("artifacts") or []],
            protocol_version=str(data.get("protocol_version") or ""),
        )
        package.validate()
        return package


@dataclass
class ResultPackage:
    job_id: str
    project_id: str
    project: Dict[str, Any]
    cues: List[Dict[str, Any]]
    stage_runs: List[Dict[str, Any]]
    artifacts: List[ArtifactMetadata] = field(default_factory=list)
    protocol_version: str = PROTOCOL_VERSION

    def to_dict(self) -> Dict[str, Any]:
        return {**asdict(self), "artifacts": [item.to_dict() for item in self.artifacts]}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ResultPackage":
        if data.get("protocol_version") != PROTOCOL_VERSION:
            raise ProtocolError("unsupported result protocol_version")
        return cls(
            job_id=str(data["job_id"]), project_id=str(data["project_id"]),
            project=dict(data["project"]), cues=list(data.get("cues") or []),
            stage_runs=list(data.get("stage_runs") or []),
            artifacts=[ArtifactMetadata.from_dict(item) for item in (data.get("artifacts") or [])],
        )


def canonical_json_bytes(value: Dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
