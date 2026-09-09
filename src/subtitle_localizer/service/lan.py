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
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Optional

DISCOVERY_MAGIC = "subtitle-localizer-coordinator"
DISCOVERY_VERSION = 1
DISCOVERY_PORT = 45871


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
    def __init__(self, database: Any = None) -> None:
        self._database = database
        self._workers: Dict[str, WorkerRecord] = {}
        self._jobs: Dict[str, LanJob] = {}
        self._idempotency: Dict[str, str] = {}
        self._downloads: Dict[str, DownloadApproval] = {}
        self._lock = threading.RLock()
        self._load_persisted()

    def _conn(self):
        return self._database.get_connection() if self._database is not None else None

    def _load_persisted(self) -> None:
        conn = self._conn()
        if conn is None:
            return
        try:
            for row in conn.execute("SELECT worker_json FROM lan_workers"):
                data = json.loads(row[0]); self._workers[data["worker_id"]] = WorkerRecord(**data)
            for row in conn.execute("SELECT job_json FROM lan_jobs"):
                data = json.loads(row[0]); job = LanJob(**data); self._jobs[job.job_id] = job; self._idempotency[job.idempotency_key] = job.job_id
            for row in conn.execute("SELECT download_json FROM lan_downloads"):
                data = json.loads(row[0]); item = DownloadApproval(**data); self._downloads[item.request_id] = item
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
            conn.execute("INSERT OR REPLACE INTO lan_jobs(job_id, idempotency_key, job_json, updated_at) VALUES (?, ?, ?, ?)", (job.job_id, job.idempotency_key, json.dumps(asdict(job), ensure_ascii=False), time.time()))

    def _persist_download(self, item: DownloadApproval) -> None:
        conn = self._conn()
        if conn is not None:
            conn.execute("INSERT OR REPLACE INTO lan_downloads(request_id, download_json, updated_at) VALUES (?, ?, ?)", (item.request_id, json.dumps(asdict(item), ensure_ascii=False), time.time()))

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
                vram_mb=int(payload.get("vram_mb") or 0),
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
                worker.active_job_id = payload["active_job_id"]
            if "gpu_name" in payload:
                worker.gpu_name = str(payload["gpu_name"])
            if "vram_mb" in payload:
                worker.vram_mb = int(payload["vram_mb"])
            if "last_error" in payload:
                worker.last_error = str(payload["last_error"]) if payload["last_error"] else None
            self._persist_worker(worker)
            return worker

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
            worker_id = str(payload.get("worker_id") or "").strip()
            if not worker_id:
                candidates = [worker for worker in self._workers.values() if worker.status == "online" and (time.time() - worker.last_seen) <= 30.0]
                if not candidates:
                    raise KeyError("no-online-worker")
                worker_id = min(candidates, key=lambda worker: worker.queue_depth).worker_id
            if worker_id not in self._workers:
                raise KeyError(worker_id)
            job = LanJob(
                job_id=job_id,
                project_id=str(payload.get("project_id") or "").strip(),
                worker_id=worker_id,
                job_type=str(payload.get("job_type") or "ocr"),
                idempotency_key=key,
                profile=str(payload.get("profile") or "full_speed_quality"),
                video_fingerprint=str(payload.get("video_fingerprint") or ""),
            )
            if not job.project_id:
                raise ValueError("project_id không được để trống")
            self._jobs[job.job_id] = job
            self._idempotency[key] = job.job_id
            self._workers[worker_id].queue_depth += 1
            self._persist_worker(self._workers[worker_id])
            self._persist_job(job)
            return job

    def update_job(self, job_id: str, payload: Dict[str, Any]) -> LanJob:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            if "status" in payload:
                job.status = str(payload["status"])
            if "progress" in payload:
                job.progress = max(0.0, min(1.0, float(payload["progress"])))
            if "metrics" in payload and isinstance(payload["metrics"], dict):
                job.metrics = dict(payload["metrics"])
            if "error" in payload:
                job.error = str(payload["error"]) if payload["error"] else None
            job.updated_at = time.time()
            self._persist_job(job)
            return job

    def cancel_job(self, job_id: str) -> LanJob:
        job = self.update_job(job_id, {"status": "cancelled"})
        with self._lock:
            worker = self._workers.get(job.worker_id)
            if worker and worker.active_job_id == job_id:
                worker.active_job_id = None
                worker.queue_depth = max(0, worker.queue_depth - 1)
                self._persist_worker(worker)
        return job

    def retry_job(self, job_id: str) -> LanJob:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            if job.status not in {"failed", "cancelled"}:
                raise ValueError("Chỉ có thể retry job failed hoặc cancelled")
            current_worker = self._workers.get(job.worker_id)
            previous_worker_id = job.worker_id
            if (current_worker is None or current_worker.status in {"disabled", "draining"}
                    or (time.time() - current_worker.last_seen) > 30.0):
                candidates = [worker for worker in self._workers.values()
                              if worker.status == "online" and (time.time() - worker.last_seen) <= 30.0]
                if candidates:
                    job.worker_id = min(candidates, key=lambda worker: worker.queue_depth).worker_id
            if job.worker_id != previous_worker_id:
                target_worker = self._workers.get(job.worker_id)
                if target_worker:
                    target_worker.queue_depth += 1
                    self._persist_worker(target_worker)
            elif current_worker:
                current_worker.queue_depth += 1
                self._persist_worker(current_worker)
            job.status = "queued"
            job.progress = 0.0
            job.error = None
            job.updated_at = time.time()
            self._persist_job(job)
            return job

    def list_jobs(self, status: Optional[str] = None) -> list[Dict[str, Any]]:
        with self._lock:
            jobs = self._jobs.values()
            if status:
                jobs = [j for j in jobs if j.status == status]
            return [job.to_dict() for job in jobs]

    def get_job(self, job_id: str) -> LanJob:
        with self._lock:
            if job_id not in self._jobs:
                raise KeyError(job_id)
            return self._jobs[job_id]

    def claim_next_job(self, worker_id: str) -> Optional[LanJob]:
        """Atomically claim the oldest queued job assigned to a worker."""
        with self._lock:
            if worker_id not in self._workers:
                raise KeyError(worker_id)
            if self._workers[worker_id].status in {"draining", "disabled"}:
                return None
            queued = [job for job in self._jobs.values() if job.worker_id == worker_id and job.status == "queued"]
            if not queued:
                return None
            job = min(queued, key=lambda item: item.created_at)
            job.status = "running"
            job.updated_at = time.time()
            worker = self._workers[worker_id]
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
