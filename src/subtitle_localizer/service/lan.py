"""Coordinator/worker primitives for the LAN control plane.

The registry is deliberately small and process-local for the first vertical
slice. Jobs carry idempotency keys so a durable repository can be introduced
without changing the HTTP contract.
"""
from __future__ import annotations

import time
import json
import socket
import threading
import uuid
from dataclasses import asdict, dataclass, field, fields
from typing import Any, Dict, Optional

from subtitle_localizer.service.lan_protocol import PROTOCOL_VERSION

DISCOVERY_MAGIC = "subtitle-localizer-coordinator"
DISCOVERY_VERSION = 1
DISCOVERY_PORT = 45871
LAN_PROTOCOL_VERSION = 2
TERMINAL_JOB_STATUSES = {"completed", "failed", "cancelled"}
VALID_JOB_STATUSES = {"queued", "running", *TERMINAL_JOB_STATUSES}
GPU_PREFERRED_STAGES = {"ocr", "export", "dub"}
CPU_PREFERRED_STAGES = {"download", "translate"}
LARGE_VIDEO_BYTES = 1024 * 1024 * 1024
LARGE_VIDEO_MIN_VRAM_MB = 3000
STANDARD_VIDEO_MIN_VRAM_MB = 1500
STANDARD_VIDEO_MIN_DISK_BYTES = 10 * 1024 * 1024 * 1024


class LanStateError(ValueError):
    """The requested mutation conflicts with current coordinator state."""


class LanLeaseError(LanStateError):
    """A worker attempted to mutate a job using a stale lease."""


class LanDiscoveryResponder:
    """Responds to UDP discovery requests without exposing registration tokens."""
    def __init__(self, http_url: str, *, port: int = DISCOVERY_PORT,
                 fingerprint: str = "", bind: str = "0.0.0.0") -> None:
        self.http_url = http_url.rstrip("/")
        self.port = int(port)
        self.fingerprint = fingerprint
        self.bind = bind
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def handle_datagram(self, data: bytes, address: tuple[str, int], sock: Any) -> bool:
        try:
            payload = json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return False
        if payload.get("magic") != DISCOVERY_MAGIC or payload.get("version") != DISCOVERY_VERSION or payload.get("type") != "discover":
            return False
        response = {"magic": DISCOVERY_MAGIC, "version": DISCOVERY_VERSION,
                    "type": "coordinator", "url": self.http_url,
                    "fingerprint": self.fingerprint}
        sock.sendto(json.dumps(response).encode("utf-8"), address)
        return True

    def serve_forever(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self.bind, self.port))
        sock.settimeout(0.5)
        try:
            while not self._stop.is_set():
                try:
                    data, address = sock.recvfrom(4096)
                    self.handle_datagram(data, address, sock)
                except socket.timeout:
                    continue
        finally:
            sock.close()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self.serve_forever, name="lan-discovery", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)


@dataclass
class WorkerRecord:
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
    capabilities: Dict[str, bool] = field(default_factory=dict)
    status: str = "online"
    last_seen: float = field(default_factory=time.time)
    active_job_id: Optional[str] = None
    queue_depth: int = 0
    last_error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        result["is_online"] = (time.time() - self.last_seen) <= 30.0
        return result


