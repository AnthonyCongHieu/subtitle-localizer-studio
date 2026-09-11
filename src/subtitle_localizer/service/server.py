from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import os
import threading
import time
import uuid
import numpy as np
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("subtitle_localizer.server")
SERVER_INSTANCE_ID: str = str(uuid.uuid4())
from fastapi import FastAPI, File, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect, Response, Request
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
try:
    from pydantic import BaseModel, Field, field_validator
except ImportError:
    from pydantic import BaseModel, Field, validator as field_validator

from subtitle_localizer.service.pipeline_settings import (
    GlobalPipelineSettings,
    get_global_pipeline_settings,
    save_pipeline_settings,
    merge_pipeline_settings,
    check_hardware_capabilities,
)

from subtitle_localizer.domain.models import (
    CommandEnvelopeV1,
    ProjectManifestV1,
    RegionTrackV1,
    StageRunV1,
    SubtitleCueV1,
)
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.websocket import WebSocketManager
from subtitle_localizer.reconstruction.builder import normalize_sequential_cues
from subtitle_localizer.service.worker import BackgroundWorker
from subtitle_localizer.service.lan import LanCoordinator, LanLeaseError, LanStateError
from subtitle_localizer.service.lan_artifacts import CoordinatorArtifactStore
from subtitle_localizer.service.lan_protocol import (
    ArtifactMetadata,
    JobPackage,
    ProtocolError,
    ResultPackage,
    PROTOCOL_VERSION,
    sha256_file,
)


class CreateProjectRequest(BaseModel):
    title: str
    source_video_path: str
    source_language: str = "zh"
    target_language: str = "vi"
    media_items: List[Dict[str, Any]] = Field(default_factory=list)


class BatchCreateProjectsRequest(BaseModel):
    items: List[CreateProjectRequest] = Field(default_factory=list)
    folder_groups: List[Dict[str, Any]] = Field(default_factory=list)
    regions: Optional[List[Dict[str, Any]]] = None


class CommandRequest(BaseModel):
    command_id: Optional[str] = None
    expected_revision: int
    command_type: str
    payload: Dict[str, Any] = {}


class Mp4ExportRequest(BaseModel):
    use_translated: bool = True
    mask_mode: str = "blur"
    flip_h: bool = False
    flip_v: bool = False
    video_x: float = 0.0
    video_y: float = 0.0
    video_scale: float = 1.0
    rotation: float = 0.0
    regions: Optional[List[Dict[str, Any]]] = None
    subtitle_placement: Optional[str] = "roi"
    blur_strength: Optional[int] = 20


class BatchRunRequest(BaseModel):
    project_ids: List[str]
    auto_export_mp4: bool = False


class GeminiKeyRequest(BaseModel):
    api_key: str


class GeminiPoolRequest(BaseModel):
    keys: List[str] = []


class GeminiVerifyRequest(BaseModel):
    index: Optional[int] = None


class AutoDetectRoiRequest(BaseModel):
    pts: Optional[float] = None


class PipelineRunRequest(BaseModel):
    max_duration_seconds: Optional[float] = None
    sync: bool = False
    ocr_only: bool = False


class WorkerRegistrationRequest(BaseModel):
    worker_id: str
    hostname: str = ""
    ip_address: str = ""
    platform: str = "windows"
    app_version: str = ""
    model_version: str = ""
    gpu_name: str = ""
    vram_mb: int = 0
    vram_free_mb: Optional[int] = None
    disk_free_bytes: Optional[int] = None
    slots_available: Optional[int] = None
    capabilities: Dict[str, bool] = {}


class WorkerHeartbeatRequest(BaseModel):
    queue_depth: int = 0
    active_job_id: Optional[str] = None
    job_id: Optional[str] = None
    lease_id: Optional[str] = None
    gpu_name: Optional[str] = None
    vram_mb: Optional[int] = None
    vram_free_mb: Optional[int] = None
    disk_free_bytes: Optional[int] = None
    slots_available: Optional[int] = None
    capabilities: Optional[Dict[str, bool]] = None
    last_error: Optional[str] = None


class LanJobRequest(BaseModel):
    project_id: str
    worker_id: Optional[str] = None
    idempotency_key: str
    job_type: str = "ocr"
    profile: str = "full_speed_quality"
    video_fingerprint: str = ""
    max_attempts: int = 3
    protocol_version: Optional[str] = None
    stage_plan: List[str] = Field(default_factory=list)
    package: Optional[Dict[str, Any]] = None
    metrics: Optional[Dict[str, Any]] = None


class LanJobRetryRequest(BaseModel):
    stage_plan: Optional[List[str]] = None

class LanJobUpdateRequest(BaseModel):
    status: Optional[str] = None
    progress: Optional[float] = None
    metrics: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    lease_id: Optional[str] = None
    worker_id: Optional[str] = None
    current_stage: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    artifacts: Optional[List[Dict[str, Any]]] = None
    lease_expires_at: Optional[float] = None


class DownloadPreviewRequest(BaseModel):
    request_id: Optional[str] = None
    worker_id: str
    source: str
    title: str = ""
    thumbnail_url: str = ""
    duration_seconds: Optional[float] = None
    size_bytes: Optional[int] = None


class DownloadDecisionRequest(BaseModel):
    approved: bool


class DownloadUpdateRequest(BaseModel):
    status: str


class BatchDeleteProjectsRequest(BaseModel):
    project_ids: List[str]


class DownloadParseRequest(BaseModel):
    target: str
    proxy: Optional[str] = None
    strict_proxy: Optional[bool] = True


class DownloadStartRequest(BaseModel):
    target_info: Dict[str, Any]
    episodes: Optional[List[int]] = None
    start_ep: int = 1
    end_ep: Optional[int] = None
    output_dir: Optional[str] = None
    auto_create_project: bool = True
    source_language: str = "zh"
    target_language: str = "vi"
    proxy: Optional[str] = None
    proxy_list: Optional[List[str]] = None
    strict_proxy: Optional[bool] = True
    cdn_direct_bypass: Optional[bool] = False
    auto_xray: Optional[bool] = False
    rate_limit_delay: float = 2.0
    rotate_device_each_ep: bool = True
    rotation_interval: Optional[int] = None
    target_resolution: Optional[str] = "best"
    concurrency: Optional[int] = 3
    cookie_source: Optional[str] = "none"


