from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class RegionTrackV1:
    """Đại diện vùng chữ phụ đề (ROI) được chuẩn hóa (0.0 -> 1.0)."""
    region_id: str
    x: float = 0.0
    y: float = 0.0
    width: float = 1.0
    height: float = 1.0
    valid_start_pts: float = 0.0
    valid_end_pts: float = float("inf")
    keyframe_overrides: Dict[float, Dict[str, float]] = field(default_factory=dict)
    schema_version: str = "region-track-v1"

    def is_valid(self) -> bool:
        """Kiểm tra toạ độ chuẩn hóa trong phạm vi [0.0, 1.0]."""
        return (
            0.0 <= self.x <= 1.0
            and 0.0 <= self.y <= 1.0
            and 0.0 < self.width <= 1.0
            and 0.0 < self.height <= 1.0
            and (self.x + self.width) <= 1.0001
            and (self.y + self.height) <= 1.0001
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> RegionTrackV1:
        return cls(
            region_id=data.get("region_id", str(uuid.uuid4())),
            x=float(data.get("x", 0.0)),
            y=float(data.get("y", 0.0)),
            width=float(data.get("width", 1.0)),
            height=float(data.get("height", 1.0)),
            valid_start_pts=float(data.get("valid_start_pts", 0.0)),
            valid_end_pts=float(data.get("valid_end_pts", float("inf"))),
            keyframe_overrides=data.get("keyframe_overrides", {}),
            schema_version=data.get("schema_version", "region-track-v1"),
        )


@dataclass
class OcrObservationV1:
    """Quan sát OCR tại một frame hoặc khoảng thời gian PTS."""
    pts: float
    boxes: List[List[float]] = field(default_factory=list)  # List các bounding box [x1, y1, x2, y2]
    raw_text: str = ""
    normalized_text: str = ""
    confidence: float = 0.0
    preprocessing_metadata: Dict[str, Any] = field(default_factory=dict)
    model_metadata: Dict[str, Any] = field(default_factory=dict)
    schema_version: str = "ocr-observation-v1"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> OcrObservationV1:
        return cls(
            pts=float(data.get("pts", 0.0)),
            boxes=data.get("boxes", []),
            raw_text=data.get("raw_text", ""),
            normalized_text=data.get("normalized_text", ""),
            confidence=float(data.get("confidence", 0.0)),
            preprocessing_metadata=data.get("preprocessing_metadata", {}),
            model_metadata=data.get("model_metadata", {}),
            schema_version=data.get("schema_version", "ocr-observation-v1"),
        )


@dataclass
class SubtitleCueV1:
    """Một đơn vị câu phụ đề hoàn chỉnh có timing và nội dung song ngữ."""
    cue_id: str
    start_pts: float
    end_pts: float
    source_text: str = ""
    translated_text: str = ""
    style: Dict[str, Any] = field(default_factory=dict)
    region_id: Optional[str] = None
    quality_flags: List[str] = field(default_factory=list)
    confidence: float = 1.0
    revision: int = 1
    status: str = "auto"  # "auto", "reviewed", "locked"
    schema_version: str = "subtitle-cue-v1"

    def duration(self) -> float:
        return round(max(0.0, self.end_pts - self.start_pts), 3)

    def is_locked(self) -> bool:
        return self.status == "locked"

    def lock(self) -> None:
        self.status = "locked"

    def unlock(self) -> None:
        self.status = "reviewed"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> SubtitleCueV1:
        return cls(
            cue_id=data.get("cue_id", str(uuid.uuid4())),
            start_pts=float(data.get("start_pts", 0.0)),
            end_pts=float(data.get("end_pts", 0.0)),
            source_text=data.get("source_text", ""),
            translated_text=data.get("translated_text", ""),
            style=data.get("style", {}),
            region_id=data.get("region_id"),
            quality_flags=data.get("quality_flags", []),
            confidence=float(data.get("confidence", 1.0)),
            revision=int(data.get("revision", 1)),
            status=data.get("status", "auto"),
            schema_version=data.get("schema_version", "subtitle-cue-v1"),
        )


@dataclass
class ModelDescriptorV1:
    """Mô tả metadata, license và nguồn gốc của AI model."""
    id: str
    source_url: str
    version_or_commit: str
    sha256: str
    format: str
    license: str
    languages: List[str] = field(default_factory=list)
    runtime: str = "python"
    hardware_requirements: Dict[str, Any] = field(default_factory=dict)
    schema_version: str = "model-descriptor-v1"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ModelDescriptorV1:
        return cls(
            id=data.get("id", ""),
            source_url=data.get("source_url", ""),
            version_or_commit=data.get("version_or_commit", ""),
            sha256=data.get("sha256", ""),
            format=data.get("format", ""),
            license=data.get("license", ""),
            languages=data.get("languages", []),
            runtime=data.get("runtime", "python"),
            hardware_requirements=data.get("hardware_requirements", {}),
            schema_version=data.get("schema_version", "model-descriptor-v1"),
        )


@dataclass
class StageRunV1:
    """Theo dõi tiến độ và trạng thái thực thi của từng công đoạn xử lý."""
    stage_name: str
    status: str = "pending"  # "pending", "running", "completed", "failed", "cancelled"
    progress: float = 0.0
    input_hashes: Dict[str, str] = field(default_factory=dict)
    output_hashes: Dict[str, str] = field(default_factory=dict)
    checkpoint_data: Dict[str, Any] = field(default_factory=dict)
    metrics: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    cancellation_requested: bool = False
    start_time: float = field(default_factory=time.time)
    end_time: Optional[float] = None
    schema_version: str = "stage-run-v1"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> StageRunV1:
        return cls(
            stage_name=data.get("stage_name", "unknown"),
            status=data.get("status", "pending"),
            progress=float(data.get("progress", 0.0)),
            input_hashes=data.get("input_hashes", {}),
            output_hashes=data.get("output_hashes", {}),
            checkpoint_data=data.get("checkpoint_data", {}),
            metrics=data.get("metrics", {}),
            errors=data.get("errors", []),
            cancellation_requested=bool(data.get("cancellation_requested", False)),
            start_time=float(data.get("start_time", time.time())),
            end_time=data.get("end_time"),
            schema_version=data.get("schema_version", "stage-run-v1"),
        )


@dataclass
class ProjectManifestV1:
    """Manifest đại diện toàn bộ dự án phụ đề."""
    project_id: str
    title: str
    source_video_path: str
    video_fingerprint: str
    source_language: str
    target_language: str = "vi"
    active_revision: int = 1
    media_metadata: Dict[str, Any] = field(default_factory=dict)
    model_selections: Dict[str, str] = field(default_factory=dict)
    regions: List[RegionTrackV1] = field(default_factory=list)
    style: Dict[str, Any] = field(default_factory=dict)
    output_presets: Dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    schema_version: str = "project-manifest-v1"

    def to_dict(self) -> Dict[str, Any]:
        res = asdict(self)
        res["regions"] = [r.to_dict() if isinstance(r, RegionTrackV1) else r for r in self.regions]
        return res

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ProjectManifestV1:
        regions_raw = data.get("regions", [])
        regions = [
            RegionTrackV1.from_dict(r) if isinstance(r, dict) else r
            for r in regions_raw
        ]
        return cls(
            project_id=data.get("project_id", str(uuid.uuid4())),
            title=data.get("title", "Untitled Project"),
            source_video_path=data.get("source_video_path", ""),
            video_fingerprint=data.get("video_fingerprint", ""),
            source_language=data.get("source_language", "zh"),
            target_language=data.get("target_language", "vi"),
            active_revision=int(data.get("active_revision", 1)),
            media_metadata=data.get("media_metadata", {}),
            model_selections=data.get("model_selections", {}),
            regions=regions,
            style=data.get("style", {}),
            output_presets=data.get("output_presets", {}),
            created_at=float(data.get("created_at", time.time())),
            updated_at=float(data.get("updated_at", time.time())),
            schema_version=data.get("schema_version", "project-manifest-v1"),
        )


@dataclass
class CommandEnvelopeV1:
    """Gói lệnh thực thi với revision mong đợi để kiểm soát xung đột đồng thời."""
    command_id: str
    expected_revision: int
    command_type: str
    payload: Dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    schema_version: str = "command-envelope-v1"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> CommandEnvelopeV1:
        return cls(
            command_id=data.get("command_id", str(uuid.uuid4())),
            expected_revision=int(data.get("expected_revision", 1)),
            command_type=data.get("command_type", "unknown"),
            payload=data.get("payload", {}),
            created_at=float(data.get("created_at", time.time())),
            schema_version=data.get("schema_version", "command-envelope-v1"),
        )


@dataclass
class BridgeEventV1:
    """Sự kiện WebSocket có sequence number để hỗ trợ reconnect và resume."""
    event_id: str
    sequence: int
    project_id: str
    job_id: Optional[str]
    event_type: str
    payload: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    schema_version: str = "bridge-event-v1"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> BridgeEventV1:
        return cls(
            event_id=data.get("event_id", str(uuid.uuid4())),
            sequence=int(data.get("sequence", 0)),
            project_id=data.get("project_id", ""),
            job_id=data.get("job_id"),
            event_type=data.get("event_type", "status"),
            payload=data.get("payload", {}),
            timestamp=float(data.get("timestamp", time.time())),
            schema_version=data.get("schema_version", "bridge-event-v1"),
        )
