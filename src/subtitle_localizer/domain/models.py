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
    mask_enabled: bool = True
    # dialogue = OCR + optional mask; ignore = skip OCR/mask; always_mask = blur always, skip OCR
    role: str = "dialogue"
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
            mask_enabled=bool(data.get("mask_enabled", True)),
            role=str(data.get("role") or "dialogue"),
            valid_start_pts=float(data["valid_start_pts"]) if data.get("valid_start_pts") is not None else 0.0,
            valid_end_pts=float(data["valid_end_pts"]) if data.get("valid_end_pts") is not None else float("inf"),
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
    custom_pipeline_settings: Optional[Dict[str, Any]] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    schema_version: str = "project-manifest-v1"
    media_items: List[Dict[str, Any]] = field(default_factory=list)
    has_voiceover: bool = False
    voiceover_path: Optional[str] = None
    voiceover_file_size_bytes: int = 0
    has_export: bool = False
    export_path: Optional[str] = None
    export_file_size_bytes: int = 0

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
            custom_pipeline_settings=data.get("custom_pipeline_settings"),
            created_at=float(data.get("created_at", time.time())),
            updated_at=float(data.get("updated_at", time.time())),
            schema_version=data.get("schema_version", "project-manifest-v1"),
            media_items=list(data.get("media_items", [])),
            has_voiceover=bool(data.get("has_voiceover", False)),
            voiceover_path=data.get("voiceover_path"),
            voiceover_file_size_bytes=int(data.get("voiceover_file_size_bytes", 0)),
            has_export=bool(data.get("has_export", False)),
            export_path=data.get("export_path"),
            export_file_size_bytes=int(data.get("export_file_size_bytes", 0)),
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


@dataclass
class FallbackEventV1:
    """Ghi nhận sự kiện fallback nhà cung cấp hoặc model."""
    stage: str
    from_provider: str
    error: str
    to_provider: str
    timestamp: float = field(default_factory=time.time)
    success: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> FallbackEventV1:
        return cls(
            stage=data.get("stage", ""),
            from_provider=data.get("from_provider", ""),
            error=data.get("error", ""),
            to_provider=data.get("to_provider", ""),
            timestamp=float(data.get("timestamp", time.time())),
            success=bool(data.get("success", True)),
        )