class DownloadQueueAddRequest(BaseModel):
    target_info: Dict[str, Any]
    episodes: Optional[List[int]] = None
    start_ep: int = 1
    end_ep: Optional[int] = None
    output_dir: Optional[str] = None
    auto_create_project: bool = True
    source_language: str = "zh"
    target_language: str = "vi"
    proxy: Optional[str] = None
    proxy_list: Optional[List[str]] = None
    strict_proxy: Optional[bool] = True
    cdn_direct_bypass: Optional[bool] = False
    auto_xray: Optional[bool] = False
    rate_limit_delay: float = 0.0
    rotate_device_each_ep: bool = True
    rotation_interval: Optional[int] = None
    target_resolution: Optional[str] = "best"
    concurrency: Optional[int] = 3
    cookie_source: Optional[str] = "none"


    @field_validator("target_info")
    @classmethod
    def validate_target_info(cls, v: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(v, dict) or not v:
            raise ValueError("target_info không được để trống")
        if not v.get("title") and not v.get("series_id") and not v.get("url"):
            raise ValueError("target_info phải chứa ít nhất title, series_id hoặc url")
        return v


class DownloadQueueAddResponse(BaseModel):
    success: bool = True
    task_id: str
    position: int
    message: str = "Đã thêm vào hàng đợi thành công"


class DownloadQueueTaskItem(BaseModel):
    task_id: str
    status: str
    title: Optional[str] = ""
    series_id: Optional[str] = None
    platform: Optional[str] = "generic"
    target_info: Dict[str, Any]
    progress_percent: float = 0.0
    speed_mbps: float = 0.0
    message: str = ""
    current_ep: int = 0
    total_eps: int = 0
    episodes: Optional[List[int]] = None
    output_dir: Optional[str] = None
    target_resolution: Optional[str] = "best"
    concurrency: Optional[int] = 3
    cookie_source: Optional[str] = "none"
    error: Optional[str] = None
    auto_xray: Optional[bool] = False
    created_at: Optional[float] = None


class XrayStatusResponse(BaseModel):
    installed: bool
    running: bool
    is_enabled: bool
    is_downloading: bool
    is_benchmarking: bool
    http_port: int = 10809
    socks_port: int = 10808
    active_node: Optional[Dict[str, Any]] = None
    quality_nodes_count: int = 0
    quality_nodes: List[Dict[str, Any]] = []
    last_benchmarked_at: float = 0.0


class XrayToggleRequest(BaseModel):
    enabled: bool


class XrayRefreshRequest(BaseModel):
    custom_feed_or_nodes: Optional[str] = None
    max_latency_ms: Optional[float] = 800.0


class XraySwitchNodeRequest(BaseModel):
    node_name: str


class DetectedLocalProxyItem(BaseModel):
    name: str
    url: str
    active: bool


class ProxyStatusResponse(BaseModel):
    enabled: bool
    proxy_url: Optional[str] = None
    is_alive: bool
    is_standby: Optional[bool] = None
    latency_ms: Optional[int] = None
    mode: str
    detected_local_proxies: List[DetectedLocalProxyItem] = []



class DownloadQueueListResponse(BaseModel):
    tasks: List[DownloadQueueTaskItem] = []
    is_paused: bool = False
    active_task_id: Optional[str] = None


class DownloadQueuePauseResponse(BaseModel):
    success: bool = True
    is_paused: bool = True
    message: str = "Đã tạm dừng hàng đợi"


class DownloadQueueResumeResponse(BaseModel):
    success: bool = True
    is_paused: bool = False
    message: str = "Đã tiếp tục hàng đợi"


class DownloadQueueDeleteResponse(BaseModel):
    success: bool = True
    message: str = "Đã xóa tác vụ khỏi hàng đợi"


class DownloadQueueReorderRequest(BaseModel):
    task_id: str
    direction: str  # "up", "down", "top", "bottom"


class DownloadQueueReorderResponse(BaseModel):
    success: bool = True
    tasks: List[str] = []
    message: str = "Đã cập nhật thứ tự hàng đợi"


class DirectoryValidateRequest(BaseModel):
    path: str = ""
    auto_create: bool = False


class DirectoryValidateResponse(BaseModel):
    valid: bool
    path: str
    exists: bool
    writable: bool
    error: Optional[str] = None


class ScanEpisodesRequest(BaseModel):
    title: str
    total_episodes: int
    output_dir: Optional[str] = None


class EpisodeDiskStatusItem(BaseModel):
    episode: int
    status: str  # "completed", "corrupted", "missing"
    size_bytes: int
    filename: str


class ScanEpisodesResponse(BaseModel):
    episodes: List[EpisodeDiskStatusItem] = []
    completed_count: int = 0
    corrupted_count: int = 0
    missing_count: int = 0


class DownloadCoverRequest(BaseModel):
    cover_url: str
    output_dir: str
    filename: Optional[str] = "cover.jpg"
    proxy: Optional[str] = None


class DownloadCoverResponse(BaseModel):
    success: bool = True
    file_path: Optional[str] = None
    message: str = ""


class TestProxyRequest(BaseModel):
    proxy: str


class CustomDeviceRequest(BaseModel):
    device_id: str
    install_id: str
    platform: str = "android"


class RotateDeviceRequest(BaseModel):
    proxy: Optional[str] = None


class SavePlatformCookieRequest(BaseModel):
    platform: str
    cookie: str


class VideoSearchRequest(BaseModel):
    keyword: str
    platform: str = "bilibili"
    page: int = 1
    order: str = "totalrank"
    duration: int = 0
    must_contain: Optional[str] = None
    must_not_contain: Optional[str] = None
    auto_translate: bool = True
    translate_titles: bool = True


class TestTranslationRequest(BaseModel):
    text: str
    source_lang: str = "zh"
    target_lang: str = "vi"
    provider: str = "local"
    gemini_model: str = "gemini-2.5-flash"
    local_model: str = "qwen2.5:7b-instruct"
    local_endpoint: str = "http://localhost:11434"
    auto_fallback: bool = False
    prompt_tone: str = "dramatic"
    use_glossary: bool = True


class LocalLlmCheckRequest(BaseModel):
    endpoint: Optional[str] = "http://localhost:11434"
    model: Optional[str] = "qwen2.5:7b-instruct"


class TestDubbingRequest(BaseModel):
    text: str
    provider: Optional[str] = "edge"
    voice: str = "vi-VN-NamMinhNeural"
    rate: str = "+0%"
    pitch: str = "+0Hz"
    prompt_style: Optional[str] = "dramatic"



class ImportCapCutDraftRequest(BaseModel):
    draft_id: Optional[str] = None
    draft_path: Optional[str] = None


def create_app(
    database: Optional[Database] = None,
    repo: Optional[ProjectRepository] = None,
    auth_token: Optional[str] = None,
    output_root: Path | str = "outputs",
    worker: Optional[BackgroundWorker] = None,
) -> FastAPI:
    """Tạo instance ứng dụng FastAPI với đầy đủ routes, auth và websocket."""
    app = FastAPI(title="Subtitle Localizer Studio API", version="1.0.0")

    # Optional LAN boundary. Empty means backwards-compatible token-only auth.
    lan_allowlist_error: Optional[str] = None
    allowed_lan_networks: list[Any] = []
    for value in os.getenv("SL_LAN_ALLOWED_IPS", "").split(","):
        item = value.strip()
        if not item:
            continue
        try:
            allowed_lan_networks.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            lan_allowlist_error = f"SL_LAN_ALLOWED_IPS chứa CIDR/IP không hợp lệ: {item}"
            break

    @app.middleware("http")
    async def lan_ip_whitelist(request: Request, call_next):
        if request.url.path.startswith("/api/v1/admin/"):
            if lan_allowlist_error:
                return Response(
                    content=json.dumps({"detail": lan_allowlist_error}, ensure_ascii=False),
                    status_code=500,
                    media_type="application/json",
                )
            if allowed_lan_networks:
                client_ip = request.client.host if request.client else ""
                try:
                    address = ipaddress.ip_address(client_ip)
                    allowed = any(
                        address.version == network.version and address in network
                        for network in allowed_lan_networks
                    )
                except ValueError:
                    allowed = any(network.prefixlen == 0 for network in allowed_lan_networks)
                if not allowed:
                    return Response(content='{"detail":"IP không được phép truy cập LAN admin"}', status_code=403, media_type="application/json")
        return await call_next(request)

    # Load local environment config if present
    env_file = Path("subtitle_localizer.env")
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

    db = database or Database("subtitle_localizer.db")
    db.migrate()
    repository = repo or ProjectRepository(db)
    ws_manager = WebSocketManager(repository)
    worker = worker or BackgroundWorker(repository)
    resolved_output_root = Path(output_root).resolve()
    running_project_ids: set[str] = set()
    running_lock = threading.Lock()
    lan = LanCoordinator(db)
    lan_artifacts = CoordinatorArtifactStore(resolved_output_root / ".lan-artifacts")
    app.state.lan_coordinator = lan
    app.state.lan_artifacts = lan_artifacts

    async def broadcast_lan(event_type: str, payload: Dict[str, Any], *, job_id: Optional[str] = None) -> None:
        """Push LAN control-plane changes through the existing authenticated WS channel."""
        try:
            await ws_manager.broadcast_event("__lan__", event_type, payload, job_id=job_id)
        except Exception:
            logger.exception("LAN websocket broadcast failed")

    from subtitle_localizer.service.downloader import DownloadManager, parse_media_target, test_proxy_connection
    from subtitle_localizer.downloader import hongguo_parser as parser
    download_manager = DownloadManager(repository=repository, uploads_dir="uploads")

    # Cấu hình CORS chặt chẽ cho localhost
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5199", "http://127.0.0.1:5199", "http://localhost:3000", "http://127.0.0.1:3000", "*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def verify_auth(authorization: Optional[str] = Header(None)) -> None:
        if auth_token is None:
            return
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or invalid token")
        token = authorization.split(" ", 1)[1]
        if token != auth_token:
            raise HTTPException(status_code=403, detail="Forbidden: Token mismatch")

    @app.get("/api/v1/health")
    async def health_check() -> Dict[str, str]:
        return {"status": "healthy", "version": "1.0.0", "server_id": SERVER_INSTANCE_ID}

    @app.post("/api/v1/admin/workers/register")
    async def register_worker(request: WorkerRegistrationRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            result = lan.register_worker(request.model_dump() if hasattr(request, "model_dump") else request.dict()).to_dict()
            await broadcast_lan("worker_registered", result)
            return result
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.post("/api/v1/admin/workers/{worker_id}/heartbeat")
    async def worker_heartbeat(worker_id: str, request: WorkerHeartbeatRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            data = request.model_dump(exclude_none=True) if hasattr(request, "model_dump") else request.dict(exclude_none=True)
            result = lan.heartbeat(worker_id, data).to_dict()
            await broadcast_lan("worker_heartbeat", result)
            await broadcast_lan("lan_overview", lan.overview())
            active_job_id = data.get("job_id") or data.get("active_job_id")
            if active_job_id:
                await broadcast_lan("job_heartbeat", lan.get_job(str(active_job_id)).to_dict(), job_id=str(active_job_id))
            return result
        except LanStateError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Worker không tồn tại") from error

    @app.post("/api/v1/admin/workers/{worker_id}/status")
    async def set_worker_status(worker_id: str, status: str = Query(...), authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            result = lan.set_worker_status(worker_id, status).to_dict()
            await broadcast_lan("worker_status_changed", result)
            return result
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Worker không tồn tại") from error

    @app.get("/api/v1/admin/overview")
    async def lan_overview(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        return lan.overview()

    @app.get("/api/v1/admin/workers")
    async def list_workers(authorization: Optional[str] = Header(None)) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        return lan.list_workers()

    @app.post("/api/v1/admin/jobs")
    async def create_lan_job(request: LanJobRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            data = request.model_dump() if hasattr(request, "model_dump") else request.dict()
            project = repository.get_project(data["project_id"])
            source = Path(project.source_video_path) if project and project.source_video_path else None
            if data.get("package") is not None:
                package_data = dict(data["package"])
                package_data.setdefault("job_id", data.get("job_id") or f"pending-{uuid.uuid4().hex[:12]}")
                package_data.setdefault("project_id", data["project_id"])
                package_data.setdefault("protocol_version", data.get("protocol_version") or PROTOCOL_VERSION)
                package_data.setdefault("stage_plan", data.get("stage_plan") or ["download", "prepare", "ocr", "translate", "publish"])
                JobPackage.from_dict(package_data)
            elif source and source.is_file() and (data.get("protocol_version") or data.get("stage_plan")):
                source_meta = ArtifactMetadata(source.name, "source", source.stat().st_size, sha256_file(source))
                data["package"] = {
                    "protocol_version": data.get("protocol_version") or PROTOCOL_VERSION,
                    "job_id": "pending",
                    "project_id": project.project_id,
                    "project": project.to_dict(),
                    "settings": project.custom_pipeline_settings or {},
                    "cues": [cue.to_dict() for cue in repository.get_cues(project.project_id)],
                    "regions": [region.to_dict() for region in project.regions],
                    "stage_plan": data.get("stage_plan") or ["download", "prepare", "ocr", "translate", "publish"],
                    "artifacts": [source_meta.to_dict()],
                }
            result_obj = lan.create_job(data)
            if result_obj.package:
                package = dict(result_obj.package)
                package["job_id"] = result_obj.job_id
                source_items = package.get("artifacts") or []
                if source and source.is_file() and source_items and source_items[0].get("kind") == "source":
                    source_meta = lan_artifacts.put_source(result_obj.job_id, source, name=source_items[0]["name"])
                    package["artifacts"] = [{**source_meta.to_dict(),
                                             "download_url": f"/api/v1/admin/jobs/{result_obj.job_id}/source/{source_meta.name}"}]
                validated = JobPackage.from_dict(package)
                lan_artifacts.write_package(result_obj.job_id, validated.to_dict())
                result_obj.package = validated.to_dict()
                result_obj.protocol_version = validated.protocol_version
                result_obj.stage_plan = list(validated.stage_plan)
                lan._persist_job(result_obj)
            result = result_obj.to_dict()
            await broadcast_lan("job_updated", result, job_id=result.get("job_id"))
            return result
        except LanStateError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except (ValueError, ProtocolError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Worker không tồn tại") from error

    @app.get("/api/v1/admin/jobs")
    async def list_lan_jobs(status: Optional[str] = Query(None), authorization: Optional[str] = Header(None)) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        return lan.list_jobs(status=status)

    @app.post("/api/v1/admin/workers/{worker_id}/claim")
    async def claim_worker_job(worker_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            job = lan.claim_next_job(worker_id)
            if job:
                await broadcast_lan("job_claimed", job.to_dict(), job_id=job.job_id)
            return {"job": job.to_dict() if job else None}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Worker không tồn tại") from error

    @app.get("/api/v1/admin/jobs/{job_id}/package")
    async def get_lan_job_package(job_id: str, authorization: Optional[str] = Header(None)) -> FileResponse:
        verify_auth(authorization)
        try:
            job = lan.get_job(job_id)
            if not job.package:
                raise HTTPException(status_code=404, detail="Job package không tồn tại")
            path = lan_artifacts.package_path(job_id)
            if not path.is_file():
                lan_artifacts.write_package(job_id, job.package)
            return FileResponse(path, media_type="application/json", filename="package.json")
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Job không tồn tại") from error

    @app.get("/api/v1/admin/jobs/{job_id}/source/{artifact_name}")
    async def get_lan_job_source(job_id: str, artifact_name: str,
                                 authorization: Optional[str] = Header(None)) -> FileResponse:
        verify_auth(authorization)
        try:
            package = JobPackage.from_dict(lan.get_job(job_id).package or {})
            metadata = next((item for item in package.artifacts
                             if item.name == artifact_name and item.kind == "source"), None)
            if metadata is None:
                raise HTTPException(status_code=404, detail="Source artifact không tồn tại")
            path = lan_artifacts.source_path(job_id, artifact_name)
            if not path.is_file() or path.stat().st_size != metadata.size_bytes or sha256_file(path) != metadata.sha256:
                raise HTTPException(status_code=409, detail="Source artifact không vượt qua xác minh")
            return FileResponse(path, media_type=metadata.content_type, filename=metadata.name)
        except (KeyError, ProtocolError) as error:
            raise HTTPException(status_code=404, detail="Job/source không tồn tại") from error

    @app.post("/api/v1/admin/jobs/{job_id}/lease")
    async def heartbeat_lan_job_lease(job_id: str, worker_id: str = Query(...),
                                      authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            job = lan.heartbeat_job_lease(worker_id, job_id)
            return {"job_id": job.job_id, "status": job.status,
                    "cancel_requested": job.status == "cancelled",
                    "lease_expires_at": job.lease_expires_at}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Job không tồn tại") from error
        except LanStateError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.put("/api/v1/admin/jobs/{job_id}/results/{artifact_name}")
    async def upload_lan_result(job_id: str, artifact_name: str, request: Request,
                                authorization: Optional[str] = Header(None),
                                x_artifact_size: int = Header(...),
                                x_artifact_sha256: str = Header(...),
                                x_artifact_kind: str = Header("result")) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            job = lan.get_job(job_id)
            if job.status == "cancelled":
                raise HTTPException(status_code=409, detail="Job đã bị hủy")
            metadata = ArtifactMetadata(artifact_name, x_artifact_kind, x_artifact_size, x_artifact_sha256)
            import io
            path = lan_artifacts.save_result(job_id, metadata, io.BytesIO(await request.body()))
            return {"status": "verified", "artifact": metadata.to_dict(),
                    "size_bytes": path.stat().st_size}
        except ProtocolError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Job không tồn tại") from error

    @app.post("/api/v1/admin/jobs/{job_id}/results/commit")
    async def commit_lan_result(job_id: str, request: Request,
                                authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            job = lan.get_job(job_id)
            result = ResultPackage.from_dict(await request.json())
            if result.job_id != job_id or result.project_id != job.project_id:
                raise ProtocolError("Định danh ResultPackage không khớp")
            for artifact in result.artifacts:
                lan_artifacts.verified_result(job_id, artifact)
            imported = ProjectManifestV1.from_dict(result.project)
            repository.save_project(imported)
            repository.save_cues(imported.project_id,
                                 [SubtitleCueV1.from_dict(item) for item in result.cues])
            for stage in result.stage_runs:
                repository.save_stage_run(imported.project_id, StageRunV1.from_dict(stage))
            completed = lan.update_job(job_id, {"status": "completed", "progress": 1.0,
                                                "result": result.to_dict()})
            return {"status": "completed", "job": completed.to_dict(),
                    "project_id": imported.project_id,
                    "source_video_path": imported.source_video_path,
                    "artifacts": [item.to_dict() for item in result.artifacts]}
        except ProtocolError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Job không tồn tại") from error

    @app.patch("/api/v1/admin/jobs/{job_id}")
    async def update_lan_job(job_id: str, request: LanJobUpdateRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            data = request.model_dump(exclude_none=True) if hasattr(request, "model_dump") else request.dict(exclude_none=True)
            result = lan.update_job(job_id, data).to_dict()
            await broadcast_lan("job_updated", result, job_id=job_id)
            return result
        except LanLeaseError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except LanStateError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Job không tồn tại") from error

    @app.post("/api/v1/admin/jobs/{job_id}/cancel")
    async def cancel_lan_job(job_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            result = lan.cancel_job(job_id).to_dict()
            await broadcast_lan("job_cancelled", result, job_id=job_id)
            return result
        except LanStateError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Job không tồn tại") from error

    @app.post("/api/v1/admin/jobs/{job_id}/retry")
    async def retry_lan_job(job_id: str, request: Optional[LanJobRetryRequest] = None,
                            authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            stage_plan = request.stage_plan if request and request.stage_plan is not None else None
            result = lan.retry_job(job_id, stage_plan=stage_plan).to_dict()
            await broadcast_lan("job_retried", result, job_id=job_id)
            return result
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Job không tồn tại") from error

    @app.post("/api/v1/admin/downloads/preview")
    async def create_download_preview(request: DownloadPreviewRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            data = request.model_dump() if hasattr(request, "model_dump") else request.dict()
            result = lan.create_download_preview(data).to_dict()
            await broadcast_lan("download_preview_created", result)
            return result
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Worker không tồn tại") from error

    @app.get("/api/v1/admin/downloads")
    async def list_download_approvals(status: Optional[str] = Query(None), authorization: Optional[str] = Header(None)) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        return lan.list_downloads(status=status)

    @app.post("/api/v1/admin/downloads/{request_id}/decision")
    async def decide_download(request_id: str, request: DownloadDecisionRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            result = lan.decide_download(request_id, request.approved).to_dict()
            await broadcast_lan("download_decided", result)
            return result
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Yêu cầu tải không tồn tại") from error

    @app.post("/api/v1/admin/workers/{worker_id}/claim-download")
    async def claim_worker_download(worker_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            item = lan.claim_download(worker_id)
            if item:
                await broadcast_lan("download_claimed", item.to_dict())
            return {"download": item.to_dict() if item else None}
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Worker không tồn tại") from error

    @app.patch("/api/v1/admin/downloads/{request_id}")
    async def update_lan_download(request_id: str, request: DownloadUpdateRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            result = lan.update_download(request_id, {"status": request.status}).to_dict()
            await broadcast_lan("download_updated", result)
            return result
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Yêu cầu tải không tồn tại") from error

    @app.get("/api/v1/projects")
    async def list_projects(authorization: Optional[str] = Header(None)) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        projects = repository.list_projects()
        results = []
        for p in projects:
            d = p.to_dict()
            cues = repository.get_cues(p.project_id)
            d["cues_count"] = len(cues)
            translated = [c for c in cues if (c.translated_text or "").strip()]
            d["translated_count"] = len(translated)
            if cues:
                first_c = cues[0]
                d["first_cue_text"] = first_c.translated_text or first_c.source_text
                d["first_cue_original"] = first_c.source_text
            else:
                d["first_cue_text"] = ""
                d["first_cue_original"] = ""

            voiceover_path = (resolved_output_root / p.project_id / f"voiceover_{p.project_id}.mp3").resolve()
            voiceover_exists = voiceover_path.exists() and voiceover_path.stat().st_size > 0
            d["has_voiceover"] = voiceover_exists
            d["voiceover_path"] = str(voiceover_path) if voiceover_exists else None
            d["voiceover_file_size_bytes"] = voiceover_path.stat().st_size if voiceover_exists else 0
            export_path = resolved_output_root / p.project_id / f"{Path(p.source_video_path).stem}-localized.mp4"
            export_exists = export_path.exists() and export_path.stat().st_size > 0
            d["has_export"] = export_exists
            d["export_path"] = str(export_path.resolve()) if export_exists else None
            d["export_file_size_bytes"] = export_path.stat().st_size if export_exists else 0
            d["export_verified"] = export_exists
            try:
                d["source_video_resolved_path"] = str(Path(p.source_video_path).resolve())
            except Exception:
                d["source_video_resolved_path"] = p.source_video_path

            if "duration" not in d or not d.get("duration"):
                if p.media_metadata and "duration" in p.media_metadata:
                    d["duration"] = p.media_metadata["duration"]

            results.append(d)
        return results

    def _inspect_video_media(video_path: Path):
        try:
            import cv2
            from subtitle_localizer.detector.roi import propose_default_roi
            cap = cv2.VideoCapture(str(video_path))
            vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
            vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
            fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
            duration = round(frame_count / fps, 2) if fps > 0 else 0.0
            cap.release()
            return [propose_default_roi(vw, vh)], {
                "width": vw,
                "height": vh,
                "fps": fps,
                "duration": duration,
            }
        except Exception:
            return [], {"width": 1920, "height": 1080, "fps": 25.0, "duration": 0.0}

    @app.post("/api/v1/projects")
    async def create_project(req: CreateProjectRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        media_items = [dict(item) for item in req.media_items if item.get("source_video_path")]
        if not media_items:
            media_items = [{"source_video_path": req.source_video_path}]
        primary_path = str(media_items[0]["source_video_path"])
        manifest = ProjectManifestV1(
            project_id=f"proj-{uuid.uuid4().hex[:8]}",
            title=req.title,
            source_video_path=primary_path,
            video_fingerprint="fp_" + uuid.uuid4().hex[:12],
            source_language=req.source_language,
            target_language=req.target_language,
            active_revision=1,
            media_items=media_items,
        )
        video_path = Path(manifest.source_video_path)
        if video_path.exists() and video_path.is_file():
            regions, metadata = await asyncio.to_thread(_inspect_video_media, video_path)
            if regions:
                manifest.regions = regions
            manifest.media_metadata = metadata
        repository.save_project(manifest)
        return manifest.to_dict()

    @app.post("/api/v1/projects/batch-create")
    async def batch_create_projects(req: BatchCreateProjectsRequest, authorization: Optional[str] = Header(None)) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        created_projects = []
        items = list(req.items)
        for group in req.folder_groups:
            videos = [str(path) for path in group.get("videos", []) if path]
            if videos:
                items.append(CreateProjectRequest(
                    title=str(group.get("title") or Path(videos[0]).parent.name or "Project"),
                    source_video_path=videos[0],
                    source_language=str(group.get("source_language", "zh")),
                    target_language=str(group.get("target_language", "vi")),
                    media_items=[{"source_video_path": path} for path in videos],
                ))
        for item in items:
            media_items = [dict(media) for media in item.media_items if media.get("source_video_path")]
            if not media_items:
                media_items = [{"source_video_path": item.source_video_path}]
            manifest = ProjectManifestV1(
                project_id=f"proj-{uuid.uuid4().hex[:8]}",
                title=item.title,
                source_video_path=str(media_items[0]["source_video_path"]),
                video_fingerprint="fp_" + uuid.uuid4().hex[:12],
                source_language=item.source_language,
                target_language=item.target_language,
                active_revision=1,
                media_items=media_items,
            )
            if req.regions:
                manifest.regions = [
                    RegionTrackV1(
                        region_id=r.get("region_id", f"roi-{idx}"),
                        x=float(r.get("x", 0.06)),
                        y=float(r.get("y", 0.81)),
                        width=float(r.get("width", 0.88)),
                        height=float(r.get("height", 0.15)),
                        mask_enabled=bool(r.get("mask_enabled", True)),
                    )
                    for idx, r in enumerate(req.regions)
                ]
            video_path = Path(manifest.source_video_path)
            if video_path.exists() and video_path.is_file():
                regions, metadata = await asyncio.to_thread(_inspect_video_media, video_path)
                if not req.regions and regions:
                    manifest.regions = regions
                manifest.media_metadata = metadata
            repository.save_project(manifest)
            created_projects.append(manifest.to_dict())
        return created_projects

    @app.get("/api/v1/projects/{project_id}")
    async def get_project(project_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        d = project.to_dict()
        cues = repository.get_cues(project_id)
        d["cues_count"] = len(cues)
        translated = [c for c in cues if (c.translated_text or "").strip()]
        d["translated_count"] = len(translated)
        if cues:
            first_c = cues[0]
            d["first_cue_text"] = first_c.translated_text or first_c.source_text
            d["first_cue_original"] = first_c.source_text
        else:
            d["first_cue_text"] = ""
            d["first_cue_original"] = ""

        voiceover_path = (resolved_output_root / project_id / f"voiceover_{project_id}.mp3").resolve()
        voiceover_exists = voiceover_path.exists() and voiceover_path.stat().st_size > 0
        d["has_voiceover"] = voiceover_exists
        d["voiceover_path"] = str(voiceover_path) if voiceover_exists else None
        d["voiceover_file_size_bytes"] = voiceover_path.stat().st_size if voiceover_exists else 0
        export_path = resolved_output_root / project_id / f"{Path(project.source_video_path).stem}-localized.mp4"
        export_exists = export_path.exists() and export_path.stat().st_size > 0
        d["has_export"] = export_exists
        d["export_path"] = str(export_path.resolve()) if export_exists else None
        d["export_file_size_bytes"] = export_path.stat().st_size if export_exists else 0
        d["export_verified"] = export_exists
        try:
            d["source_video_resolved_path"] = str(Path(project.source_video_path).resolve())
        except Exception:
            d["source_video_resolved_path"] = project.source_video_path

        if "duration" not in d or not d.get("duration"):
            if project.media_metadata and "duration" in project.media_metadata:
                d["duration"] = project.media_metadata["duration"]

        return d

    @app.delete("/api/v1/projects/{project_id}")
    async def delete_project(project_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, bool]:
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if manifest:
            # Prevent stale voiceover metadata from surviving cue/project removal.
            manifest.has_voiceover = False
            manifest.voiceover_path = None
            repository.save_project(manifest)
        deleted = repository.delete_project(project_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"deleted": True}

    @app.post("/api/v1/projects/batch-delete")
    async def batch_delete_projects(req: BatchDeleteProjectsRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        deleted_count = 0
        for pid in req.project_ids:
            try:
                if repository.delete_project(pid):
                    deleted_count += 1
            except Exception:
                pass
        return {"deleted_count": deleted_count, "total": len(req.project_ids)}

    @app.post("/api/v1/downloader/parse")
    async def parse_download_target(req: DownloadParseRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            return parse_media_target(
                req.target,
                proxy=req.proxy,
                strict_proxy=req.strict_proxy if req.strict_proxy is not None else True,
            )
        except ValueError as ve:
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.post("/api/v1/downloader/start")
    async def start_download(req: DownloadStartRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            download_manager.start_download(
                target_info=req.target_info,
                episodes=req.episodes,
                start_ep=req.start_ep,
                end_ep=req.end_ep,
                output_dir=req.output_dir,
                auto_create_project=req.auto_create_project,
                source_language=req.source_language,
                target_language=req.target_language,
                proxy=req.proxy,
                proxy_list=req.proxy_list,
                strict_proxy=req.strict_proxy if req.strict_proxy is not None else True,
                cdn_direct_bypass=req.cdn_direct_bypass if req.cdn_direct_bypass is not None else False,
                rate_limit_delay=req.rate_limit_delay,
                rotate_device_each_ep=req.rotate_device_each_ep,
                rotation_interval=req.rotation_interval,
                target_resolution=req.target_resolution or "best",
                concurrency=req.concurrency or 3,
                cookie_source=req.cookie_source or "none",
                auto_xray=req.auto_xray if req.auto_xray is not None else False,
            )
            return {"status": "started"}
        except RuntimeError as re:
            raise HTTPException(status_code=409, detail=str(re))
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.get("/api/v1/downloader/status")
    async def get_download_status(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        return download_manager.get_status()

    @app.post("/api/v1/downloader/cancel")
    async def cancel_download(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        download_manager.cancel()
        return {"status": "cancelling"}

    # -------------------------------------------------------------------------
    # Queue Management Endpoints (R4)
    # -------------------------------------------------------------------------

    @app.post("/api/v1/downloader/queue/add", response_model=DownloadQueueAddResponse)
    async def add_to_download_queue(
        req: DownloadQueueAddRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            task = download_manager.add_to_queue(
                target_info=req.target_info,
                episodes=req.episodes,
                start_ep=req.start_ep,
                end_ep=req.end_ep,
                output_dir=req.output_dir,
                auto_create_project=req.auto_create_project,
                source_language=req.source_language,
                target_language=req.target_language,
                proxy=req.proxy,
                proxy_list=req.proxy_list,
                strict_proxy=req.strict_proxy if req.strict_proxy is not None else True,
                cdn_direct_bypass=req.cdn_direct_bypass if req.cdn_direct_bypass is not None else False,
                rate_limit_delay=req.rate_limit_delay,
                rotate_device_each_ep=req.rotate_device_each_ep,
                rotation_interval=req.rotation_interval,
                target_resolution=req.target_resolution or "best",
                concurrency=req.concurrency or 3,
                cookie_source=req.cookie_source or "none",
                auto_xray=req.auto_xray if req.auto_xray is not None else False,
            )

            queue_info = download_manager.get_queue()
            tasks = queue_info.get("tasks", [])
            position = 1
            for idx, t in enumerate(tasks, start=1):
                if t.get("task_id") == task.task_id:
                    position = idx
                    break

            return {
                "success": True,
                "task_id": task.task_id,
                "position": position,
                "message": "Đã thêm phim vào hàng đợi thành công",
            }
        except ValueError as ve:
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as ex:
            raise HTTPException(status_code=400, detail=str(ex))

    @app.get("/api/v1/downloader/queue/list", response_model=DownloadQueueListResponse)
    async def list_download_queue(
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        return download_manager.get_queue()

    @app.post("/api/v1/downloader/queue/pause", response_model=DownloadQueuePauseResponse)
    async def pause_download_queue(
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        download_manager.pause_queue()
        return {
            "success": True,
            "is_paused": True,
            "message": "Đã tạm dừng điều phối hàng đợi",
        }

    @app.post("/api/v1/downloader/queue/resume", response_model=DownloadQueueResumeResponse)
    async def resume_download_queue(
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        download_manager.resume_queue()
        return {
            "success": True,
            "is_paused": False,
            "message": "Đã tiếp tục điều phối hàng đợi",
        }

    @app.delete("/api/v1/downloader/queue/{task_id}")
    async def delete_download_queue_task(
        task_id: str,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        removed = download_manager.remove_from_queue(task_id)
        if not removed:
            return {"success": False, "message": f"Không tìm thấy tác vụ '{task_id}' trong hàng đợi"}
        return {
            "success": True,
            "message": f"Đã xóa tác vụ {task_id} khỏi hàng đợi",
        }

    @app.post("/api/v1/downloader/queue/{task_id}/retry")
    async def retry_download_queue_task(
        task_id: str,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        retried = download_manager.retry_queue_task(task_id)
        if not retried:
            return {"success": False, "message": f"Không thể thử lại tác vụ '{task_id}' (chỉ có thể thử lại khi trạng thái là lỗi hoặc đã dừng)"}
        return {
            "success": True,
            "message": f"Đã đưa tác vụ {task_id} vào hàng đợi để tải lại",
        }

    @app.post("/api/v1/downloader/queue/reorder", response_model=DownloadQueueReorderResponse)
    async def reorder_download_queue(
        req: DownloadQueueReorderRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        ordered_ids = download_manager.reorder_queue(req.task_id, req.direction)
        return {
            "success": True,
            "tasks": ordered_ids,
            "message": "Đã sắp xếp lại thứ tự hàng đợi thành công",
        }

    # -------------------------------------------------------------------------
    # Directory, Episode Scan & Cover Endpoints (R1, R2, R5)
    # -------------------------------------------------------------------------

    @app.post("/api/v1/downloader/directory/validate", response_model=DirectoryValidateResponse)
    async def validate_directory_endpoint(
        req: DirectoryValidateRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        return download_manager.validate_directory(req.path, req.auto_create)

    @app.post("/api/v1/downloader/scan-episodes", response_model=ScanEpisodesResponse)
    async def scan_episodes_endpoint(
        req: ScanEpisodesRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        return download_manager.scan_disk_episodes(req.title, req.total_episodes, req.output_dir)

    @app.post("/api/v1/downloader/download-cover", response_model=DownloadCoverResponse)
    async def download_cover_endpoint(
        req: DownloadCoverRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            if not req.cover_url or not req.cover_url.strip():
                raise HTTPException(status_code=400, detail="cover_url không được để trống")
            saved_path = download_manager.download_cover(
                cover_url=req.cover_url,
                output_dir=req.output_dir,
                filename=req.filename or "cover.jpg",
                proxy=req.proxy,
            )
            return {
                "success": True,
                "file_path": str(saved_path),
                "message": "Đã tải ảnh bìa thành công",
            }
        except HTTPException:
            raise
        except Exception as exc:
            return {
                "success": False,
                "file_path": "",
                "message": f"Lỗi tải ảnh bìa: {exc}",
            }

    @app.post("/api/v1/downloader/test-proxy")
    async def test_proxy(req: TestProxyRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        return test_proxy_connection(req.proxy)

    @app.get("/api/v1/downloader/proxy/status", response_model=ProxyStatusResponse)
    async def get_proxy_status(
        proxy_url: Optional[str] = Query(None),
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.service.downloader import check_proxy_status
        return check_proxy_status(proxy_url)

    @app.get("/api/v1/downloader/proxy/pool")
    async def get_proxy_pool(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        return download_manager.get_proxy_pool_status()

    @app.get("/api/v1/downloader/xray/status", response_model=XrayStatusResponse)
    async def get_xray_status_endpoint(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.downloader.xray_service import XrayService
        return XrayService.get_instance().get_status()

    @app.post("/api/v1/downloader/xray/refresh", response_model=XrayStatusResponse)
    async def refresh_xray_nodes_endpoint(
        req: Optional[XrayRefreshRequest] = None,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.downloader.xray_service import XrayService
        svc = XrayService.get_instance()
        custom = req.custom_feed_or_nodes if req else None
        max_lat = req.max_latency_ms if (req and req.max_latency_ms is not None) else 800.0
        svc.refresh_quality_nodes(custom_feed_or_nodes=custom, max_latency_ms=max_lat)
        if svc.is_running():
            svc.switch_to_fastest()
        return svc.get_status()

    @app.post("/api/v1/downloader/xray/toggle")
    async def toggle_xray_endpoint(
        req: XrayToggleRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.downloader.xray_service import XrayService
        svc = XrayService.get_instance()
        is_enabled = svc.toggle_enabled(req.enabled)
        return {"success": True, "is_enabled": is_enabled, "status": svc.get_status()}

    @app.post("/api/v1/downloader/xray/switch")
    async def switch_xray_node_endpoint(
        req: XraySwitchNodeRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.downloader.xray_service import XrayService
        svc = XrayService.get_instance()
        switched = svc.switch_node_by_name(req.node_name)
        if not switched:
            raise HTTPException(status_code=400, detail=f"Không thể chuyển sang node '{req.node_name}'")
        return {"success": True, "status": svc.get_status()}


    @app.get("/api/v1/downloader/device")
    async def get_device_info(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        return parser.get_device_status_info()

    @app.post("/api/v1/downloader/device/rotate")
    async def rotate_device_endpoint(req: Optional[RotateDeviceRequest] = None, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        proxy = req.proxy if req else None
        parser.rotate_device(proxy=proxy)
        info = parser.get_device_status_info()
        info["message"] = "Đã cấp phát thiết bị mới thành công!"
        return info

    @app.post("/api/v1/downloader/device/custom")
    async def save_custom_device(req: CustomDeviceRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        parser.save_device_keys(req.device_id, req.install_id, req.platform)
        info = parser.get_device_status_info()
        info["message"] = "Đã lưu thông tin thiết bị tùy chỉnh!"
        return info

    # -------------------------------------------------------------------------
    # Platform Auth, QR Login & Universal Video Search Endpoints
    # -------------------------------------------------------------------------

    @app.get("/api/v1/downloader/auth/status")
    async def get_auth_status(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.downloader.platform_auth import platform_auth
        return platform_auth.list_auth_status()

    @app.post("/api/v1/downloader/auth/bilibili/qr/generate")
    async def generate_bilibili_qr_endpoint(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.downloader.platform_auth import platform_auth
        try:
            return platform_auth.generate_bilibili_qr()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    @app.get("/api/v1/downloader/auth/bilibili/qr/poll")
    async def poll_bilibili_qr_endpoint(qrcode_key: str = Query(...), authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.downloader.platform_auth import platform_auth
        try:
            return platform_auth.poll_bilibili_qr(qrcode_key)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    @app.post("/api/v1/downloader/auth/cookies")
    async def save_platform_cookie_endpoint(req: SavePlatformCookieRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.downloader.platform_auth import platform_auth
        platform_auth.save_cookie(req.platform, req.cookie)
        return {"success": True, "message": f"Đã lưu cookie cho nền tảng {req.platform}!"}

    @app.delete("/api/v1/downloader/auth/cookies/{platform}")
    async def delete_platform_cookie_endpoint(platform: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.downloader.platform_auth import platform_auth
        deleted = platform_auth.delete_cookie(platform)
        return {"success": deleted, "message": f"Đã đăng xuất/xóa cookie {platform}!"}

    @app.post("/api/v1/downloader/search")
    async def search_videos_endpoint(req: VideoSearchRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.downloader.bilibili_extractor import search_bilibili_videos, search_youtube_videos
        from subtitle_localizer.downloader.platform_auth import platform_auth
        from subtitle_localizer.downloader.download_history import is_item_downloaded
        p = req.platform.lower()
        if p == "bilibili":
            cookie = platform_auth.get_cookie("bilibili") or platform_auth.ensure_bilibili_guest_cookies()
            results = search_bilibili_videos(
                req.keyword,
                cookie=cookie,
                page=req.page,
                order=req.order,
                duration=req.duration,
                must_contain=req.must_contain,
                must_not_contain=req.must_not_contain,
                auto_translate=req.auto_translate,
                translate_titles=req.translate_titles,
            )
        elif p == "youtube":
            results = search_youtube_videos(
                req.keyword,
                max_results=16,
                must_contain=req.must_contain,
                must_not_contain=req.must_not_contain,
                translate_titles=req.translate_titles,
            )
        else:
            results = []

        for r in results:
            item_id = r.get("bvid") or r.get("id") or r.get("url")
            r["downloaded"] = bool(item_id and is_item_downloaded(item_id))

        return {"results": results, "platform": p}

    @app.post("/api/v1/downloader/history/clear")
    async def clear_download_history_endpoint(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        from subtitle_localizer.downloader.download_history import clear_download_history
        clear_download_history()
        return {"success": True, "message": "Đã xóa toàn bộ lịch sử tải xuống cục bộ."}

    @app.get("/api/v1/projects/{project_id}/cues")
    async def get_cues(project_id: str, authorization: Optional[str] = Header(None)) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        cues = repository.get_cues(project_id)
        return [c.to_dict() for c in cues]

    @app.put("/api/v1/projects/{project_id}/cues")
    async def save_cues(
        project_id: str,
        cues_data: List[Dict[str, Any]],
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        cues = [SubtitleCueV1.from_dict(c) for c in cues_data]
        repository.save_cues(project_id, cues)
        return {"saved_count": len(cues)}

    @app.post("/api/v1/projects/{project_id}/import-capcut-draft")
    async def import_capcut_draft(
        project_id: str,
        req: Optional[ImportCapCutDraftRequest] = None,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Nạp trực tiếp danh sách phụ đề từ CapCut Desktop Draft vào dự án Studio hiện tại."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        from subtitle_localizer.cloud.capcut_bridge import CapCutBridgeExtractor
        extractor = CapCutBridgeExtractor()
        draft_id = req.draft_id if req else None
        draft_path = req.draft_path if req else None

        video_path = Path(manifest.source_video_path) if manifest.source_video_path else Path("video.mp4")
        cues = extractor.extract_cues(
            video_path=video_path,
            source_lang=manifest.source_language,
            draft_id=draft_id,
            draft_path=draft_path,
        )
        existing_cues = repository.get_cues(project_id)
        has_new_translations = any(c.translated_text for c in cues)
        has_existing_cues = len(existing_cues) > 0

        if has_existing_cues and has_new_translations:
            # Ghép thông minh: Gán bản dịch tiếng Việt từ CapCut vào câu gốc tương ứng theo mốc thời gian
            for cap_cue in cues:
                if not cap_cue.translated_text:
                    continue
                best_match = None
                max_overlap = 0.0
                for ex_cue in existing_cues:
                    overlap = max(0.0, min(cap_cue.end_pts, ex_cue.end_pts) - max(cap_cue.start_pts, ex_cue.start_pts))
                    if overlap > max_overlap:
                        max_overlap = overlap
                        best_match = ex_cue
                if best_match and max_overlap >= 0.2:
                    best_match.translated_text = cap_cue.translated_text
                    best_match.status = "reviewed"
            final_cues = existing_cues
        else:
            final_cues = cues

        repository.save_cues(project_id, final_cues)
        manifest.cues_count = len(final_cues)
        manifest.translated_count = len([c for c in final_cues if (c.translated_text or "").strip()])
        repository.save_project(manifest)

        return {
            "status": "success",
            "imported_count": len(cues),
            "cues_count": manifest.cues_count,
            "translated_count": manifest.translated_count,
            "cues": [c.to_dict() for c in final_cues],
        }

    @app.put("/api/v1/projects/{project_id}/regions")
    async def save_regions(
        project_id: str,
        regions_data: List[Dict[str, Any]],
        authorization: Optional[str] = Header(None),
    ) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        regions = [RegionTrackV1.from_dict(region) for region in regions_data]
        invalid_ids = [region.region_id for region in regions if not region.is_valid()]
        if invalid_ids:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid normalized ROI: {', '.join(invalid_ids)}",
            )

        # Cập nhật nguyên tử không ghi đè custom_pipeline_settings nếu có request song song
        updated = repository.patch_project(project_id, patch_data={"regions": regions})
        if not updated:
            raise HTTPException(status_code=404, detail="Project not found")
        return [region.to_dict() for region in (updated.regions or [])]

    @app.get("/api/v1/projects/{project_id}/settings")
    async def get_project_settings(
        project_id: str,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")
        return manifest.custom_pipeline_settings or {}

    @app.put("/api/v1/projects/{project_id}/settings")
    async def save_project_settings(
        project_id: str,
        settings_data: Dict[str, Any],
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")
        # Cập nhật nguyên tử không ghi đè regions nếu có request song song
        updated = repository.patch_project(project_id, patch_data={"custom_pipeline_settings": settings_data})
        if not updated:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"status": "success", "custom_pipeline_settings": updated.custom_pipeline_settings}

    @app.delete("/api/v1/projects/{project_id}/settings")
    async def reset_project_settings(
        project_id: str,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")
        updated = repository.patch_project(project_id, patch_data={"custom_pipeline_settings": None})
        if not updated:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"status": "success", "custom_pipeline_settings": None}

    @app.put("/api/v1/projects/{project_id}/editor-state")
    async def save_editor_state(
        project_id: str,
        payload: Dict[str, Any],
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Cập nhật đồng bộ nguyên tử cả ROI/Regions và Cài đặt Settings trong 1 transaction SQLite duy nhất."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        patch_data: Dict[str, Any] = {}
        if "regions" in payload and payload["regions"] is not None:
            raw_regions = payload["regions"]
            parsed_regions = [RegionTrackV1.from_dict(r) if isinstance(r, dict) else r for r in raw_regions]
            invalid_ids = [r.region_id for r in parsed_regions if not r.is_valid()]
            if invalid_ids:
                raise HTTPException(
                    status_code=422,
                    detail=f"Invalid normalized ROI: {', '.join(invalid_ids)}",
                )
            patch_data["regions"] = parsed_regions

        if "settings" in payload:
            patch_data["custom_pipeline_settings"] = payload["settings"]

        updated = repository.patch_project(project_id, patch_data=patch_data)
        if not updated:
            raise HTTPException(status_code=404, detail="Project not found")

        return {
            "status": "success",
            "project_id": project_id,
            "revision": updated.active_revision,
            "regions": [r.to_dict() for r in (updated.regions or [])],
            "settings": updated.custom_pipeline_settings,
        }

    @app.post("/api/v1/projects/{project_id}/pipeline/run")
    async def run_pipeline(
        project_id: str,
        req: Optional[PipelineRunRequest] = None,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        max_dur = req.max_duration_seconds if req else None
        is_sync = req.sync if req else False
        is_ocr_only = bool(req.ocr_only) if req else False

        if is_sync:
            success = worker.run_pipeline_synchronous(
                project_id, max_duration_seconds=max_dur, ocr_only=is_ocr_only
            )
            if not success:
                raise HTTPException(status_code=400, detail="Failed to run pipeline")
            return {"status": "success", "project_id": project_id, "ocr_only": is_ocr_only}

        with running_lock:
            if project_id in running_project_ids:
                return {
                    "status": "running",
                    "project_id": project_id,
                    "max_duration_seconds": max_dur,
                    "ocr_only": is_ocr_only,
                }
            running_project_ids.add(project_id)

        # Xóa các stage cũ để client không bị nhận nhầm kết quả completed của đợt trước
        repository.clear_stage_runs(project_id)

        # Initialize detector stage run
        stage_init = StageRunV1(
            stage_name="detector",
            status="running",
            progress=0.05,
            metrics={"label": "Khởi động pipeline xử lý..."},
            start_time=time.time(),
        )
        repository.save_stage_run(project_id, stage_init)

        def _bg_run():
            try:
                worker.run_pipeline_synchronous(
                    project_id, max_duration_seconds=max_dur, ocr_only=is_ocr_only
                )
            except Exception as e:
                repository.save_stage_run(
                    project_id,
                    StageRunV1(
                        stage_name="pipeline",
                        status="failed",
                        progress=0.0,
                        metrics={"label": "Pipeline thất bại", "error": str(e)},
                        errors=[str(e)],
                        end_time=time.time(),
                    ),
                )
                import traceback
                traceback.print_exc()
            finally:
                with running_lock:
                    running_project_ids.discard(project_id)

        thread = threading.Thread(target=_bg_run, daemon=True)
        thread.start()

        return {
            "status": "running",
            "project_id": project_id,
            "max_duration_seconds": max_dur,
            "ocr_only": is_ocr_only,
        }

    @app.post("/api/v1/projects/{project_id}/pipeline/stop")
    @app.post("/api/v1/projects/{project_id}/pipeline/cancel")
    async def stop_pipeline(
        project_id: str,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        worker.cancel_project(project_id)
        with running_lock:
            running_project_ids.discard(project_id)

        # Remove stale stage rows before recording the single cancellation
        # marker; otherwise a previous running detector row remains visible.
        repository.clear_stage_runs(project_id)

        cancel_stage = StageRunV1(
            stage_name="cancelled",
            status="cancelled",
            progress=0.0,
            metrics={"label": "Tiến trình quét phụ đề đã được dừng theo yêu cầu"},
            end_time=time.time(),
        )
        repository.save_stage_run(project_id, cancel_stage)

        try:
            await ws_manager.broadcast_event(
                project_id=project_id,
                event_type="pipeline_cancelled",
                payload={"message": "Đã dừng tiến trình theo yêu cầu"},
            )
        except Exception:
            pass

        return {"status": "cancelled", "project_id": project_id}

    @app.get("/api/v1/projects/{project_id}/stages")
    async def get_project_stages(
        project_id: str,
        authorization: Optional[str] = Header(None),
    ) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        stages = repository.get_stage_runs(project_id)
        return [s.to_dict() for s in stages]

    @app.get("/api/v1/projects/{project_id}/audio-waveform")
    async def get_audio_waveform(
        project_id: str,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Trích xuất sóng âm thanh (Audio Waveform Peaks) thực tế từ video chuẩn NLE."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        video_path = Path(manifest.source_video_path)
        if not video_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")

        cache_key = f"waveform_{project_id}"
        if hasattr(app.state, cache_key):
            return getattr(app.state, cache_key)

        import subprocess
        import numpy as np
        try:
            cmd = [
                "ffmpeg", "-i", str(video_path),
                "-vn", "-ac", "1", "-ar", "1000", "-f", "s16le", "-"
            ]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            raw_audio, _ = proc.communicate(timeout=10)
            samples = np.frombuffer(raw_audio, dtype=np.int16)
            total_points = 800
            chunk_size = max(1, len(samples) // total_points)
            peaks = [float(np.max(np.abs(samples[i:i+chunk_size])) / 32768.0) for i in range(0, len(samples), chunk_size)]
            max_p = max(peaks) if peaks else 1.0
            if max_p > 0:
                peaks = [round(p / max_p, 3) for p in peaks]
            duration = float(len(samples)) / 1000.0
            res = {"duration": duration, "peaks": peaks}
            setattr(app.state, cache_key, res)
            return res
        except Exception:
            return {"duration": 30.0, "peaks": [0.05] * 100}

    @app.post("/api/v1/projects/{project_id}/retranslate")
    async def retranslate_project(
        project_id: str,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Dịch lại toàn bộ kịch bản phim theo đúng mạch truyện và ngữ cảnh nhân vật."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        cues = repository.get_cues(project_id)
        if not cues:
            raise HTTPException(
                status_code=400,
                detail="Dự án chưa có phụ đề để dịch. Hãy quét phụ đề trước.",
            )

        repository.save_stage_run(project_id, StageRunV1(stage_name="translation", status="running", progress=0.0, metrics={"label": "Đang dịch lại phụ đề"}))
        translator = worker.translation_registry.get_provider_for_pair(
            manifest.source_language, manifest.target_language
        )
        translator.load()
        try:
            translated_cues = translator.translate_cues(
                cues, source_lang=manifest.source_language, target_lang=manifest.target_language
            )
            translated_cues = normalize_sequential_cues(translated_cues)
            repository.save_cues(project_id, translated_cues)
            # Lấy bản ghi manifest mới nhất từ database để tránh ghi đè snapshot cũ làm mất cấu hình ROI/Style
            current_manifest = repository.get_project(project_id) or manifest
            current_manifest.cues_count = len(translated_cues)
            current_manifest.translated_count = sum(1 for c in translated_cues if bool((c.translated_text or "").strip()))
            repository.save_project(current_manifest)
            repository.save_stage_run(project_id, StageRunV1(stage_name="translation", status="completed", progress=1.0, metrics={"label": f"Đã dịch {len(translated_cues)} câu"}, end_time=time.time()))
            return {"status": "success", "cues_count": len(translated_cues), "translated_count": current_manifest.translated_count}
        except Exception as error:
            repository.save_stage_run(project_id, StageRunV1(stage_name="translation", status="failed", metrics={"label": "Dịch thất bại"}, errors=[str(error)], end_time=time.time()))
            raise
        finally:
            translator.unload()

    @app.post("/api/v1/projects/{project_id}/dubbing/adapt-spoken")
    async def adapt_spoken_for_project(
        project_id: str,
        body: Optional[Dict[str, Any]] = None,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Rút gọn spoken_text theo ngân sách thời lượng (duration-budget) trước khi TTS."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")
        cues = repository.get_cues(project_id)
        if not cues:
            raise HTTPException(status_code=400, detail="Dự án chưa có phụ đề")

        from subtitle_localizer.dubbing.tts import (
            adapt_spoken_text_for_slot,
            assign_turn_taking_speaker_ids,
            available_voiceover_slot,
            clean_subtitle_text,
            cues_truly_overlap,
            normalize_dubbing_mode,
            parse_speaking_rate,
            required_voices_count,
        )

        settings = merge_pipeline_settings(overrides=manifest.custom_pipeline_settings)
        mode = normalize_dubbing_mode((body or {}).get("mode") or getattr(settings.dubbing, "mode", "single"))
        rate = (body or {}).get("rate") or getattr(settings.dubbing, "rate", "+0%")
        cue_id = (body or {}).get("cue_id")
        force = bool((body or {}).get("force", False))
        base_rate = parse_speaking_rate(rate)
        assign_turn_taking_speaker_ids(cues, mode=mode)

        adapted_count = 0
        warned = 0
        for idx_c, c in enumerate(cues):
            if cue_id and c.cue_id != cue_id:
                continue
            if not isinstance(c.style, dict):
                c.style = {}
            existing_spoken = str(c.style.get("spoken_text") or "").strip()
            raw = str(existing_spoken or c.translated_text or c.source_text or "").strip()
            cleaned = clean_subtitle_text(raw)
            if not cleaned:
                continue
            if existing_spoken and not force and not cue_id:
                continue
            next_cue = cues[idx_c + 1] if idx_c + 1 < len(cues) else None
            slot_mode = mode
            if mode == "multi" and next_cue is not None:
                id_a = str((c.style or {}).get("speaker_id") or "")
                id_b = str((next_cue.style or {}).get("speaker_id") or "")
                if not (cues_truly_overlap(c, next_cue) and id_a and id_b and id_a != id_b):
                    slot_mode = "single"
            slot_dur = available_voiceover_slot(c, next_cue, slot_mode)
            spoken, meta = adapt_spoken_text_for_slot(cleaned, slot_sec=slot_dur, base_rate=base_rate)
            if spoken:
                c.style["spoken_text"] = spoken
                adapted_count += 1
            if meta.get("timing_warning"):
                c.style["timing_warning"] = meta["timing_warning"]
                warned += 1
            elif "timing_warning" in c.style:
                c.style.pop("timing_warning", None)

        repository.save_cues(project_id, cues)
        return {
            "status": "completed",
            "project_id": project_id,
            "mode": mode,
            "adapted_count": adapted_count,
            "warned_count": warned,
            "required_voices": required_voices_count(cues, mode=mode),
            "cues_count": len(cues),
        }

    @app.post("/api/v1/projects/{project_id}/dubbing/run")
    async def run_dubbing(
        project_id: str,
        body: Optional[Dict[str, Any]] = None,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Tạo giọng đọc thuyết minh tiếng Việt tự động khớp mốc thời gian phụ đề bằng Edge Neural TTS."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        cues = repository.get_cues(project_id)
        if not cues:
            raise HTTPException(status_code=400, detail="Dự án chưa có phụ đề để lồng tiếng")

        settings = merge_pipeline_settings(overrides=manifest.custom_pipeline_settings)
        from subtitle_localizer.dubbing.tts import normalize_dubbing_mode, required_voices_count
        provider = (body or {}).get("provider") or getattr(settings.dubbing, "provider", "edge")
        voice = (body or {}).get("voice") or settings.dubbing.voice
        rate = (body or {}).get("rate") or settings.dubbing.rate
        mode = normalize_dubbing_mode((body or {}).get("mode") or getattr(settings.dubbing, "mode", "single"))
        voice_male = (body or {}).get("voice_male") or getattr(settings.dubbing, "voice_male", "vi-VN-NamMinhNeural")
        voice_female = (body or {}).get("voice_female") or getattr(settings.dubbing, "voice_female", "vi-VN-HoaiMyNeural")
        prompt_style = (body or {}).get("prompt_style") or getattr(settings.dubbing, "gemini_prompt_style", "dramatic")
        auto_detect_speakers = (body or {}).get("auto_detect_speakers")
        if auto_detect_speakers is None:
            auto_detect_speakers = bool(getattr(settings.dubbing, "auto_detect_speakers", True))

        # Lưu cài đặt lồng tiếng (Đơn giọng / Đa giọng, giọng chọn) riêng cho video này
        if body:
            if not manifest.custom_pipeline_settings:
                manifest.custom_pipeline_settings = {}
            if "dubbing" not in manifest.custom_pipeline_settings:
                manifest.custom_pipeline_settings["dubbing"] = {}
            manifest.custom_pipeline_settings["dubbing"]["mode"] = mode
            manifest.custom_pipeline_settings["dubbing"]["voice"] = voice
            manifest.custom_pipeline_settings["dubbing"]["voice_male"] = voice_male
            manifest.custom_pipeline_settings["dubbing"]["voice_female"] = voice_female
            manifest.custom_pipeline_settings["dubbing"]["provider"] = provider
            manifest.custom_pipeline_settings["dubbing"]["rate"] = rate
            manifest.custom_pipeline_settings["dubbing"]["auto_detect_speakers"] = bool(auto_detect_speakers)

        project_output = resolved_output_root / project_id
        project_output.mkdir(parents=True, exist_ok=True)
        out_voiceover = project_output / f"voiceover_{project_id}.mp3"
        cues_dir = project_output / "cues"
        cues_dir.mkdir(parents=True, exist_ok=True)

        repository.save_stage_run(project_id, StageRunV1(stage_name="dubbing", status="running", progress=0.0, metrics={"label": "Đang tạo lồng tiếng"}))

        duration = 0.0
        try:
            from subtitle_localizer.media.probe import probe_media
            probe = probe_media(manifest.source_video_path)
            duration = float(probe.duration)
        except Exception:
            pass

        from subtitle_localizer.dubbing.tts import generate_timed_voiceover
        generated_voiceover = await generate_timed_voiceover(
            cues=cues,
            voice=voice,
            output_path=out_voiceover,
            total_duration=duration,
            rate=rate,
            mode=mode,
            voice_male=voice_male,
            voice_female=voice_female,
            provider=provider,
            prompt_style=prompt_style,
            export_cues_dir=cues_dir,
            auto_detect_speakers=bool(auto_detect_speakers),
        )

        if (not out_voiceover.exists() or out_voiceover.stat().st_size == 0) and generated_voiceover:
            candidate = Path(generated_voiceover)
            if candidate.exists() and candidate.stat().st_size > 0 and candidate != out_voiceover:
                import shutil
                shutil.copyfile(candidate, out_voiceover)

        if not out_voiceover.exists() or out_voiceover.stat().st_size == 0:
            repository.save_stage_run(
                project_id,
                StageRunV1(
                    stage_name="dubbing",
                    status="failed",
                    progress=0.0,
                    errors=["Không tạo được audio TTS; kiểm tra provider/Internet/voice."],
                    end_time=time.time(),
                ),
            )
            raise HTTPException(status_code=502, detail="TTS không tạo được file audio; dự án chưa hoàn tất")

        # Lấy manifest mới nhất từ repository để tránh ghi đè mất ROI và settings vừa được cập nhật
        current_manifest = repository.get_project(project_id) or manifest
        current_manifest.has_voiceover = True
        current_manifest.voiceover_path = str(out_voiceover).replace("\\", "/")
        current_manifest.voiceover_file_size_bytes = out_voiceover.stat().st_size if out_voiceover.exists() else 0
        if body and manifest.custom_pipeline_settings:
            if not current_manifest.custom_pipeline_settings:
                current_manifest.custom_pipeline_settings = {}
            current_manifest.custom_pipeline_settings["dubbing"] = manifest.custom_pipeline_settings.get("dubbing", {})
        repository.save_cues(project_id, cues)
        repository.save_project(current_manifest)
        repository.save_stage_run(project_id, StageRunV1(stage_name="dubbing", status="completed", progress=1.0, metrics={"label": f"Đã lồng tiếng {len(cues)} câu"}, end_time=time.time()))

        return {
            "status": "completed",
            "project_id": project_id,
            "cues_count": len(cues),
            "voice": voice,
            "mode": mode,
            "required_voices": required_voices_count(cues, mode=mode),
            "audio_url": f"/api/v1/projects/{project_id}/audio/voiceover",
        }

    @app.get("/api/v1/projects/{project_id}/audio/voiceover")
    async def get_voiceover_audio(project_id: str) -> FileResponse:
        """Tải file âm thanh thuyết minh của dự án."""
        voiceover_path = resolved_output_root / project_id / f"voiceover_{project_id}.mp3"
        if not voiceover_path.exists() or voiceover_path.stat().st_size == 0:
            raise HTTPException(status_code=404, detail="Chưa có file thuyết minh cho dự án này")
        return FileResponse(path=str(voiceover_path), media_type="audio/mpeg", filename=f"voiceover_{project_id}.mp3")

    @app.post("/api/v1/projects/{project_id}/cues/{cue_id}/dub")
    async def dub_single_cue(
        project_id: str,
        cue_id: str,
        body: Optional[Dict[str, Any]] = None,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Tạo giọng đọc thuyết minh riêng cho 1 câu phụ đề và vá vào file MP3 master."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        cues = repository.get_cues(project_id)
        target_cue = next((c for c in cues if c.cue_id == cue_id), None)
        if not target_cue:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy câu phụ đề {cue_id}")

        from subtitle_localizer.dubbing.tts import normalize_dubbing_mode
        settings = merge_pipeline_settings(overrides=manifest.custom_pipeline_settings)
        provider = (body or {}).get("provider") or getattr(settings.dubbing, "provider", "edge")
        voice = (body or {}).get("voice") or settings.dubbing.voice
        rate = (body or {}).get("rate") or settings.dubbing.rate
        prompt_style = (body or {}).get("prompt_style") or getattr(settings.dubbing, "gemini_prompt_style", "dramatic")
        mode = normalize_dubbing_mode((body or {}).get("mode") or getattr(settings.dubbing, "mode", "single"))
        voice_male = (body or {}).get("voice_male") or getattr(settings.dubbing, "voice_male", "vi-VN-NamMinhNeural")
        voice_female = (body or {}).get("voice_female") or getattr(settings.dubbing, "voice_female", "vi-VN-HoaiMyNeural")
        auto_detect_speakers = (body or {}).get("auto_detect_speakers")
        if auto_detect_speakers is None:
            auto_detect_speakers = bool(getattr(settings.dubbing, "auto_detect_speakers", True))

        project_output = resolved_output_root / project_id
        project_output.mkdir(parents=True, exist_ok=True)
        out_voiceover = project_output / f"voiceover_{project_id}.mp3"
        cues_dir = project_output / "cues"
        cues_dir.mkdir(parents=True, exist_ok=True)
        cue_audio_path = cues_dir / f"{cue_id}.mp3"

        duration = 0.0
        try:
            from subtitle_localizer.media.probe import probe_media
            probe = probe_media(manifest.source_video_path)
            duration = float(probe.duration)
        except Exception:
            pass

        from subtitle_localizer.dubbing.tts import splice_cue_voiceover
        result = await splice_cue_voiceover(
            cues=cues,
            target_cue=target_cue,
            voice=voice,
            output_path=out_voiceover,
            cue_output_path=cue_audio_path,
            total_duration=duration,
            rate=rate,
            provider=provider,
            prompt_style=prompt_style,
            mode=mode,
            voice_male=voice_male,
            voice_female=voice_female,
            auto_detect_speakers=bool(auto_detect_speakers),
        )

        manifest.has_voiceover = True
        manifest.voiceover_path = str(out_voiceover).replace("\\", "/")
        manifest.voiceover_file_size_bytes = out_voiceover.stat().st_size if out_voiceover.exists() else 0
        repository.save_cues(project_id, cues)
        repository.save_project(manifest)

        return {
            "status": "completed",
            "project_id": project_id,
            "cue_id": cue_id,
            "voice": result.get("voice", voice),
            "mode": mode,
            "duration": result.get("duration", 0.0),
            "cue_audio_url": f"/api/v1/projects/{project_id}/cues/{cue_id}/audio",
            "audio_url": f"/api/v1/projects/{project_id}/audio/voiceover",
        }

    @app.get("/api/v1/projects/{project_id}/cues/{cue_id}/audio")
    async def get_cue_audio(project_id: str, cue_id: str) -> FileResponse:
        """Phát âm thanh của 1 câu phụ đề đơn lẻ. Tự động trích đoạn từ file master nếu chưa có file lẻ."""
        cue_audio_path = resolved_output_root / project_id / "cues" / f"{cue_id}.mp3"
        if not cue_audio_path.exists() or cue_audio_path.stat().st_size == 0:
            # Tự động cắt từ file voiceover master nếu có
            master_voiceover = resolved_output_root / project_id / f"voiceover_{project_id}.mp3"
            if master_voiceover.exists() and master_voiceover.stat().st_size > 0:
                cues = repository.get_cues(project_id)
                target_cue = next((c for c in cues if c.cue_id == cue_id), None)
                if target_cue and target_cue.end_pts > target_cue.start_pts:
                    cue_audio_path.parent.mkdir(parents=True, exist_ok=True)
                    seg_dur = max(0.2, target_cue.end_pts - target_cue.start_pts)
                    import subprocess
                    cmd = [
                        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                        "-ss", f"{target_cue.start_pts:.3f}",
                        "-i", str(master_voiceover),
                        "-t", f"{seg_dur:.3f}",
                        "-c:a", "libmp3lame",
                        "-b:a", "128k",
                        str(cue_audio_path)
                    ]
                    subprocess.run(cmd, check=False)

        if not cue_audio_path.exists() or cue_audio_path.stat().st_size == 0:
            raise HTTPException(status_code=404, detail="Chưa có file âm thanh cho câu phụ đề này")
        return FileResponse(path=str(cue_audio_path), media_type="audio/mpeg", filename=f"{cue_id}.mp3")

    def _do_export_mp4(
        project_id: str,
        mask_mode: str = "blur",
        use_translated: bool = True,
        flip_h: bool = False,
        flip_v: bool = False,
        video_x: float = 0.0,
        video_y: float = 0.0,
        video_scale: float = 1.0,
        rotation: float = 0.0,
        regions_override: Optional[List[Dict[str, Any]]] = None,
        subtitle_placement: Optional[str] = "roi",
        blur_strength: Optional[int] = 20,
    ) -> str:
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if regions_override is not None:
            project.regions = [RegionTrackV1.from_dict(r) for r in regions_override]
            repository.save_project(project)

        source_path = Path(project.source_video_path)
        if not source_path.exists() or not source_path.is_file():
            raise HTTPException(status_code=404, detail="Source video not found")
        valid_mask_modes = {
            "box", "blur", "feather_tight", "optical_blend", "soft_cinema",
            "feather", "glass", "ambient", "mosaic", "gradient", "crop", "sttn_lama", "none"
        }
        if mask_mode not in valid_mask_modes:
            raise HTTPException(status_code=422, detail="Unsupported mask mode")

        from subtitle_localizer.render.ass import AssExporter
        from subtitle_localizer.render.export import VideoExporter
        from subtitle_localizer.render.mask import SubtitleMasker
        import tempfile

        ass_path: Optional[Path] = None
        try:
            project_output = resolved_output_root / project_id
            project_output.mkdir(parents=True, exist_ok=True)
            output_path = project_output / f"{source_path.stem}-localized.mp4"
            cues = repository.get_cues(project_id)

            import cv2
            cap = cv2.VideoCapture(str(source_path))
            vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
            vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
            cap.release()

            all_regions = project.regions or []
            font_size = max(24, int(vh * 0.036))
            if (subtitle_placement or "roi") == "bottom" or not all_regions:
                margin_v = int(vh * 0.06)
            else:
                # Duy nhất 1 vị trí hiển thị phụ đề: vùng có y lớn nhất (đáy màn hình)
                sub_region = sorted(all_regions, key=lambda r: getattr(r, "y", 0.0), reverse=True)[0]
                sub_y = sub_region.y * vh
                margin_v = max(10, int(vh - sub_y - (sub_region.height * vh)))

            ass_content = AssExporter(
                font_name="Arial",
                font_size=font_size,
                primary_color="&H002DFEFE",
                outline_color="&H00000000",
                outline=3,
                shadow=1,
                play_res_x=vw,
                play_res_y=vh,
                margin_v=margin_v,
                bold=1,
            ).export_ass_text(
                cues,
                script_title=project.title,
                use_translated=use_translated,
            )

            # Lọc các vùng được cấu hình làm mờ (mask_enabled != False)
            all_regions = project.regions or []
            masked_regions = [r for r in all_regions if getattr(r, "mask_enabled", True) is not False]

            mask_filter = None
            if mask_mode != "none":
                if all_regions and not masked_regions:
                    # Người dùng đã cấu hình vùng quét nhưng tất cả đều chọn "Chỉ Quét Sub / Không làm mờ"
                    mask_filter = None
                else:
                    boxes: list[tuple[int, int, int, int]] = []
                    if masked_regions:
                        for reg in masked_regions:
                            rx1 = max(0, min(vw - 2, int(reg.x * vw)))
                            ry1 = max(0, min(vh - 2, int(reg.y * vh)))
                            rx2 = max(rx1 + 2, min(vw, int((reg.x + reg.width) * vw)))
                            ry2 = max(ry1 + 2, min(vh, int((reg.y + reg.height) * vh)))
                            boxes.append((rx1, ry1, max(2, rx2 - rx1), max(2, ry2 - ry1)))
                    else:
                        boxes.append((0, int(vh * 0.8), vw, max(2, int(vh * 0.2))))
                    mask_filter = SubtitleMasker().get_multi_filter_string(boxes=boxes, mode=mask_mode, blur_strength=blur_strength or 20)

            with tempfile.NamedTemporaryFile(
                dir=project_output,
                prefix=".tmp_subtitles_",
                suffix=".ass",
                delete=False,
            ) as temporary_ass:
                ass_path = Path(temporary_ass.name)
            ass_path.write_text(ass_content, encoding="utf-8")
            rendered_path = VideoExporter().render_video(
                source_video_path=source_path,
                output_video_path=output_path,
                ass_path=ass_path,
                mask_filter=mask_filter,
                use_nvenc=True,
                flip_h=flip_h,
                flip_v=flip_v,
                rotation=rotation,
            )

            # Nếu có file lồng tiếng TTS, tự động hòa trộn vào video xuất kèm audio ducking
            voiceover_path = project_output / f"voiceover_{project_id}.mp3"
            if voiceover_path.exists() and voiceover_path.stat().st_size > 0:
                from subtitle_localizer.dubbing.tts import mix_voiceover_into_video
                temp_mixed = project_output / f".tmp_dubbed_{output_path.name}"
                merged_settings = merge_pipeline_settings(overrides=project.custom_pipeline_settings)
                actual_ducking = getattr(merged_settings.dubbing, "ducking_volume", 0.25)
                try:
                    mix_voiceover_into_video(
                        video_path=rendered_path,
                        voiceover_path=voiceover_path,
                        output_path=temp_mixed,
                        ducking_volume=actual_ducking,
                    )
                    if temp_mixed.exists() and temp_mixed.stat().st_size > 0:
                        temp_mixed.replace(rendered_path)
                except Exception as ex:
                    logger.warning(f"Không thể hòa trộn voiceover vào video xuất: {ex}")
                    if temp_mixed.exists():
                        temp_mixed.unlink(missing_ok=True)

        except (OSError, RuntimeError) as error:
            raise HTTPException(status_code=500, detail=f"MP4 export failed: {error}") from error
        finally:
            if ass_path is not None:
                try:
                    ass_path.unlink(missing_ok=True)
                except OSError:
                    pass

        if not rendered_path.exists() or not rendered_path.is_file():
            raise HTTPException(status_code=500, detail="MP4 export did not produce an output file")

        # Cập nhật trạng thái xuất file thành công vào manifest để UI hiển thị chuẩn xác
        current_manifest = repository.get_project(project_id) or project
        current_manifest.has_export = True
        current_manifest.export_path = str(rendered_path).replace("\\", "/")
        current_manifest.export_file_size_bytes = rendered_path.stat().st_size if rendered_path.exists() else 0
        repository.save_project(current_manifest)

        return str(rendered_path)

    @app.post("/api/v1/batch/run")
    async def run_batch_pipeline(
        req: BatchRunRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Chạy pipeline hàng loạt cho danh sách project (Hỗ trợ sản xuất 30+ video/ngày)."""
        verify_auth(authorization)
        results = []
        successful = 0
        failed = 0

        for pid in req.project_ids:
            manifest = repository.get_project(pid)
            if not manifest:
                results.append({"project_id": pid, "title": "Unknown", "status": "failed", "error": "Project not found"})
                failed += 1
                continue

            try:
                ok = worker.run_pipeline_synchronous(pid)
                if ok:
                    successful += 1
                    item: Dict[str, Any] = {
                        "project_id": pid,
                        "title": manifest.title,
                        "status": "completed",
                    }
                    if req.auto_export_mp4:
                        try:
                            output_mp4 = _do_export_mp4(pid, mask_mode="blur", use_translated=True)
                            item["output_mp4"] = output_mp4
                        except Exception as export_err:
                            item["export_error"] = str(export_err)
                    results.append(item)
                else:
                    failed += 1
                    results.append({
                        "project_id": pid,
                        "title": manifest.title,
                        "status": "failed",
                        "error": "Pipeline execution failed",
                    })
            except Exception as e:
                failed += 1
                results.append({
                    "project_id": pid,
                    "title": manifest.title,
                    "status": "failed",
                    "error": str(e),
                })

        return {
            "total": len(req.project_ids),
            "successful": successful,
            "failed": failed,
            "results": results,
        }

    @app.post("/api/v1/projects/{project_id}/cues/{cue_id}/retranslate")
    async def retranslate_cue(
        project_id: str,
        cue_id: str,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Dịch lại một câu phụ đề cụ thể với ngữ cảnh tươi mới."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        cues = repository.get_cues(project_id)
        target_cue = next((c for c in cues if c.cue_id == cue_id), None)
        if not target_cue:
            raise HTTPException(status_code=404, detail="Cue not found")

        translator = worker.translation_registry.get_provider_for_pair(
            manifest.source_language, manifest.target_language
        )
        translator.load()
        try:
            if hasattr(translator, "_cache") and target_cue.source_text.strip() in translator._cache:
                del translator._cache[target_cue.source_text.strip()]
            translator.translate_cues(
                [target_cue],
                source_lang=manifest.source_language,
                target_lang=manifest.target_language,
            )
            repository.save_cues(project_id, cues)
            return target_cue.to_dict()
        finally:
            translator.unload()

    @app.post("/api/v1/projects/{project_id}/roi/auto-detect")
    async def auto_detect_roi(
        project_id: str,
        req: AutoDetectRoiRequest = AutoDetectRoiRequest(),
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Tự động phát hiện vị trí dòng chữ phụ đề từ khung hình và co gọn ROI vừa khít với chữ."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        video_path = Path(manifest.source_video_path)
        if not video_path.exists():
            raise HTTPException(status_code=400, detail="Source video file not found")

        import cv2
        from rapidocr_onnxruntime import RapidOCR

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Cannot open video file")

        total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        duration = total_frames / fps if total_frames > 0 else 30.0

        pts_to_try = []
        if req.pts is not None and req.pts >= 0:
            cur_p = float(req.pts)
            pts_to_try.append(cur_p)
            for delta in [0.5, -0.5, 1.0, -1.0, 2.0, -2.0, 3.0]:
                target_p = cur_p + delta
                if 0.0 <= target_p < duration and target_p not in pts_to_try:
                    pts_to_try.append(target_p)

        for sample_t in [5.0, 10.0, 15.0, 25.0, 35.0, 45.0, 60.0]:
            if sample_t < duration and sample_t not in pts_to_try:
                pts_to_try.append(sample_t)

        try:
            from subtitle_localizer.ocr.rapid import RapidOcrProvider
            ocr_p = RapidOcrProvider()
            ocr_p.load()
            engine = ocr_p.engine
        except Exception:
            engine = None
        if engine is None:
            from rapidocr_onnxruntime import RapidOCR
            engine = RapidOCR(det_use_cuda=False, cls_use_cuda=False, rec_use_cuda=False)

        best_band = None
        best_num_lines = 0
        best_pts = 0.0

        for t in pts_to_try:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ret, frame = cap.read()
            if not ret or frame is None:
                continue
            h, w = frame.shape[:2]
            if h <= 0 or w <= 0:
                continue

            try:
                res, _ = engine(frame)
            except Exception:
                res = None

            if not res:
                continue

            # Lọc các text box có xác suất là phụ đề (nửa dưới màn hình, dạng ngang)
            cand_boxes = []
            for line in res:
                box, text, score = line
                try:
                    xs = [float(pt[0]) for pt in box]
                    ys = [float(pt[1]) for pt in box]
                    x1, y1 = min(xs), min(ys)
                    x2, y2 = max(xs), max(ys)
                except Exception:
                    poly = np.array(box)
                    x1, y1 = float(poly[:, 0].min()), float(poly[:, 1].min())
                    x2, y2 = float(poly[:, 0].max()), float(poly[:, 1].max())
                norm_y = y1 / h
                norm_h = (y2 - y1) / h
                norm_x = x1 / w
                norm_w = (x2 - x1) / w

                if 0.40 <= norm_y <= 0.92 and norm_w >= 0.08 and norm_h <= 0.10:
                    cand_boxes.append({
                        "x1": norm_x,
                        "y1": norm_y,
                        "x2": norm_x + norm_w,
                        "y2": norm_y + norm_h,
                        "cy": norm_y + norm_h / 2.0,
                        "h": norm_h,
                        "text": text,
                        "score": score,
                    })

            if not cand_boxes:
                continue

            # Gom các text box vào các dòng ngang (line clustering với khoảng cách Y < 0.025)
            cand_boxes.sort(key=lambda b: b["cy"])
            lines = []
            for b in cand_boxes:
                placed = False
                for l in lines:
                    if abs(l["cy"] - b["cy"]) < 0.025:
                        l["boxes"].append(b)
                        l["cy"] = sum(x["cy"] for x in l["boxes"]) / len(l["boxes"])
                        l["y1"] = min(l["y1"], b["y1"])
                        l["y2"] = max(l["y2"], b["y2"])
                        placed = True
                        break
                if not placed:
                    lines.append({"cy": b["cy"], "y1": b["y1"], "y2": b["y2"], "boxes": [b]})

            # Ưu tiên dải thoại đối thoại chuẩn (Y từ 0.52 đến 0.88)
            dialogue_lines = [l for l in lines if 0.52 <= l["cy"] <= 0.88]
            if not dialogue_lines:
                dialogue_lines = lines

            num_lines = len(dialogue_lines)
            top_y = min(l["y1"] for l in dialogue_lines)
            bot_y = max(l["y2"] for l in dialogue_lines)
            center_y = (top_y + bot_y) / 2.0

            # Tính chiều cao vừa khít theo số dòng phụ đề (1 dòng: 8%, 2 dòng: 12-13.5%, 3 dòng: 16-17.5%)
            if num_lines <= 1:
                tight_h = 0.080
            elif num_lines == 2:
                tight_h = min(0.135, max(0.120, (bot_y - top_y) + 0.028))
            else:
                tight_h = min(0.175, max(0.160, (bot_y - top_y) + 0.035))

            tight_y = max(0.0, min(1.0 - tight_h, center_y - tight_h / 2.0))
            tight_x = 0.03
            tight_w = 0.94  # Che full ngang màn hình

            best_band = {
                "x": round(tight_x, 4),
                "y": round(tight_y, 4),
                "width": round(tight_w, 4),
                "height": round(tight_h, 4),
                "num_lines": num_lines,
            }
            best_num_lines = num_lines
            best_pts = t

            if req.pts is not None and abs(t - req.pts) <= 1.5:
                break

        cap.release()

        is_portrait = False
        try:
            cap_probe = cv2.VideoCapture(str(video_path))
            probe_w = cap_probe.get(cv2.CAP_PROP_FRAME_WIDTH) or 1
            probe_h = cap_probe.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1
            is_portrait = probe_h > probe_w
            cap_probe.release()
        except Exception:
            pass

        if not best_band:
            default_y = 0.61 if is_portrait else 0.82
            best_band = {
                "x": 0.03,
                "y": default_y,
                "width": 0.94,
                "height": 0.08,
                "num_lines": 1,
            }

        base_region = manifest.regions[0] if manifest.regions else RegionTrackV1(region_id="roi-default")
        updated_region = RegionTrackV1(
            region_id=base_region.region_id,
            x=best_band["x"],
            y=best_band["y"],
            width=best_band["width"],
            height=best_band["height"],
        )
        manifest.regions = [updated_region]
        repository.save_project(manifest)

        line_desc = f"{best_band['num_lines']} dòng" if best_band.get('num_lines', 0) > 1 else "1 dòng"

        return {
            "status": "success",
            "region": updated_region.to_dict(),
            "detected_count": 1,
            "num_lines": best_band.get("num_lines", 1),
            "line_description": line_desc,
            "pts": round(best_pts, 2),
        }

    @app.post("/api/v1/settings/gemini-key")
    async def set_gemini_key(
        req: GeminiKeyRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Cấu hình Gemini API Key cho dịch thuật phụ đề AI chuẩn điện ảnh."""
        verify_auth(authorization)
        key = req.api_key.strip()
        os.environ["GEMINI_API_KEY"] = key
        env_file = Path("subtitle_localizer.env")
        env_file.write_text(f"GEMINI_API_KEY={key}\n", encoding="utf-8")
        return {"status": "success", "configured": bool(key)}

    @app.get("/api/v1/settings/gemini-key")
    async def get_gemini_status(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        """Kiểm tra trạng thái cấu hình Gemini AI."""
        verify_auth(authorization)
        key = os.environ.get("GEMINI_API_KEY", "").strip()
        masked = f"{key[:6]}...{key[-4:]}" if len(key) > 10 else ("Configured" if key else "")
        return {"configured": bool(key), "masked_key": masked}

    @app.get("/api/v1/settings/gemini-pool")
    async def get_gemini_pool_status(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        """Lấy thông tin trạng thái xoay tua của Gemini Key Pool (số lượng, active, cooldown)."""
        verify_auth(authorization)
        from subtitle_localizer.translation.key_pool import get_global_gemini_pool
        pool = get_global_gemini_pool()
        return pool.get_status()

    @app.post("/api/v1/settings/gemini-pool")
    async def update_gemini_pool(
        req: GeminiPoolRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Cập nhật và lưu danh sách API Keys vào Pool xoay tua."""
        verify_auth(authorization)
        from subtitle_localizer.translation.key_pool import get_global_gemini_pool
        pool = get_global_gemini_pool()
        pool.load_keys(req.keys)
        pool.save_to_file("gemini_keys_pool.json")
        return {"status": "success", "pool_status": pool.get_status()}

    @app.post("/api/v1/settings/gemini-pool/verify")
    async def verify_gemini_pool(
        req: Optional[GeminiVerifyRequest] = None,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Kiểm tra thực tế trạng thái hoạt động của toàn bộ keys hoặc 1 key chỉ định."""
        verify_auth(authorization)
        from subtitle_localizer.translation.key_pool import get_global_gemini_pool
        pool = get_global_gemini_pool()
        if req and req.index is not None:
            res = pool.verify_key_by_index(req.index)
            return {"status": "success", "result": res, "pool_status": pool.get_status()}
        pool.verify_all_keys()
        return {"status": "success", "pool_status": pool.get_status()}

    @app.delete("/api/v1/settings/gemini-pool/key/{index}")
    async def delete_gemini_key(
        index: int,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Xóa một key khỏi Pool theo số thứ tự (1-based index)."""
        verify_auth(authorization)
        from subtitle_localizer.translation.key_pool import get_global_gemini_pool
        pool = get_global_gemini_pool()
        ok = pool.remove_key_by_index(index)
        if not ok:
            raise HTTPException(status_code=404, detail="Key index not found")
        pool.save_to_file("gemini_keys_pool.json")
        return {"status": "success", "pool_status": pool.get_status()}

    @app.get("/api/v1/settings/pipeline")
    async def get_pipeline_settings_endpoint(
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Lấy toàn bộ cấu hình Pipeline toàn cục hiện tại."""
        verify_auth(authorization)
        return get_global_pipeline_settings().dict()

    @app.post("/api/v1/settings/pipeline")
    async def update_pipeline_settings_endpoint(
        settings: GlobalPipelineSettings,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Lưu cập nhật cấu hình Pipeline toàn cục vào file JSON và áp dụng cho hệ thống."""
        verify_auth(authorization)
        save_pipeline_settings(settings)
        return {"status": "success", "settings": settings.dict()}

    @app.get("/api/v1/settings/hardware-check")
    async def get_hardware_capabilities_endpoint(
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Kiểm tra tài nguyên phần cứng: CPU, GPU NVIDIA NVENC, ONNX Runtime Providers & FFmpeg."""
        verify_auth(authorization)
        return check_hardware_capabilities()

    @app.get("/api/v1/settings/capcut-drafts")
    async def list_capcut_drafts_endpoint(
        limit: int = 30,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Liệt kê danh sách các dự án CapCut Desktop Draft gần nhất trên máy tính."""
        verify_auth(authorization)
        from subtitle_localizer.cloud.capcut_bridge import CapCutBridgeExtractor
        extractor = CapCutBridgeExtractor()
        base_dir = extractor._get_capcut_draft_base_dir()
        installed = base_dir.exists()
        drafts = extractor.list_recent_drafts(limit=limit) if installed else []
        return {
            "installed": installed,
            "draft_dir": str(base_dir).replace("\\", "/"),
            "drafts": drafts,
        }

    @app.post("/api/v1/settings/capcut-check")
    async def test_capcut_endpoint(
        body: Optional[Dict[str, Any]] = None,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Kiểm tra kết nối và độ trễ tới máy chủ CapCut Cloud API."""
        verify_auth(authorization)
        from subtitle_localizer.service.capcut_api import CapCutSubtitleClient, DEFAULT_CAPCUT_ENDPOINT
        raw_ep = (body or {}).get("endpoint")
        if not raw_ep or "edit-api-sg.capcut.com" in raw_ep:
            endpoint = DEFAULT_CAPCUT_ENDPOINT
        else:
            endpoint = raw_ep
        client = CapCutSubtitleClient(endpoint=endpoint)
        return client.test_connection()

    @app.post("/api/v1/settings/local-llm-check")
    async def test_local_llm_endpoint(
        req: Optional[LocalLlmCheckRequest] = None,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Kiểm tra kết nối tới Ollama / llama.cpp / Local LLM Server và lấy danh sách models."""
        verify_auth(authorization)
        import time
        import urllib.request
        import json

        endpoint = (req.endpoint if req and req.endpoint else "http://localhost:11434").rstrip("/")
        model = (req.model if req and req.model else "qwen2.5:7b-instruct")

        t0 = time.time()
        available_models = []
        is_online = False
        error_msg = ""

        # 1. Thử Ollama native /api/tags
        try:
            url_tags = f"{endpoint}/api/tags"
            req_tags = urllib.request.Request(url_tags, headers={"User-Agent": "SubtitleLocalizerStudio"})
            with urllib.request.urlopen(req_tags, timeout=3) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    available_models = [m.get("name") for m in data.get("models", []) if m.get("name")]
                    is_online = True
        except Exception as ex_ollama:
            # 2. Thử chuẩn OpenAI /v1/models (llama.cpp / LM Studio / LocalAI)
            try:
                models_url = f"{endpoint}/models" if endpoint.endswith("/v1") else f"{endpoint}/v1/models"
                req_openai = urllib.request.Request(models_url, headers={"User-Agent": "SubtitleLocalizerStudio"})
                with urllib.request.urlopen(req_openai, timeout=3) as resp_o:
                    if resp_o.status == 200:
                        data = json.loads(resp_o.read().decode("utf-8"))
                        available_models = [m.get("id") for m in data.get("data", []) if m.get("id")]
                        is_online = True
            except Exception as ex_openai:
                error_msg = f"Không thể kết nối máy chủ Local LLM tại {endpoint} ({ex_ollama})"

        latency_ms = round((time.time() - t0) * 1000, 1)
        has_target_model = any(model.lower() in m.lower() for m in available_models) if available_models else False

        if is_online:
            msg = f"Kết nối Local LLM thành công! Đã phát hiện {len(available_models)} models."
            if not has_target_model and available_models:
                msg += f" (Lưu ý: Mô hình '{model}' chưa có trong máy, bạn có thể chạy 'ollama run {model}')"
            return {
                "ok": True,
                "latency_ms": latency_ms,
                "message": msg,
                "models": available_models,
                "has_target_model": has_target_model,
            }
        else:
            return {
                "ok": False,
                "latency_ms": latency_ms,
                "message": error_msg or f"Chưa khởi động Local Engine tại {endpoint}. Hãy mở Ollama hoặc LM Studio.",
                "models": [],
                "has_target_model": False,
            }

    @app.post("/api/v1/settings/local-llm-start")
    async def start_local_llm_daemon(
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Tự động khởi động tiến trình Ollama nền trên máy tính."""
        verify_auth(authorization)
        import subprocess
        import shutil
        import sys
        import urllib.request
        import time

        try:
            with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=1.0) as resp:
                if getattr(resp, "status", getattr(resp, "code", 200)) == 200:
                    return {"ok": True, "message": "Máy chủ Ollama đã đang chạy sẵn trên cổng 11434."}
        except Exception:
            pass

        ollama_bin = shutil.which("ollama")
        if not ollama_bin:
            default_path = Path(os.path.expanduser("~")) / "AppData" / "Local" / "Programs" / "Ollama" / "ollama.exe"
            if default_path.exists():
                ollama_bin = str(default_path)

        if not ollama_bin:
            return {"ok": False, "message": "Không tìm thấy ollama.exe trên máy. Hãy cài đặt Ollama từ https://ollama.com"}

        try:
            creation_flags = 0
            if sys.platform == "win32":
                creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)

            subprocess.Popen(
                [ollama_bin, "serve"],
                creationflags=creation_flags,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            for _ in range(6):
                time.sleep(0.5)
                try:
                    with urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=1.0) as resp:
                        if getattr(resp, "status", getattr(resp, "code", 200)) == 200:
                            return {"ok": True, "message": "Đã khởi động máy chủ Ollama ngầm thành công!"}
                except Exception:
                    continue

            return {"ok": True, "message": "Đã gửi lệnh chạy Ollama serve, tiến trình đang khởi tạo."}
        except Exception as ex:
            return {"ok": False, "message": f"Không thể khởi động Ollama: {ex}"}

    @app.post("/api/v1/settings/test-translation")
    async def test_translation_endpoint(
        req: TestTranslationRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Thử nghiệm dịch tức thì 1 câu văn mẫu để kiểm tra chất lượng dịch thuật."""
        verify_auth(authorization)
        import time
        from subtitle_localizer.translation.real import _refine_subtitles
        t0 = time.time()

        text = req.text.strip()
        if not text:
            return {"original": "", "translated": "", "provider_used": "none", "latency_ms": 0}

        translated = ""
        # The production endpoint is deliberately local-only.  Ignore legacy
        # provider values sent by older clients rather than silently routing
        # text to Gemini/Google.
        provider_used = "local"

        tone_desc = {
            "dramatic": "kịch tính, hấp dẫn, chuẩn phim truyền hình",
            "daily": "đời thường, gần gũi, tự nhiên",
            "humorous": "hài hước, dí dỏm, tiếng lóng giới trẻ",
            "literal": "sát nghĩa từ ngữ gốc",
        }.get(req.prompt_tone, "tự nhiên chuẩn phim")

        def _try_gemini() -> str:
            from subtitle_localizer.translation.key_pool import get_global_gemini_pool
            pool = get_global_gemini_pool()
            if pool.total_keys > 0:
                import json
                import urllib.request
                key = pool.get_next_key(wait_timeout=2.0)
                if key:
                    prompt = (
                        f"Bạn là chuyên gia dịch thuật phim truyền hình. Dịch câu sau từ {req.source_lang} sang {req.target_lang}.\n"
                        f"Phong cách: {tone_desc}.\n"
                        f"Chỉ trả về duy nhất câu đã dịch, không kèm ngoặc kép, lời chào hay giải thích.\n"
                        f"Văn bản: {text}"
                    )
                    payload = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode("utf-8")
                    target_model = req.gemini_model or "gemini-2.5-flash"
                    if target_model in {"gemini-3.8-flash", "3.8", "gemini-3.8"}:
                        target_model = "gemini-2.5-flash"
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_model}:generateContent?key={key}"
                    req_obj = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
                    try:
                        with urllib.request.urlopen(req_obj, timeout=15) as resp:
                            if resp.status == 200:
                                res_json = json.loads(resp.read().decode("utf-8"))
                                return res_json["candidates"][0]["content"]["parts"][0]["text"].strip()
                    except Exception as e:
                        logger.warning(f"Test Gemini translation failed: {e}")
            return ""

        def _try_local() -> str:
            import json
            import urllib.request
            endpoint = (req.local_endpoint or "http://localhost:11434").rstrip("/")
            model = req.local_model or "qwen2.5:7b-instruct"
            prompt = (
                f"Bạn là chuyên gia dịch thuật phim truyền hình. Dịch câu sau từ {req.source_lang} sang {req.target_lang}.\n"
                f"Phong cách: {tone_desc}.\n"
                f"Chỉ trả về duy nhất câu đã dịch, không kèm ngoặc kép, lời chào hay giải thích.\n"
                f"Văn bản: {text}"
            )
            chat_url = f"{endpoint}/chat/completions" if endpoint.endswith("/v1") else f"{endpoint}/v1/chat/completions"
            payload_openai = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "stream": False,
            }
            try:
                req_data = json.dumps(payload_openai).encode("utf-8")
                req_obj = urllib.request.Request(chat_url, data=req_data, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req_obj, timeout=25) as resp:
                    if getattr(resp, "status", getattr(resp, "code", 200)) == 200:
                        res_json = json.loads(resp.read().decode("utf-8"))
                        res_txt = res_json.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                        if res_txt:
                            return res_txt
            except Exception as e_local:
                try:
                    native_url = f"{endpoint.replace('/v1', '')}/api/chat"
                    req_native = urllib.request.Request(
                        native_url,
                        data=json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}], "stream": False}).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                    )
                    with urllib.request.urlopen(req_native, timeout=25) as resp_n:
                        if getattr(resp_n, "status", getattr(resp_n, "code", 200)) == 200:
                            res_json_n = json.loads(resp_n.read().decode("utf-8"))
                            res_txt_n = res_json_n.get("message", {}).get("content", "").strip()
                            if res_txt_n:
                                return res_txt_n
                except Exception as e_native:
                    logger.warning(f"Test Local Qwen translation failed: {e_local} | {e_native}")
            return ""

        auto_fb = False  # production policy: local model only

        translated = _try_local()

        # Never fall back to Google Translate (or any other network provider).
        # An unavailable local model is reported explicitly so operators can
        # start Ollama/install the requested model instead of getting a silent
        # change in translation quality or data residency.
        if not translated:
            endpoint = (req.local_endpoint or "http://localhost:11434").rstrip("/")
            model = req.local_model or "qwen2.5:7b-instruct"
            translated = f"[Local LLM unavailable at {endpoint}; start Ollama and install {model}]"
            provider_used = "local_unavailable"

        if req.use_glossary and not translated.startswith("["):
            translated = _refine_subtitles(translated, text)

        elapsed_ms = round((time.time() - t0) * 1000, 1)
        return {
            "original": text,
            "translated": translated,
            "provider_used": provider_used,
            "latency_ms": elapsed_ms,
        }


    @app.get("/api/v1/settings/tts-catalog")
    async def get_tts_catalog_endpoint(
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Liệt kê toàn bộ kho giọng đọc đa tầng (Edge-TTS, CapCut, Gemini)."""
        verify_auth(authorization)
        from subtitle_localizer.dubbing.tts import get_tts_catalog
        return get_tts_catalog()

    @app.post("/api/v1/settings/test-tts")
    async def test_tts_endpoint(
        req: TestDubbingRequest,
        authorization: Optional[str] = Header(None),
    ):
        """Thử nghiệm tạo giọng đọc mẫu cho 1 câu thoại ngắn và stream audio về UI."""
        verify_auth(authorization)
        from subtitle_localizer.dubbing.tts import synthesize_text, resolve_tts_provider
        text = req.text.strip() or "Xin chào, đây là giọng đọc thử nghiệm của Subtitle Localizer Studio."
        provider = resolve_tts_provider(req.voice, preferred_provider=req.provider)
        prompt_style = req.prompt_style or "dramatic"
        audio_bytes = await synthesize_text(
            text=text,
            voice=req.voice,
            rate=req.rate,
            provider=provider,
            prompt_style=prompt_style,
        )
        if not audio_bytes:
            raise HTTPException(status_code=500, detail="Không thể tạo giọng đọc thử nghiệm")
        return Response(content=audio_bytes, media_type="audio/mpeg")

    @app.post("/api/v1/projects/{project_id}/commands")
    async def execute_command(
        project_id: str,
        cmd: CommandRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        # Optimistic locking check
        if manifest.active_revision != cmd.expected_revision:
            raise HTTPException(
                status_code=409,
                detail=f"Revision conflict: current {manifest.active_revision}, expected {cmd.expected_revision}",
            )

        # Xử lý các command types
        if cmd.command_type == "update_title":
            manifest.title = cmd.payload.get("title", manifest.title)
            success = repository.update_project_revision(manifest, expected_revision=cmd.expected_revision)
            if not success:
                raise HTTPException(status_code=409, detail="Failed to update revision")
        return {"command_id": cmd.command_id or "auto", "new_revision": manifest.active_revision}

    @app.get("/api/v1/projects/{project_id}/export/srt")
    async def export_srt(project_id: str, use_translated: bool = True, authorization: Optional[str] = Header(None)):
        verify_auth(authorization)
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        cues = repository.get_cues(project_id)
        from subtitle_localizer.render.srt import SrtExporter
        exporter = SrtExporter()
        srt_content = exporter.export_srt_text(cues, use_translated=use_translated)
        from fastapi.responses import Response
        import urllib.parse
        clean_title = (project.title or "subtitles").strip()
        filename = f"{clean_title}.srt"
        encoded_filename = urllib.parse.quote(filename)
        return Response(
            content=srt_content.encode("utf-8"),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=\"subtitles.srt\"; filename*=UTF-8''{encoded_filename}"},
        )

    @app.get("/api/v1/projects/{project_id}/export/ass")
    async def export_ass(project_id: str, use_translated: bool = True, authorization: Optional[str] = Header(None)):
        verify_auth(authorization)
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        cues = repository.get_cues(project_id)
        from subtitle_localizer.render.ass import AssExporter
        exporter = AssExporter()
        ass_content = exporter.export_ass_text(cues, script_title=project.title, use_translated=use_translated)
        from fastapi.responses import Response
        import urllib.parse
        clean_title = (project.title or "subtitles").strip()
        filename = f"{clean_title}.ass"
        encoded_filename = urllib.parse.quote(filename)
        return Response(
            content=ass_content.encode("utf-8"),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=\"subtitles.ass\"; filename*=UTF-8''{encoded_filename}"},
        )

    @app.post("/api/v1/projects/{project_id}/export/mp4")
    def export_mp4(
        project_id: str,
        request: Mp4ExportRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, str]:
        verify_auth(authorization)
        rendered_path = _do_export_mp4(
            project_id=project_id,
            mask_mode=request.mask_mode,
            use_translated=request.use_translated,
            flip_h=request.flip_h,
            flip_v=request.flip_v,
            video_x=request.video_x,
            video_y=request.video_y,
            video_scale=request.video_scale,
            rotation=request.rotation,
            regions_override=request.regions,
            subtitle_placement=request.subtitle_placement,
            blur_strength=request.blur_strength,
        )
        return {"status": "completed", "output_path": rendered_path}

    @app.get("/api/v1/projects/{project_id}/video/rendered")
    def stream_rendered_video(project_id: str, download: bool = False):
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        from pathlib import Path
        source_path = Path(project.source_video_path)
        project_output = resolved_output_root / project_id
        rendered_path = project_output / f"{source_path.stem}-localized.mp4"
        if not rendered_path.exists():
            raise HTTPException(status_code=404, detail="Rendered video not found. Please render first.")
        from fastapi.responses import FileResponse
        if download:
            return FileResponse(path=str(rendered_path), media_type="video/mp4", filename=f"{source_path.stem}-localized.mp4")
        return FileResponse(path=str(rendered_path), media_type="video/mp4")

    @app.get("/api/v1/projects/{project_id}/audio/voiceover")
    def stream_voiceover_audio(project_id: str, download: bool = False):
        """Phát trực tuyến hoặc tải về file âm thanh lồng tiếng AI (MP3)."""
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        from pathlib import Path
        voiceover_path = (resolved_output_root / project_id / f"voiceover_{project_id}.mp3").resolve()
        if not voiceover_path.exists():
            raise HTTPException(status_code=404, detail="Voiceover audio file not found on disk")
        from fastapi.responses import FileResponse
        source_path = Path(project.source_video_path)
        if download:
            return FileResponse(path=str(voiceover_path), media_type="audio/mpeg", filename=f"{source_path.stem}-voiceover.mp3")
        return FileResponse(path=str(voiceover_path), media_type="audio/mpeg")

    @app.post("/api/v1/projects/{project_id}/reveal-export")
    async def reveal_project_export(project_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        """Mở thư mục chứa file MP4/MP3 đã xuất trên Windows Explorer hoặc hệ điều hành sở tại."""
        verify_auth(authorization)
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        from pathlib import Path
        source_path = Path(project.source_video_path)
        project_output = (resolved_output_root / project_id).resolve()
        # Ensure Explorer never receives a path that is absent (for example
        # after a previous temporary output directory was cleaned up).
        project_output.mkdir(parents=True, exist_ok=True)
        export_path = (resolved_output_root / project_id / f"{source_path.stem}-localized.mp4").resolve()
        voiceover_path = (resolved_output_root / project_id / f"voiceover_{project_id}.mp3").resolve()
        
        target_to_select = export_path if export_path.exists() else (voiceover_path if voiceover_path.exists() else None)
        target_to_open = target_to_select if target_to_select else project_output
            
        import sys
        import subprocess
        try:
            if sys.platform == "win32":
                if target_to_select and target_to_select.exists():
                    subprocess.Popen(["explorer.exe", f"/select,{target_to_select}"])
                else:
                    subprocess.Popen(["explorer.exe", str(project_output)])
            elif sys.platform == "darwin":
                subprocess.Popen(["open", "-R", str(target_to_open)] if target_to_select else ["open", str(project_output)])
            else:
                subprocess.Popen(["xdg-open", str(project_output)])
            return {"success": True, "path": str(target_to_open)}
        except Exception as e:
            logger.warning(f"Failed to reveal export path: {e}")
            return {"success": False, "error": str(e), "path": str(target_to_open)}

    @app.get("/api/v1/projects/{project_id}/video/stream")
    def stream_project_video(project_id: str, quality: str = "original"):
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        from pathlib import Path
        video_path = Path(project.source_video_path)
        if quality in {"360p", "480p", "720p", "1080p"}:
            cached_proxy = (resolved_output_root / project_id / "proxies" / f"proxy_{quality}.mp4").resolve()
            if cached_proxy.exists() and cached_proxy.is_file():
                video_path = cached_proxy
        if not video_path.exists():
            # Trả về 404 nếu video không tồn tại
            raise HTTPException(status_code=404, detail="Video file not found on disk")
        from fastapi.responses import FileResponse
        return FileResponse(path=str(video_path), media_type="video/mp4")

    @app.post("/api/v1/projects/upload")
    async def upload_video_file(file: UploadFile = File(...), authorization: Optional[str] = Header(None)) -> Dict[str, str]:
        verify_auth(authorization)
        from pathlib import Path
        upload_dir = Path("uploads").resolve()
        upload_dir.mkdir(parents=True, exist_ok=True)
        safe_name = file.filename or "uploaded_video.mp4"
        target_path = upload_dir / safe_name

        def _write_file():
            with target_path.open("wb") as buffer:
                while chunk := file.file.read(16 * 1024 * 1024):
                    buffer.write(chunk)

        await asyncio.to_thread(_write_file)
        return {"path": str(target_path).replace("\\", "/"), "filename": safe_name}

    @app.post("/api/v1/system/pick-video")
    async def pick_video(authorization: Optional[str] = Header(None)) -> Dict[str, str]:
        verify_auth(authorization)
        try:
            import subprocess
            import sys
            from pathlib import Path
            script_path = Path(__file__).resolve().parents[3] / "scripts" / "pick_file.py"

            def _run_pick():
                return subprocess.run(
                    [sys.executable, str(script_path)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                )

            res = await asyncio.to_thread(_run_pick)
            selected = res.stdout.strip()
            if selected:
                p = Path(selected)
                return {"path": str(p).replace("\\", "/"), "filename": p.name}
            return {"path": "", "filename": ""}
        except Exception as e:
            return {"path": "", "filename": "", "error": str(e)}

    @app.post("/api/v1/system/pick-multiple-videos")
    async def pick_multiple_videos(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            import subprocess
            import sys
            import json
            from pathlib import Path
            script_path = Path(__file__).resolve().parents[3] / "scripts" / "pick_file.py"

            def _run_pick():
                return subprocess.run(
                    [sys.executable, str(script_path), "--multiple"],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                )

            res = await asyncio.to_thread(_run_pick)
            stdout = res.stdout.strip()
            if stdout:
                paths = json.loads(stdout)
                files = [{"path": p, "filename": Path(p).name} for p in paths if p]
                return {"files": files}
            return {"files": []}
        except Exception as e:
            return {"files": [], "error": str(e)}

    @app.post("/api/v1/system/pick-folder")
    async def pick_folder(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        try:
            import subprocess
            import sys
            import json
            from pathlib import Path
            script_path = Path(__file__).resolve().parents[3] / "scripts" / "pick_file.py"

            def _run_pick():
                return subprocess.run(
                    [sys.executable, str(script_path), "--folder"],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                )

            res = await asyncio.to_thread(_run_pick)
            stdout = res.stdout.strip()
            if stdout:
                paths = json.loads(stdout)
                files = [{"path": p, "filename": Path(p).name} for p in paths if p]
                return {"files": files}
            return {"files": []}
        except Exception as e:
            return {"files": [], "error": str(e)}

    @app.get("/api/v1/models")
    async def list_models(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        return {
            "ocr": ["rapidocr"],
            "translation": ["gemini", "gemma", "nllb", "opus", "real"],
        }

    @app.websocket("/api/v1/ws")
    async def websocket_endpoint(websocket: WebSocket, after_sequence: int = 0) -> None:
        await ws_manager.connect(websocket)
        if after_sequence > 0:
            await ws_manager.replay_events_after(websocket, after_sequence)
        try:
            while True:
                data = await websocket.receive_json()
                # Phản hồi pong hoặc xử lý client commands
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
        except WebSocketDisconnect:
            ws_manager.disconnect(websocket)

    # Phục vụ Web UI static nếu web/dist đã được build
    possible_dist_dirs = [
        Path(__file__).resolve().parents[3] / "web" / "dist",
        Path.cwd() / "web" / "dist",
    ]
    for d in possible_dist_dirs:
        if d.exists() and (d / "index.html").exists():
            from fastapi.staticfiles import StaticFiles
            app.mount("/", StaticFiles(directory=str(d), html=True), name="static_web")
            break

    return app