@dataclass
class LanJob:
    job_id: str
    project_id: str
    worker_id: str
    job_type: str = "ocr"
    status: str = "queued"
    idempotency_key: str = ""
    profile: str = "full_speed_quality"
    video_fingerprint: str = ""
    progress: float = 0.0
    metrics: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    attempt: int = 0
    max_attempts: int = 3
    lease_id: Optional[str] = None
    lease_expires_at: Optional[float] = None
    heartbeat_at: Optional[float] = None
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    current_stage: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    artifacts: list[Dict[str, Any]] = field(default_factory=list)
    protocol_version: Optional[str] = None
    stage_plan: list[str] = field(default_factory=list)
    package: Optional[Dict[str, Any]] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DownloadApproval:
    request_id: str
    worker_id: str
    source: str
    title: str = ""
    thumbnail_url: str = ""
    duration_seconds: Optional[float] = None
    size_bytes: Optional[int] = None
    status: str = "preview_ready"
    created_at: float = field(default_factory=time.time)
    decided_at: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class LanCoordinator:
    def __init__(self, database: Any = None, *, lease_seconds: float = 30.0) -> None:
        self._database = database
        self.lease_seconds = max(1.0, float(lease_seconds))
        self._workers: Dict[str, WorkerRecord] = {}
        self._jobs: Dict[str, LanJob] = {}
        self._idempotency: Dict[str, str] = {}
        self._downloads: Dict[str, DownloadApproval] = {}
        self._lock = threading.RLock()
        self._load_persisted()

    @staticmethod
    def _load_record(record_type: Any, data: Dict[str, Any]) -> Any:
        allowed = {item.name for item in fields(record_type)}
        return record_type(**{key: value for key, value in data.items() if key in allowed})

    def _conn(self):
        return self._database.get_connection() if self._database is not None else None

    def _load_persisted(self) -> None:
        conn = self._conn()
        if conn is None:
            return
        try:
            for row in conn.execute("SELECT worker_json FROM lan_workers"):
                data = json.loads(row[0]); self._workers[data["worker_id"]] = self._load_record(WorkerRecord, data)
            for row in conn.execute("SELECT job_json FROM lan_jobs"):
                data = json.loads(row[0]); job = self._load_record(LanJob, data); self._jobs[job.job_id] = job; self._idempotency[job.idempotency_key] = job.job_id
            for row in conn.execute("SELECT download_json FROM lan_downloads"):
                data = json.loads(row[0]); item = self._load_record(DownloadApproval, data); self._downloads[item.request_id] = item
        except Exception:
            # A pre-v3 database is migrated before the coordinator is created.
            return

    def _persist_worker(self, worker: WorkerRecord) -> None:
        conn = self._conn()
        if conn is not None:
            conn.execute("INSERT OR REPLACE INTO lan_workers(worker_id, worker_json, updated_at) VALUES (?, ?, ?)", (worker.worker_id, json.dumps(asdict(worker), ensure_ascii=False), time.time()))

    def _persist_job(self, job: LanJob) -> None:
        conn = self._conn()
        if conn is not None:
            conn.execute(
                """INSERT OR REPLACE INTO lan_jobs(
                    job_id, idempotency_key, job_json, updated_at, attempt, max_attempts,
                    lease_id, lease_expires_at, heartbeat_at, started_at, finished_at,
                    current_stage, result_json, artifacts_json, protocol_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (job.job_id, job.idempotency_key, json.dumps(asdict(job), ensure_ascii=False),
                 time.time(), job.attempt, job.max_attempts, job.lease_id,
                 job.lease_expires_at, job.heartbeat_at, job.started_at, job.finished_at,
                 job.current_stage, json.dumps(job.result, ensure_ascii=False) if job.result is not None else None,
                 json.dumps(job.artifacts, ensure_ascii=False), job.protocol_version),
            )

    def _persist_download(self, item: DownloadApproval) -> None:
        conn = self._conn()
        if conn is not None:
            conn.execute("INSERT OR REPLACE INTO lan_downloads(request_id, download_json, updated_at) VALUES (?, ?, ?)", (item.request_id, json.dumps(asdict(item), ensure_ascii=False), time.time()))

    def _delete_worker(self, worker_id: str) -> None:
        conn = self._conn()
        if conn is not None:
            conn.execute("DELETE FROM lan_workers WHERE worker_id = ?", (worker_id,))

    def _delete_job(self, job_id: str) -> None:
        conn = self._conn()
        if conn is not None:
            conn.execute("DELETE FROM lan_jobs WHERE job_id = ?", (job_id,))

    @staticmethod
    def _worker_supports(worker: WorkerRecord, job_type: str) -> bool:
        capabilities = worker.capabilities
        if not capabilities:
            return True
        if job_type in capabilities:
            return bool(capabilities[job_type])
        # Older workers reported hardware/features rather than explicit job types.
        legacy_keys = {"cuda", "downloader"}
        if job_type in {"ocr", "translate", "translation", "download"} and set(capabilities).issubset(legacy_keys):
            return True
        return False

    @staticmethod
    def _job_stages(job: LanJob) -> set[str]:
        return set(job.stage_plan or [job.job_type])

    @staticmethod
    def _job_video_bytes(job: LanJob) -> int:
        value = job.metrics.get("video_size_bytes", 0)
        if value:
            return max(0, int(value))
        for artifact in (job.package or {}).get("artifacts", []):
            if artifact.get("kind") == "source":
                return max(0, int(artifact.get("size_bytes") or 0))
        return 0

    def _worker_has_resources(self, worker: WorkerRecord, job: LanJob) -> bool:
        if worker.slots_available is not None and worker.slots_available <= 0:
            return False
        video_bytes = self._job_video_bytes(job)
        required_disk = video_bytes * 3 if video_bytes >= LARGE_VIDEO_BYTES else STANDARD_VIDEO_MIN_DISK_BYTES
        if worker.disk_free_bytes is not None and worker.disk_free_bytes > 0 and worker.disk_free_bytes < required_disk:
            return False
        gpu_stages = self._job_stages(job) & GPU_PREFERRED_STAGES
        if not gpu_stages or not self._worker_has_cuda(worker):
            return True
        required_vram = LARGE_VIDEO_MIN_VRAM_MB if video_bytes >= LARGE_VIDEO_BYTES else STANDARD_VIDEO_MIN_VRAM_MB
        reported_vram = worker.vram_free_mb if worker.vram_free_mb is not None else worker.vram_mb
        return reported_vram <= 0 or reported_vram >= required_vram

    @staticmethod
    def _worker_has_cuda(worker: WorkerRecord) -> bool:
        return bool(worker.capabilities.get("cuda"))

    def _eligible_workers(self, job_type: str, job: Optional[LanJob] = None) -> list[WorkerRecord]:
        now = time.time()
        return [
            worker for worker in self._workers.values()
            if worker.status == "online" and (now - worker.last_seen) <= 30.0
            and self._worker_supports(worker, job_type)
            and (job is None or self._worker_has_resources(worker, job))
        ]

    def _select_worker(self, candidates: list[WorkerRecord], job: LanJob) -> Optional[WorkerRecord]:
        if not candidates:
            return None
        stages = self._job_stages(job)
        if stages & GPU_PREFERRED_STAGES:
            cuda_workers = [worker for worker in candidates if self._worker_has_cuda(worker)]
            if cuda_workers:
                candidates = cuda_workers
        elif stages & CPU_PREFERRED_STAGES:
            cpu_workers = [worker for worker in candidates if not self._worker_has_cuda(worker)]
            if cpu_workers:
                candidates = cpu_workers
        return min(candidates, key=lambda worker: worker.queue_depth)

    def _assign_capable_worker(self, job: LanJob) -> None:
        current = self._workers.get(job.worker_id)
        if (current and current.status == "online" and (time.time() - current.last_seen) <= 30.0
                and self._worker_supports(current, job.job_type)
                and self._worker_has_resources(current, job)):
            return
        selected = self._select_worker(self._eligible_workers(job.job_type, job), job)
        if selected:
            job.worker_id = selected.worker_id

    def _clear_worker_job(self, job: LanJob) -> None:
        worker = self._workers.get(job.worker_id)
        if worker and worker.active_job_id == job.job_id:
            worker.active_job_id = None
            self._persist_worker(worker)

    def _expire_running_jobs(self, now: Optional[float] = None) -> list[LanJob]:
        now = time.time() if now is None else now
        changed: list[LanJob] = []
        for job in self._jobs.values():
            if job.status != "running" or job.lease_expires_at is None or job.lease_expires_at > now:
                continue
            self._clear_worker_job(job)
            job.lease_id = None
            job.lease_expires_at = None
            job.heartbeat_at = None
            job.updated_at = now
            if job.attempt < job.max_attempts:
                job.status = "queued"
                job.error = "Worker lease expired; job requeued"
                job.current_stage = None
                self._assign_capable_worker(job)
                worker = self._workers.get(job.worker_id)
                if worker:
                    worker.queue_depth += 1
                    self._persist_worker(worker)
            else:
                job.status = "failed"
                job.error = "Worker lease expired; maximum attempts reached"
                job.finished_at = now
            self._persist_job(job)
            changed.append(job)
        return changed

    def reap_expired_jobs(self) -> list[LanJob]:
        with self._lock:
            return self._expire_running_jobs()

    def register_worker(self, payload: Dict[str, Any]) -> WorkerRecord:
        worker_id = str(payload.get("worker_id") or "").strip()
        if not worker_id:
            raise ValueError("worker_id không được để trống")
        with self._lock:
            current = self._workers.get(worker_id)
            record = WorkerRecord(
                worker_id=worker_id,
                hostname=str(payload.get("hostname") or (current.hostname if current else "")),
                ip_address=str(payload.get("ip_address") or (current.ip_address if current else "")),
                platform=str(payload.get("platform") or "windows"),
                app_version=str(payload.get("app_version") or ""),
                model_version=str(payload.get("model_version") or ""),
                gpu_name=str(payload.get("gpu_name") or ""),
                vram_mb=int(payload.get("vram_mb") or (current.vram_mb if current else 0)),
                vram_free_mb=(int(payload["vram_free_mb"]) if payload.get("vram_free_mb") is not None
                              else (current.vram_free_mb if current else None)),
                disk_free_bytes=(int(payload["disk_free_bytes"]) if payload.get("disk_free_bytes") is not None
                                 else (current.disk_free_bytes if current else None)),
                slots_available=(int(payload["slots_available"]) if payload.get("slots_available") is not None
                                 else (current.slots_available if current else None)),
                capabilities=dict(payload.get("capabilities") or (current.capabilities if current else {})),
                status="online",
                active_job_id=current.active_job_id if current else None,
                queue_depth=current.queue_depth if current else 0,
            )
            self._workers[worker_id] = record
            self._persist_worker(record)
            return record

    def heartbeat(self, worker_id: str, payload: Optional[Dict[str, Any]] = None) -> WorkerRecord:
        with self._lock:
            self._expire_running_jobs()
            worker = self._workers.get(worker_id)
            if worker is None:
                raise KeyError(worker_id)
            payload = payload or {}
            worker.last_seen = time.time()
            # Heartbeat proves liveness, but must not override an admin's
            # draining/disabled intent. The worker can be restored explicitly.
            if worker.status not in {"draining", "disabled"}:
                worker.status = "online"
            if "queue_depth" in payload:
                worker.queue_depth = max(0, int(payload["queue_depth"]))
            if "active_job_id" in payload:
                active_job_id = payload["active_job_id"]
                if active_job_id is not None and active_job_id not in self._jobs:
                    raise LanStateError("active_job_id không tồn tại")
                worker.active_job_id = active_job_id
            if "gpu_name" in payload:
                worker.gpu_name = str(payload["gpu_name"])
            if "vram_mb" in payload:
                worker.vram_mb = int(payload["vram_mb"])
            if "vram_free_mb" in payload:
                worker.vram_free_mb = int(payload["vram_free_mb"])
            if "disk_free_bytes" in payload:
                worker.disk_free_bytes = int(payload["disk_free_bytes"])
            if "slots_available" in payload:
                worker.slots_available = max(0, int(payload["slots_available"]))
            if "capabilities" in payload and isinstance(payload["capabilities"], dict):
                worker.capabilities = dict(payload["capabilities"])
            if "last_error" in payload:
                worker.last_error = str(payload["last_error"]) if payload["last_error"] else None
            active_job_id = str(payload.get("job_id") or worker.active_job_id or "")
            if active_job_id:
                job = self._jobs.get(active_job_id)
                if job is None or job.worker_id != worker_id or job.status != "running":
                    raise LanStateError("Job heartbeat không ở trạng thái running của worker")
                supplied_lease = payload.get("lease_id")
                if not supplied_lease:
                    raise LanLeaseError("lease_id là bắt buộc khi heartbeat job đang chạy")
                if supplied_lease != job.lease_id:
                    raise LanLeaseError("Lease không còn hợp lệ")
                now = time.time()
                job.heartbeat_at = now
                job.lease_expires_at = now + self.lease_seconds
                job.updated_at = now
                self._persist_job(job)
            self._persist_worker(worker)
            return worker

    def heartbeat_job_lease(self, worker_id: str, job_id: str, *, lease_seconds: float = 30.0) -> LanJob:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.worker_id != worker_id:
                raise KeyError(job_id)
            if job.status == "cancelled":
                return job
            if job.status != "running":
                raise LanStateError("Job không ở trạng thái running")
            now = time.time()
            job.heartbeat_at = now
            job.lease_expires_at = now + max(5.0, float(lease_seconds))
            job.updated_at = now
            self._persist_job(job)
            return job

    def set_worker_status(self, worker_id: str, status: str) -> WorkerRecord:
        if status not in {"online", "draining", "disabled"}:
            raise ValueError("Trạng thái worker không hợp lệ")
        with self._lock:
            worker = self._workers.get(worker_id)
            if worker is None:
                raise KeyError(worker_id)
            worker.status = status
            self._persist_worker(worker)
            return worker

    def delete_worker(self, worker_id: str) -> None:
        """Xóa worker đã offline hoặc disabled và không còn job đang chạy."""
        with self._lock:
            worker = self._workers.get(worker_id)
            if worker is None:
                raise KeyError(worker_id)
            if worker.status == "online" and (time.time() - worker.last_seen) <= 30.0:
                raise ValueError("Không thể xóa worker đang online và hoạt động")
            if worker.active_job_id:
                raise LanStateError("Không thể xóa worker đang thực thi job")
            # Nếu có job gán cho worker này chưa chạy, chuyển worker_id của job về None hoặc unassign
            for job in self._jobs.values():
                if job.worker_id == worker_id and job.status in {"queued", "running"}:
                    raise LanStateError("Không thể xóa worker còn job chưa hoàn thành trong queue")
            del self._workers[worker_id]
            self._delete_worker(worker_id)

    def list_workers(self) -> list[Dict[str, Any]]:
        with self._lock:
            return [worker.to_dict() for worker in self._workers.values()]

    def create_job(self, payload: Dict[str, Any]) -> LanJob:
        key = str(payload.get("idempotency_key") or "").strip()
        if not key:
            raise ValueError("idempotency_key không được để trống")
        with self._lock:
            existing_id = self._idempotency.get(key)
            if existing_id:
                return self._jobs[existing_id]
            job_id = str(payload.get("job_id") or f"lan-{int(time.time() * 1000)}")
            job_type = str(payload.get("job_type") or "ocr").strip()
            worker_id = str(payload.get("worker_id") or "").strip()
            max_attempts = int(payload.get("max_attempts") or 3)
            if max_attempts < 1:
                raise ValueError("max_attempts phải lớn hơn hoặc bằng 1")
            job = LanJob(
                job_id=job_id,
                project_id=str(payload.get("project_id") or "").strip(),
                worker_id=worker_id,
                job_type=job_type,
                idempotency_key=key,
                profile=str(payload.get("profile") or "full_speed_quality"),
                video_fingerprint=str(payload.get("video_fingerprint") or ""),
                max_attempts=max_attempts,
                metrics=dict(payload.get("metrics") or {}),
                protocol_version=(str(payload.get("protocol_version") or PROTOCOL_VERSION)
                                  if payload.get("package") is not None else None),
                stage_plan=list(payload.get("stage_plan") or []),
                package=dict(payload["package"]) if isinstance(payload.get("package"), dict) else None,
            )
            if not job.project_id:
                raise ValueError("project_id không được để trống")
            if not worker_id:
                selected = self._select_worker(self._eligible_workers(job_type, job), job)
                if selected is None:
                    raise KeyError("no-capable-worker")
                job.worker_id = selected.worker_id
            worker = self._workers.get(job.worker_id)
            if worker is None:
                raise KeyError(job.worker_id)
            if not self._worker_supports(worker, job.job_type):
                raise LanStateError("Worker không hỗ trợ job_type yêu cầu")
            if not self._worker_has_resources(worker, job):
                raise LanStateError("Worker không đủ tài nguyên cho job yêu cầu")
            self._jobs[job.job_id] = job
            self._idempotency[key] = job.job_id
            worker.queue_depth += 1
            self._persist_worker(worker)
            self._persist_job(job)
            return job

    def update_job(self, job_id: str, payload: Dict[str, Any]) -> LanJob:
        with self._lock:
            self._expire_running_jobs()
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            supplied_lease = payload.get("lease_id")
            worker_id = str(payload.get("worker_id") or "").strip()
            if worker_id:
                if worker_id != job.worker_id:
                    raise LanLeaseError("Worker không sở hữu job này")
                if job.status == "running" and not supplied_lease:
                    raise LanLeaseError("lease_id là bắt buộc khi worker cập nhật job đang chạy")
            if supplied_lease is not None and supplied_lease != job.lease_id:
                raise LanLeaseError("Lease không còn hợp lệ")
            previous_status = job.status
            requested_status = str(payload["status"]) if "status" in payload else job.status
            if requested_status not in VALID_JOB_STATUSES:
                raise ValueError("Trạng thái job không hợp lệ")
            if job.status in TERMINAL_JOB_STATUSES and requested_status != job.status:
                raise LanStateError("Không thể thay đổi job đã kết thúc")
            if requested_status == "running" and job.status not in {"queued", "running"}:
                raise LanStateError("Chuyển trạng thái job không hợp lệ")
            job.status = requested_status
            if "progress" in payload:
                job.progress = max(0.0, min(1.0, float(payload["progress"])))
            if "metrics" in payload and isinstance(payload["metrics"], dict):
                job.metrics = dict(payload["metrics"])
            if "error" in payload:
                job.error = str(payload["error"]) if payload["error"] else None
            if "current_stage" in payload:
                job.current_stage = str(payload["current_stage"]) if payload["current_stage"] else None
            if "result" in payload:
                if payload["result"] is not None and not isinstance(payload["result"], dict):
                    raise ValueError("result phải là object")
                job.result = dict(payload["result"]) if payload["result"] is not None else None
            if "artifacts" in payload:
                if not isinstance(payload["artifacts"], list):
                    raise ValueError("artifacts phải là danh sách")
                job.artifacts = list(payload["artifacts"])
            if "lease_expires_at" in payload:
                job.lease_expires_at = (float(payload["lease_expires_at"])
                                        if payload["lease_expires_at"] is not None else None)
            now = time.time()
            if job.status in TERMINAL_JOB_STATUSES:
                job.finished_at = job.finished_at or now
                job.lease_id = None
                job.lease_expires_at = None
                job.heartbeat_at = None
                worker = self._workers.get(job.worker_id)
                if previous_status == "queued" and worker:
                    worker.queue_depth = max(0, worker.queue_depth - 1)
                    self._persist_worker(worker)
                self._clear_worker_job(job)
            job.updated_at = now
            self._persist_job(job)
            return job

    def cancel_job(self, job_id: str) -> LanJob:
        return self.update_job(job_id, {"status": "cancelled"})

    def retry_job(self, job_id: str, *, stage_plan: Optional[list[str]] = None) -> LanJob:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            if job.status not in {"failed", "cancelled", "completed"}:
                raise ValueError("Chỉ có thể retry job đã kết thúc")
            if stage_plan is not None:
                job.stage_plan = list(stage_plan)
                if job.package is not None:
                    job.package = {**job.package, "stage_plan": list(stage_plan)}
            current_worker = self._workers.get(job.worker_id)
            if (current_worker is None or current_worker.status in {"disabled", "draining"}
                    or (time.time() - current_worker.last_seen) > 30.0
                    or not self._worker_supports(current_worker, job.job_type)
                    or not self._worker_has_resources(current_worker, job)):
                selected = self._select_worker(self._eligible_workers(job.job_type, job), job)
                if selected:
                    job.worker_id = selected.worker_id
            target_worker = self._workers.get(job.worker_id)
            if target_worker is None or not self._worker_has_resources(target_worker, job):
                raise LanStateError("Không có worker đủ tài nguyên để chạy lại job")
            target_worker.queue_depth += 1
            self._persist_worker(target_worker)
            job.status = "queued"
            job.progress = 0.0
            job.error = None
            job.lease_id = None
            job.lease_expires_at = None
            job.heartbeat_at = None
            job.started_at = None
            job.finished_at = None
            job.current_stage = None
            job.result = None
            job.updated_at = time.time()
            self._persist_job(job)
            return job

    def delete_job(self, job_id: str) -> None:
        """Xóa job khỏi hàng đợi hoặc lịch sử."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            if job.status == "running":
                raise LanStateError("Không thể xóa job đang chạy. Hãy hủy job trước.")
            # Giảm queue_depth của worker nếu job đang ở trạng thái queued
            if job.status == "queued" and job.worker_id:
                worker = self._workers.get(job.worker_id)
                if worker:
                    worker.queue_depth = max(0, worker.queue_depth - 1)
                    self._persist_worker(worker)
            self._clear_worker_job(job)
            if job.idempotency_key in self._idempotency:
                del self._idempotency[job.idempotency_key]
            del self._jobs[job_id]
            self._delete_job(job_id)

    def list_jobs(self, status: Optional[str] = None) -> list[Dict[str, Any]]:
        with self._lock:
            self._expire_running_jobs()
            jobs = self._jobs.values()
            if status:
                jobs = [j for j in jobs if j.status == status]
            return [job.to_dict() for job in jobs]

    def overview(self) -> Dict[str, Any]:
        with self._lock:
            self._expire_running_jobs()
            workers = [worker.to_dict() for worker in self._workers.values()]
            jobs = [job.to_dict() for job in self._jobs.values()]
            downloads = [item.to_dict() for item in self._downloads.values()]
            return {
                "protocol_version": LAN_PROTOCOL_VERSION,
                "workers": workers,
                "jobs": jobs,
                "downloads": downloads,
                "counts": {
                    "workers": len(workers),
                    "online_workers": sum(1 for worker in workers if worker["is_online"] and worker["status"] == "online"),
                    "queued_jobs": sum(1 for job in jobs if job["status"] == "queued"),
                    "running_jobs": sum(1 for job in jobs if job["status"] == "running"),
                    "failed_jobs": sum(1 for job in jobs if job["status"] == "failed"),
                    "pending_downloads": sum(1 for item in downloads if item["status"] in {"preview_ready", "approved", "downloading"}),
                },
            }

    def get_job(self, job_id: str) -> LanJob:
        with self._lock:
            if job_id not in self._jobs:
                raise KeyError(job_id)
            return self._jobs[job_id]

    def claim_next_job(self, worker_id: str) -> Optional[LanJob]:
        """Atomically claim the oldest queued job assigned to a worker."""
        with self._lock:
            self._expire_running_jobs()
            if worker_id not in self._workers:
                raise KeyError(worker_id)
            worker = self._workers[worker_id]
            if worker.status in {"draining", "disabled"} or worker.active_job_id:
                return None
            queued = [
                job for job in self._jobs.values()
                if job.worker_id == worker_id and job.status == "queued"
                and self._worker_supports(worker, job.job_type)
                and self._worker_has_resources(worker, job)
            ]
            if not queued:
                return None
            job = min(queued, key=lambda item: item.created_at)
            now = time.time()
            job.status = "running"
            job.attempt += 1
            job.lease_id = uuid.uuid4().hex
            job.lease_expires_at = now + self.lease_seconds
            job.heartbeat_at = now
            job.started_at = job.started_at or now
            job.finished_at = None
            job.updated_at = now
            worker.active_job_id = job.job_id
            worker.queue_depth = max(0, worker.queue_depth - 1)
            self._persist_job(job)
            self._persist_worker(worker)
            return job

    def create_download_preview(self, payload: Dict[str, Any]) -> DownloadApproval:
        request_id = str(payload.get("request_id") or f"download-{int(time.time() * 1000)}")
        worker_id = str(payload.get("worker_id") or "").strip()
        source = str(payload.get("source") or "").strip()
        with self._lock:
            if worker_id not in self._workers:
                raise KeyError(worker_id)
            if not source:
                raise ValueError("source không được để trống")
            current = self._downloads.get(request_id)
            if current:
                return current
            request = DownloadApproval(
                request_id=request_id,
                worker_id=worker_id,
                source=source,
                title=str(payload.get("title") or ""),
                thumbnail_url=str(payload.get("thumbnail_url") or ""),
                duration_seconds=payload.get("duration_seconds"),
                size_bytes=payload.get("size_bytes"),
            )
            self._downloads[request_id] = request
            self._persist_download(request)
            return request

    def list_downloads(self, status: Optional[str] = None) -> list[Dict[str, Any]]:
        with self._lock:
            values = self._downloads.values()
            if status:
                values = [request for request in values if request.status == status]
            return [request.to_dict() for request in values]

    def decide_download(self, request_id: str, approved: bool) -> DownloadApproval:
        with self._lock:
            request = self._downloads.get(request_id)
            if request is None:
                raise KeyError(request_id)
            if request.status not in {"preview_ready", "requested"}:
                raise ValueError("Yêu cầu tải đã được quyết định")
            request.status = "approved" if approved else "rejected"
            request.decided_at = time.time()
            self._persist_download(request)
            return request

    def claim_download(self, worker_id: str) -> Optional[DownloadApproval]:
        with self._lock:
            if worker_id not in self._workers:
                raise KeyError(worker_id)
            if self._workers[worker_id].status in {"draining", "disabled"}:
                return None
            candidates = [item for item in self._downloads.values() if item.worker_id == worker_id and item.status == "approved"]
            if not candidates:
                return None
            item = min(candidates, key=lambda value: value.created_at)
            item.status = "downloading"
            item.decided_at = time.time()
            self._persist_download(item)
            return item

    def update_download(self, request_id: str, payload: Dict[str, Any]) -> DownloadApproval:
        """Persist worker-side download progress without allowing terminal rollback."""
        with self._lock:
            request = self._downloads.get(request_id)
            if request is None:
                raise KeyError(request_id)
            status = payload.get("status")
            allowed = {"downloading", "downloaded", "failed", "cancelled"}
            if status is not None:
                status = str(status)
                if status not in allowed:
                    raise ValueError("Trạng thái download không hợp lệ")
                if request.status in {"downloaded", "rejected", "cancelled"} and status != request.status:
                    raise ValueError("Không thể thay đổi download đã kết thúc")
                request.status = status
            self._persist_download(request)
            return request
