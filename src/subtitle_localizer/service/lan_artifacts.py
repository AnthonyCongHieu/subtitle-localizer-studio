"""Safe local storage helpers for LAN job packages and result artifacts."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, BinaryIO, Dict, Iterable, Optional

from subtitle_localizer.service.lan_protocol import ArtifactMetadata, ProtocolError, safe_artifact_name, sha256_file

DEFAULT_MAX_PACKAGE_BYTES = 16 * 1024 * 1024
DEFAULT_MAX_SOURCE_BYTES = 20 * 1024 * 1024 * 1024
DEFAULT_MAX_RESULT_BYTES = 20 * 1024 * 1024 * 1024


def resolve_child(root: Path | str, *parts: str) -> Path:
    base = Path(root).resolve()
    target = base.joinpath(*(safe_artifact_name(part) for part in parts)).resolve()
    if target != base and base not in target.parents:
        raise ProtocolError("artifact path escapes storage root")
    return target


def atomic_write_bytes(path: Path | str, data: bytes, *, max_bytes: int) -> Path:
    if len(data) > max_bytes:
        raise ProtocolError("artifact exceeds size limit")
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".part", dir=str(target.parent))
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return target


def atomic_write_stream(
    path: Path | str, stream: BinaryIO, *, expected_size: int, expected_sha256: str,
    max_bytes: int, chunk_size: int = 1024 * 1024,
) -> Path:
    if expected_size < 0 or expected_size > max_bytes:
        raise ProtocolError("artifact exceeds size limit")
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    import hashlib
    digest = hashlib.sha256()
    written = 0
    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".part", dir=str(target.parent))
    try:
        with os.fdopen(fd, "wb") as output:
            while True:
                chunk = stream.read(chunk_size)
                if not chunk:
                    break
                written += len(chunk)
                if written > expected_size or written > max_bytes:
                    raise ProtocolError("artifact body exceeds declared size")
                digest.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if written != expected_size:
            raise ProtocolError("artifact size mismatch")
        if digest.hexdigest() != expected_sha256.lower():
            raise ProtocolError("artifact sha256 mismatch")
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return target


class CoordinatorArtifactStore:
    def __init__(self, root: Path | str, *, max_package_bytes: int = DEFAULT_MAX_PACKAGE_BYTES,
                 max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
                 max_result_bytes: int = DEFAULT_MAX_RESULT_BYTES) -> None:
        self.root = Path(root).resolve()
        self.max_package_bytes = max_package_bytes
        self.max_source_bytes = max_source_bytes
        self.max_result_bytes = max_result_bytes
        self.root.mkdir(parents=True, exist_ok=True)

    def job_dir(self, job_id: str) -> Path:
        path = resolve_child(self.root, job_id)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def package_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "package.json"

    def source_path(self, job_id: str, name: str) -> Path:
        return resolve_child(self.job_dir(job_id) / "source", name)

    def result_path(self, job_id: str, name: str) -> Path:
        return resolve_child(self.job_dir(job_id) / "results", name)

    def write_package(self, job_id: str, package: Dict[str, Any]) -> ArtifactMetadata:
        from subtitle_localizer.service.lan_protocol import canonical_json_bytes
        data = canonical_json_bytes(package)
        path = atomic_write_bytes(self.package_path(job_id), data, max_bytes=self.max_package_bytes)
        return ArtifactMetadata(path.name, "package", path.stat().st_size, sha256_file(path), "application/json")

    def put_source(self, job_id: str, source: Path | str, *, name: Optional[str] = None) -> ArtifactMetadata:
        source_path = Path(source)
        if not source_path.is_file():
            raise FileNotFoundError(source_path)
        artifact_name = safe_artifact_name(name or source_path.name)
        size = source_path.stat().st_size
        if size > self.max_source_bytes:
            raise ProtocolError("source exceeds size limit")
        target = self.source_path(job_id, artifact_name)
        with source_path.open("rb") as stream:
            atomic_write_stream(target, stream, expected_size=size, expected_sha256=sha256_file(source_path), max_bytes=self.max_source_bytes)
        return ArtifactMetadata(artifact_name, "source", size, sha256_file(target))

    def save_result(self, job_id: str, metadata: ArtifactMetadata, stream: BinaryIO) -> Path:
        return atomic_write_stream(self.result_path(job_id, metadata.name), stream,
                                   expected_size=metadata.size_bytes, expected_sha256=metadata.sha256,
                                   max_bytes=self.max_result_bytes)

    def verified_result(self, job_id: str, metadata: ArtifactMetadata) -> Path:
        path = self.result_path(job_id, metadata.name)
        if not path.is_file() or path.stat().st_size != metadata.size_bytes or sha256_file(path) != metadata.sha256:
            raise ProtocolError("result artifact verification failed")
        return path


class JobWorkspace:
    def __init__(self, root: Path | str, job_id: str) -> None:
        self.root = resolve_child(root, job_id)
        self.source_dir = self.root / "source"
        self.result_dir = self.root / "results"
        self.source_dir.mkdir(parents=True, exist_ok=True)
        self.result_dir.mkdir(parents=True, exist_ok=True)

    def source_path(self, name: str) -> Path:
        return resolve_child(self.source_dir, name)

    def result_path(self, name: str) -> Path:
        return resolve_child(self.result_dir, name)