@dataclass
class FullPipelineSettingsV1:
    """Cấu hình tinh gọn cho quy trình tự động Full Pipeline."""
    source_language: str = "auto"
    target_language: str = "vi"
    target_resolution: str = "best"
    ocr_quality: str = "auto"
    translation_quality: str = "auto"
    dubbing_enabled: bool = True
    voice: str = "vi-VN-HoaiMyNeural"
    speed_fit: bool = True
    burn_subtitles: bool = True
    mask_subtitles: bool = True
    mask_mode: str = "blur"
    export_srt_ass: bool = True
    output_dir: Optional[str] = None
    proxy: Optional[str] = None
    cookie_source: Optional[str] = "none"
    pause_after_download: bool = False
    manual_roi: Optional[Dict[str, float]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> FullPipelineSettingsV1:
        return cls(
            source_language=data.get("source_language", "auto"),
            target_language=data.get("target_language", "vi"),
            target_resolution=data.get("target_resolution", "best"),
            ocr_quality=data.get("ocr_quality", "auto"),
            translation_quality=data.get("translation_quality", "auto"),
            dubbing_enabled=bool(data.get("dubbing_enabled", True)),
            voice=data.get("voice", "vi-VN-HoaiMyNeural"),
            speed_fit=bool(data.get("speed_fit", True)),
            burn_subtitles=bool(data.get("burn_subtitles", True)),
            mask_subtitles=bool(data.get("mask_subtitles", True)),
            mask_mode=data.get("mask_mode", "blur"),
            export_srt_ass=bool(data.get("export_srt_ass", True)),
            output_dir=data.get("output_dir"),
            proxy=data.get("proxy"),
            cookie_source=data.get("cookie_source", "none"),
            pause_after_download=bool(data.get("pause_after_download", False)),
            manual_roi=data.get("manual_roi"),
        )


@dataclass
class FullPipelineStageV1:
    """Quản lý trạng thái và tiến độ của từng stage trong Full Pipeline."""
    stage_name: str
    display_name: str = ""
    status: str = "pending"  # pending, running, completed, failed, skipped, needs_review
    progress: float = 0.0
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    metrics: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> FullPipelineStageV1:
        return cls(
            stage_name=data.get("stage_name", ""),
            display_name=data.get("display_name", ""),
            status=data.get("status", "pending"),
            progress=float(data.get("progress", 0.0)),
            start_time=data.get("start_time"),
            end_time=data.get("end_time"),
            metrics=data.get("metrics", {}),
            errors=data.get("errors", []),
        )


def _get_default_pipeline_stages() -> List[FullPipelineStageV1]:
    return [
        FullPipelineStageV1(stage_name="downloading", display_name="Tải video"),
        FullPipelineStageV1(stage_name="detecting_roi", display_name="Dò vùng phụ đề"),
        FullPipelineStageV1(stage_name="ocr", display_name="Quét chữ OCR"),
        FullPipelineStageV1(stage_name="translating", display_name="Dịch phụ đề"),
        FullPipelineStageV1(stage_name="dubbing", display_name="Lồng tiếng AI"),
        FullPipelineStageV1(stage_name="exporting", display_name="Che sub & Xuất MP4"),
    ]


@dataclass
class FullPipelineWorkflowV1:
    """State machine đại diện cho một tiến trình xử lý tự động từ URL đến Editor."""
    workflow_id: str
    source_url: str
    idempotency_key: Optional[str] = None
    state: str = "queued"  # queued, downloading, detecting_roi, ocr, translating, dubbing, exporting, completed, retrying, needs_review, failed, cancelled
    current_stage: str = "downloading"
    project_id: Optional[str] = None
    title: str = ""
    thumbnail_url: str = ""
    settings: FullPipelineSettingsV1 = field(default_factory=FullPipelineSettingsV1)
    stages: List[FullPipelineStageV1] = field(default_factory=_get_default_pipeline_stages)
    progress: float = 0.0
    retry_count: int = 0
    fallback_events: List[FallbackEventV1] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    artifacts: Dict[str, Any] = field(default_factory=dict)
    quality_metrics: Dict[str, Any] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    schema_version: str = "full-pipeline-workflow-v1"

    # Định nghĩa các chuyển đổi trạng thái hợp lệ
    VALID_TRANSITIONS: Dict[str, set[str]] = field(default_factory=lambda: {
        "queued": {"downloading", "cancelled"},
        "downloading": {"detecting_roi", "failed", "needs_review", "cancelled", "retrying"},
        "detecting_roi": {"ocr", "failed", "needs_review", "cancelled", "retrying"},
        "ocr": {"translating", "failed", "needs_review", "cancelled", "retrying"},
        "translating": {"dubbing", "exporting", "failed", "needs_review", "cancelled", "retrying"},
        "dubbing": {"exporting", "failed", "needs_review", "cancelled", "retrying"},
        "exporting": {"completed", "failed", "needs_review", "cancelled", "retrying"},
        "retrying": {"downloading", "detecting_roi", "ocr", "translating", "dubbing", "exporting", "failed", "cancelled"},
        "needs_review": {"retrying", "completed", "cancelled"},
        "failed": {"retrying"},
        "cancelled": {"retrying"},
        "completed": set(),
    })

    def transition_to(self, new_state: str) -> None:
        """Thực hiện chuyển đổi trạng thái với kiểm tra tính hợp lệ nghiêm ngặt."""
        allowed = self.VALID_TRANSITIONS.get(self.state, set())
        if new_state not in allowed:
            raise ValueError(
                f"Chuyển đổi trạng thái không hợp lệ: từ '{self.state}' sang '{new_state}'. "
                f"Các trạng thái được phép: {sorted(list(allowed))}"
            )
        self.state = new_state
        self.updated_at = time.time()
        if new_state in ("completed", "failed", "cancelled"):
            self.finished_at = time.time()

    def get_stage(self, stage_name: str) -> Optional[FullPipelineStageV1]:
        for st in self.stages:
            if st.stage_name == stage_name:
                return st
        return None

    def update_stage(self, stage_name: str, status: str, progress: float = 0.0,
                     metrics: Optional[Dict[str, Any]] = None, error: Optional[str] = None) -> None:
        st = self.get_stage(stage_name)
        if st:
            st.status = status
            st.progress = progress
            if status == "running" and st.start_time is None:
                st.start_time = time.time()
            elif status in ("completed", "failed", "skipped", "needs_review"):
                st.end_time = time.time()
            if metrics:
                st.metrics.update(metrics)
            if error:
                st.errors.append(error)
        self.updated_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        res = asdict(self)
        res.pop("VALID_TRANSITIONS", None)
        return res

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> FullPipelineWorkflowV1:
        stages_raw = data.get("stages", [])
        stages = [
            FullPipelineStageV1.from_dict(s) if isinstance(s, dict) else s
            for s in stages_raw
        ] if stages_raw else _get_default_pipeline_stages()

        fallbacks_raw = data.get("fallback_events", [])
        fallbacks = [
            FallbackEventV1.from_dict(f) if isinstance(f, dict) else f
            for f in fallbacks_raw
        ]

        settings_raw = data.get("settings", {})
        settings = (
            FullPipelineSettingsV1.from_dict(settings_raw)
            if isinstance(settings_raw, dict) else FullPipelineSettingsV1()
        )

        return cls(
            workflow_id=data.get("workflow_id", ""),
            source_url=data.get("source_url", ""),
            idempotency_key=data.get("idempotency_key"),
            state=data.get("state", "queued"),
            current_stage=data.get("current_stage", "downloading"),
            project_id=data.get("project_id"),
            title=data.get("title", ""),
            thumbnail_url=data.get("thumbnail_url", ""),
            settings=settings,
            stages=stages,
            progress=float(data.get("progress", 0.0)),
            retry_count=int(data.get("retry_count", 0)),
            fallback_events=fallbacks,
            warnings=data.get("warnings", []),
            errors=data.get("errors", []),
            artifacts=data.get("artifacts", {}),
            quality_metrics=data.get("quality_metrics", {}),
            created_at=float(data.get("created_at", time.time())),
            updated_at=float(data.get("updated_at", time.time())),
            finished_at=data.get("finished_at"),
            schema_version=data.get("schema_version", "full-pipeline-workflow-v1"),
        )
