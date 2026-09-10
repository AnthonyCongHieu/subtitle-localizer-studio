"""Small coordinator client intended to run beside a full Windows worker stack."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import socket
import shutil
import subprocess
import threading
import time
import urllib.request
import uuid
import ipaddress
import asyncio
from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1
from subtitle_localizer.service.lan_artifacts import JobWorkspace, atomic_write_bytes
from subtitle_localizer.service.lan_protocol import (
    ArtifactMetadata, JobPackage, ResultPackage, PROTOCOL_VERSION, sha256_file,
)

DISCOVERY_MAGIC = "subtitle-localizer-coordinator"
DISCOVERY_VERSION = 1
DISCOVERY_PORT = 45871


def stable_worker_id(hostname: Optional[str] = None, machine_id: Optional[str] = None) -> str:
    """Return a stable, privacy-preserving id for a worker machine."""
    host = (hostname or socket.gethostname()).strip().lower()
    identity = machine_id or hex(uuid.getnode())
    digest = hashlib.sha256(f"{host}:{identity}".encode("utf-8")).hexdigest()[:16]
    return f"worker-{digest}"


def discover_coordinator(*, timeout: float = 2.0, port: int = DISCOVERY_PORT,
                         broadcast_address: str = "255.255.255.255",
                         allowed_subnets: Optional[list[str]] = None,
                         socket_factory: Any = socket.socket) -> Optional[Dict[str, Any]]:
    """Discover a coordinator on the local LAN using a small UDP handshake.

    Only endpoint metadata is exchanged; registration tokens are never sent.
    """
    request = json.dumps({"magic": DISCOVERY_MAGIC, "version": DISCOVERY_VERSION,
                          "type": "discover"}).encode("utf-8")
    sock = socket_factory(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(max(0.1, float(timeout)))
        sock.sendto(request, (broadcast_address, int(port)))
        while True:
            data, address = sock.recvfrom(4096)
            payload = json.loads(data.decode("utf-8"))
            if allowed_subnets:
                try:
                    source_ip = ipaddress.ip_address(address[0])
                    if not any(source_ip in ipaddress.ip_network(net, strict=False) for net in allowed_subnets):
                        continue
                except ValueError:
                    continue
            if (payload.get("magic") == DISCOVERY_MAGIC and
                    payload.get("version") == DISCOVERY_VERSION and
                    payload.get("type") == "coordinator"):
                payload.setdefault("ip", address[0])
                return payload
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None
    finally:
        sock.close()


def collect_worker_capabilities(data_root: Optional[Path | str] = None, *, max_concurrent_jobs: int = 1) -> Dict[str, Any]:
    """Collect locally observable hardware capacity for worker scheduling."""
    root = Path(data_root).resolve() if data_root is not None else Path.cwd()
    metadata: Dict[str, Any] = {
        "platform": "windows",
        "capabilities": {"downloader": True, "cuda": False},
        "max_concurrent_jobs": max(1, int(max_concurrent_jobs)),
        "vram_total_mb": 0,
        "vram_free_mb": None,
        "ram_free_mb": 0,
        "disk_free_gb": 0.0,
    }
    try:
        metadata["disk_free_gb"] = round(shutil.disk_usage(root).free / (1024 ** 3), 2)
    except OSError:
        pass
    try:
        import psutil
        metadata["ram_free_mb"] = int(psutil.virtual_memory().available / (1024 ** 2))
    except (ImportError, OSError):
        try:
            import ctypes
            class MemoryStatus(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            status = MemoryStatus()
            status.dwLength = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                metadata["ram_free_mb"] = int(status.ullAvailPhys / (1024 ** 2))
        except (AttributeError, OSError):
            pass
    try:
        import torch
        if torch.cuda.is_available():
            free_bytes, total_bytes = torch.cuda.mem_get_info()
            metadata.update({"vram_total_mb": int(total_bytes / (1024 ** 2)),
                             "vram_free_mb": int(free_bytes / (1024 ** 2))})
            metadata["capabilities"]["cuda"] = True
            try:
                metadata["gpu_name"] = torch.cuda.get_device_name()
            except Exception:
                pass
            metadata["vram_mb"] = metadata["vram_total_mb"]
            return metadata
    except (ImportError, AttributeError, RuntimeError):
        pass
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi:
        return metadata
    try:
        output = subprocess.check_output(
            [nvidia_smi, "--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"],
            text=True, encoding="utf-8", timeout=5,
        ).splitlines()
        if output:
            name, total, free = (item.strip() for item in output[0].split(",", 2))
            metadata.update({"gpu_name": name, "vram_total_mb": int(float(total or 0)),
                             "vram_free_mb": int(float(free or 0))})
            metadata["capabilities"]["cuda"] = True
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    metadata["vram_mb"] = metadata["vram_total_mb"]
    return metadata


def _copy_shared_source(source: Path | str, destination: Path, metadata: ArtifactMetadata) -> Path:
    """Copy an accessible local or SMB source, preserving source checksum validation."""
    source_path = Path(source)
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    robocopy = shutil.which("robocopy") if os.name == "nt" else None
    if robocopy and source_path.drive and destination.drive and source_path.drive.lower() != destination.drive.lower():
        result = subprocess.run(
            [robocopy, str(source_path.parent), str(destination.parent), source_path.name,
             "/J", "/MT:16", "/R:1", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS"],
            check=False, capture_output=True, timeout=60 * 60,
        )
        if result.returncode > 7:
            raise OSError(f"robocopy failed with exit code {result.returncode}")
    else:
        shutil.copyfile(source_path, destination)
    if (not destination.is_file() or destination.stat().st_size != metadata.size_bytes or
            sha256_file(destination) != metadata.sha256):
        destination.unlink(missing_ok=True)
        raise ValueError("Shared source does not match artifact checksum")
    return destination


class LanWorkerAgent:
    def __init__(self, coordinator_url: Optional[str] = None, worker_id: Optional[str] = None,
                 token: str = "", *, interval_seconds: float = 5.0,
                 opener: Any = urllib.request.urlopen, state_path: Optional[Path | str] = None,
                 discovery_timeout: float = 2.0, discovery_port: int = DISCOVERY_PORT,
                 discovery_subnets: Optional[list[str]] = None,
                 discovery_fn: Callable[..., Optional[Dict[str, Any]]] = discover_coordinator,
                 data_root: Optional[Path | str] = None, max_concurrent_jobs: int = 1) -> None:
        self.coordinator_url = (coordinator_url or "").rstrip("/")
        self.worker_id = worker_id or stable_worker_id()
        self.token = token
        self.interval_seconds = max(1.0, float(interval_seconds))
        self.opener = opener
        self.state_path = Path(state_path) if state_path else None
        self.discovery_timeout = discovery_timeout
        self.discovery_port = discovery_port
        self.discovery_subnets = discovery_subnets
        self.discovery_fn = discovery_fn
        self.data_root = Path(data_root).resolve() if data_root is not None else None
        self.max_concurrent_jobs = max(1, int(max_concurrent_jobs))
        self._active_jobs: Dict[str, Future[Any]] = {}
        self._jobs_lock = threading.Lock()
        self.status_path = self.data_root / "status.json" if self.data_root else None
        self.config_path = self.data_root / "config.json" if self.data_root else None
        if self.data_root:
            self.data_root.mkdir(parents=True, exist_ok=True)
        self._pending_updates: list[tuple[str, Dict[str, Any]]] = []
        self._logs: deque[str] = deque(maxlen=100)
        self._load_outbox()
        self._stop = threading.Event()
        if self.config_path and not self.config_path.exists():
            self.config_path.write_text(json.dumps({
                "protocol_version": PROTOCOL_VERSION,
                "coordinator_url": self.coordinator_url,
                "worker_id": self.worker_id,
                "poll_interval_seconds": self.interval_seconds,
                "max_concurrent_jobs": self.max_concurrent_jobs,
            }, ensure_ascii=False, indent=2), encoding="utf-8")
        self._set_status(connection="disconnected", readiness="starting", current_job=None,
                         stage=None, progress=0.0, capabilities={})

    def discover(self) -> Optional[Dict[str, Any]]:
        if self.coordinator_url:
            return {"url": self.coordinator_url, "source": "manual"}
        kwargs: Dict[str, Any] = {"timeout": self.discovery_timeout, "port": self.discovery_port}
        if self.discovery_subnets is not None:
            kwargs["allowed_subnets"] = self.discovery_subnets
        result = self.discovery_fn(**kwargs)
        if result and result.get("url"):
            self.coordinator_url = str(result["url"]).rstrip("/")
        return result

    def _load_outbox(self) -> None:
        if not self.state_path or not self.state_path.exists():
            return
        try:
            self._pending_updates = [(str(item[0]), dict(item[1])) for item in json.loads(self.state_path.read_text(encoding="utf-8"))]
        except (OSError, ValueError, TypeError):
            self._pending_updates = []

    def _save_outbox(self) -> None:
        if not self.state_path:
            return
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(json.dumps(self._pending_updates, ensure_ascii=False), encoding="utf-8")

    def _flush_outbox(self) -> None:
        pending = list(self._pending_updates)
        for job_id, payload in pending:
            try:
                if job_id.startswith("download:"):
                    self._request("PATCH", f"/api/v1/admin/downloads/{job_id.split(':', 1)[1]}", payload)
                else:
                    self._request("PATCH", f"/api/v1/admin/jobs/{job_id}", payload)
                self._pending_updates.remove((job_id, payload))
            except Exception:
                break
        self._save_outbox()

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        data = json.dumps(payload or {}).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(f"{self.coordinator_url}{path}", data=data, method=method, headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        with self.opener(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))

    def _request_bytes(self, method: str, path: str, data: Optional[bytes] = None,
                       headers: Optional[Dict[str, str]] = None) -> bytes:
        request_headers = {"Authorization": f"Bearer {self.token}"}
        request_headers.update(headers or {})
        request = urllib.request.Request(f"{self.coordinator_url}{path}", data=data, method=method,
                                         headers=request_headers)
        with self.opener(request, timeout=60) as response:
            return response.read()

    def job_lease(self, job_id: str) -> Dict[str, Any]:
        return self._request("POST", f"/api/v1/admin/jobs/{job_id}/lease?worker_id={self.worker_id}")

    def download_artifact(self, path: str, destination: Path, metadata: ArtifactMetadata) -> Path:
        body = self._request_bytes("GET", path)
        if len(body) != metadata.size_bytes or hashlib.sha256(body).hexdigest() != metadata.sha256:
            raise ValueError("Artifact tải xuống không khớp checksum")
        return atomic_write_bytes(destination, body, max_bytes=max(metadata.size_bytes, 1))

    def upload_artifact(self, job_id: str, source: Path, kind: str) -> ArtifactMetadata:
        metadata = ArtifactMetadata(source.name, kind, source.stat().st_size, sha256_file(source))
        self._request_bytes("PUT", f"/api/v1/admin/jobs/{job_id}/results/{metadata.name}",
                            source.read_bytes(), {
                                "Content-Type": "application/octet-stream",
                                "X-Artifact-Size": str(metadata.size_bytes),
                                "X-Artifact-Sha256": metadata.sha256,
                                "X-Artifact-Kind": kind,
                            })
        return metadata

    def commit_result(self, job_id: str, result: ResultPackage) -> Dict[str, Any]:
        return self._request("POST", f"/api/v1/admin/jobs/{job_id}/results/commit", result.to_dict())

    def _set_status(self, **updates: Any) -> None:
        if "log" in updates:
            self._logs.append(str(updates.pop("log")))
        if not self.status_path:
            return
        current: Dict[str, Any] = {}
        if self.status_path.exists():
            try:
                current = json.loads(self.status_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                current = {}
        current.update(updates)
        current.update({"protocol_version": PROTOCOL_VERSION, "worker_id": self.worker_id,
                        "updated_at": time.time(), "recent_logs": list(self._logs)})
        self.status_path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")

    def register(self, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if not self.coordinator_url and not self.discover():
            raise ConnectionError("Không tìm thấy coordinator trong LAN")
        payload = {"worker_id": self.worker_id, "hostname": socket.gethostname(), "platform": "windows"}
        payload.update(metadata or {})
        return self._request("POST", "/api/v1/admin/workers/register", payload)

    def heartbeat(self, **payload: Any) -> Dict[str, Any]:
        return self._request("POST", f"/api/v1/admin/workers/{self.worker_id}/heartbeat", payload)

    def claim(self) -> Optional[Dict[str, Any]]:
        return self._request("POST", f"/api/v1/admin/workers/{self.worker_id}/claim").get("job")

    def claim_download(self) -> Optional[Dict[str, Any]]:
        return self._request("POST", f"/api/v1/admin/workers/{self.worker_id}/claim-download").get("download")

    def update_download(self, request_id: str, status: str) -> Dict[str, Any]:
        payload = {"status": status}
        try:
            result = self._request("PATCH", f"/api/v1/admin/downloads/{request_id}", payload)
            self._flush_outbox()
            return result
        except Exception:
            item = (f"download:{request_id}", payload)
            if item not in self._pending_updates:
                self._pending_updates.append(item)
                self._save_outbox()
            raise

    def update_job(self, job_id: str, **payload: Any) -> Dict[str, Any]:
        payload = {"worker_id": self.worker_id, **payload}
        try:
            result = self._request("PATCH", f"/api/v1/admin/jobs/{job_id}", payload)
            self._flush_outbox()
            return result
        except Exception:
            item = (job_id, dict(payload))
            if item not in self._pending_updates:
                self._pending_updates.append(item)
                self._save_outbox()
            raise

    def _active_job_count(self) -> int:
        with self._jobs_lock:
            return len(self._active_jobs)

    def _collect_finished_jobs(self) -> None:
        with self._jobs_lock:
            finished = [(job_id, future) for job_id, future in self._active_jobs.items() if future.done()]
            for job_id, future in finished:
                del self._active_jobs[job_id]
                try:
                    future.result()
                except Exception as error:
                    self._set_status(log=f"Job {job_id} failed: {error}")

    def run(self, job_handler: Callable[[Dict[str, Any], "LanWorkerAgent"], None], download_handler: Optional[Callable[[Dict[str, Any], "LanWorkerAgent"], None]] = None, registration_metadata: Optional[Dict[str, Any]] = None) -> None:
        while not self._stop.is_set():
            try:
                self.register(registration_metadata)
                break
            except Exception:
                self._stop.wait(min(self.interval_seconds, 5.0))
        if self._stop.is_set():
            return
        with ThreadPoolExecutor(max_workers=self.max_concurrent_jobs, thread_name_prefix="lan-job") as executor:
            while not self._stop.is_set():
                try:
                    self._flush_outbox()
                    self._collect_finished_jobs()
                    active_jobs = self._active_job_count()
                    slots_available = max(0, self.max_concurrent_jobs - active_jobs)
                    telemetry = collect_worker_capabilities(
                        self.data_root, max_concurrent_jobs=self.max_concurrent_jobs,
                    )
                    heartbeat_payload: Dict[str, Any] = {
                        "active_job_id": None,
                        "active_jobs": active_jobs,
                        "slots_available": slots_available,
                        "max_concurrent_jobs": self.max_concurrent_jobs,
                        "queue_depth": 0,
                        "last_error": None,
                    }
                    heartbeat_payload.update({
                        key: telemetry[key] for key in ("vram_total_mb", "vram_free_mb", "ram_free_mb", "disk_free_gb")
                        if key in telemetry
                    })
                    self.heartbeat(**heartbeat_payload)
                    while slots_available and not self._stop.is_set():
                        job = self.claim()
                        if not job:
                            break
                        job_id = str(job["job_id"])
                        future = executor.submit(job_handler, job, self)
                        with self._jobs_lock:
                            self._active_jobs[job_id] = future
                        slots_available -= 1
                    if download_handler and slots_available:
                        download = self.claim_download()
                        if download:
                            download_handler(download, self)
                except Exception as error:
                    try:
                        self.heartbeat(active_job_id=None, active_jobs=self._active_job_count(),
                                       slots_available=max(0, self.max_concurrent_jobs - self._active_job_count()),
                                       queue_depth=0, last_error=str(error))
                    except Exception:
                        pass
                self._stop.wait(self.interval_seconds)

    def stop(self) -> None:
        self._stop.set()


def build_protocol_job_handler(repository: Any, *, workspace_root: Path | str,
                               output_root: Path | str) -> Callable[[Dict[str, Any], LanWorkerAgent], None]:
    """Thực thi package có phiên bản trong workspace cô lập và gửi kết quả đã xác minh."""
    from subtitle_localizer.service.worker import BackgroundWorker
    from subtitle_localizer.service.project_runtime import run_project_dubbing, run_project_export

    def handle(job: Dict[str, Any], agent: LanWorkerAgent) -> None:
        if not job.get("package"):
            return build_pipeline_job_handler(repository)(job, agent)
        package = JobPackage.from_dict(job["package"])
        workspace = JobWorkspace(workspace_root, package.job_id)
        stop_lease = threading.Event()

        def heartbeat_loop() -> None:
            while not stop_lease.wait(max(1.0, agent.interval_seconds)):
                lease = agent.job_lease(package.job_id)
                if lease.get("cancel_requested"):
                    stop_lease.set()

        lease_thread = threading.Thread(target=heartbeat_loop, name=f"lease-{package.job_id}", daemon=True)
        lease_thread.start()
        produced: list[Path] = []
        try:
            source_items = [item for item in package.artifacts if item.kind == "source"]
            if not source_items:
                raise ValueError("Package không có source artifact")
            source_meta = source_items[0]
            source_url = source_meta.download_url or f"/api/v1/admin/jobs/{package.job_id}/source/{source_meta.name}"
            source_destination = workspace.source_path(source_meta.name)
            source_candidate = str(package.project.get("source_video_path") or "")
            try:
                source_path = _copy_shared_source(source_candidate, source_destination, source_meta)
                if hasattr(agent, "_set_status"):
                    agent._set_status(log=f"Copied source locally for {package.job_id}")
            except (FileNotFoundError, OSError, ValueError):
                source_path = agent.download_artifact(source_url, source_destination, source_meta)
                if hasattr(agent, "_set_status"):
                    agent._set_status(log=f"Downloaded source over HTTP for {package.job_id}")
            manifest_data = dict(package.project)
            manifest_data["project_id"] = package.project_id
            manifest_data["source_video_path"] = str(source_path)
            manifest_data["regions"] = list(package.regions)
            manifest_data["custom_pipeline_settings"] = dict(package.settings) or manifest_data.get("custom_pipeline_settings")
            manifest = ProjectManifestV1.from_dict(manifest_data)
            repository.save_project(manifest)
            repository.save_cues(package.project_id, [SubtitleCueV1.from_dict(item) for item in package.cues])
            stages = package.stage_plan
            if "ocr" in stages:
                success = BackgroundWorker(repository).run_pipeline_synchronous(
                    package.project_id, ocr_only="translate" not in stages
                )
                if not success:
                    raise RuntimeError("Pipeline OCR/dịch thất bại")
            elif "translate" in stages:
                current_manifest = repository.get_project(package.project_id)
                cues = repository.get_cues(package.project_id)
                if current_manifest is None or not cues:
                    raise RuntimeError("Không có cue để dịch lại")
                translator = BackgroundWorker(repository).translation_registry.get_provider_for_pair(
                    current_manifest.source_language, current_manifest.target_language
                )
                translator.load()
                try:
                    repository.save_cues(package.project_id, translator.translate_cues(
                        cues, source_lang=current_manifest.source_language,
                        target_lang=current_manifest.target_language,
                    ))
                finally:
                    translator.unload()
            if stop_lease.is_set():
                raise InterruptedError("Job đã bị hủy")
            if "dub" in stages:
                produced.append(asyncio.run(run_project_dubbing(repository, package.project_id, output_root)))
            if "export" in stages:
                produced.append(run_project_export(repository, package.project_id, output_root))
            artifacts = [
                agent.upload_artifact(package.job_id, path,
                                      "video" if path.suffix.lower() == ".mp4" else "audio")
                for path in produced
            ]
            final_manifest = repository.get_project(package.project_id)
            result = ResultPackage(
                job_id=package.job_id, project_id=package.project_id, project=final_manifest.to_dict(),
                cues=[cue.to_dict() for cue in repository.get_cues(package.project_id)],
                stage_runs=[stage.to_dict() for stage in repository.get_stage_runs(package.project_id)],
                artifacts=artifacts,
            )
            agent.commit_result(package.job_id, result)
        except InterruptedError:
            agent.update_job(package.job_id, status="cancelled", error="Coordinator đã hủy job",
                             lease_id=job.get("lease_id"))
            raise
        except Exception as error:
            agent.update_job(package.job_id, status="failed", error=str(error),
                             lease_id=job.get("lease_id"))
            raise
        finally:
            stop_lease.set()
            lease_thread.join(timeout=2.0)

    return handle


def build_pipeline_job_handler(repository: Any, *, ocr_only: bool = False) -> Callable[[Dict[str, Any], LanWorkerAgent], None]:
    """Adapt a claimed coordinator job to the existing full-stack worker."""
    from subtitle_localizer.service.worker import BackgroundWorker

    def handle(job: Dict[str, Any], agent: LanWorkerAgent) -> None:
        project_id = str(job["project_id"])
        try:
            success = BackgroundWorker(repository).run_pipeline_synchronous(project_id, ocr_only=ocr_only)
            # Export only persisted stage facts; no synthetic per-frame progress.
            stage_metrics: Dict[str, Any] = {}
            try:
                stages = repository.get_stage_runs(project_id)
                stage_metrics = {
                    "stages": [{"name": s.stage_name, "status": s.status, "progress": s.progress} for s in stages],
                    "stage_count": len(stages),
                }
                errors = [error for stage in stages for error in stage.errors]
            except Exception:
                errors = []
            payload: Dict[str, Any] = {
                "status": "completed" if success else "failed",
                "progress": 1.0 if success else 0.0,
                "metrics": stage_metrics,
                "lease_id": job.get("lease_id"),
            }
            if errors and not success:
                payload["error"] = errors[-1]
            agent.update_job(job["job_id"], **payload)
        except Exception as error:
            agent.update_job(job["job_id"], status="failed", error=str(error), lease_id=job.get("lease_id"))
            raise

    return handle


def build_download_handler(repository: Any, *, downloader: Any = None) -> Callable[[Dict[str, Any], LanWorkerAgent], None]:
    """Run an approved request through the existing DownloadManager.

    The optional downloader is injectable for tests; production constructs the
    project's existing manager and never downloads before coordinator approval.
    """
    if downloader is None:
        from subtitle_localizer.service.downloader import DownloadManager, parse_media_target
        manager = DownloadManager(repository=repository)

        def downloader(item: Dict[str, Any]) -> Dict[str, Any]:
            before = {project.project_id for project in repository.list_projects()}
            target = parse_media_target(item["source"], strict_proxy=True)
            manager.start_download(target_info=target, auto_create_project=True)
            # start_download schedules work; wait for the real terminal state so
            # the coordinator never reports a download as complete prematurely.
            deadline = time.time() + 24 * 60 * 60
            while time.time() < deadline:
                status = manager.get_status().get("status")
                if status in {"completed", "failed", "cancelled"}:
                    if status != "completed":
                        raise RuntimeError(manager.get_status().get("error") or f"download {status}")
                    created = [project for project in repository.list_projects()
                               if project.project_id not in before]
                    result = created[0] if created else None
                    return {
                        "project_id": result.project_id if result else None,
                        "source_video_path": result.source_video_path if result else None,
                    }
                time.sleep(1.0)
            raise TimeoutError("Download vượt quá thời gian chờ 24 giờ")

    def handle(item: Dict[str, Any], agent: LanWorkerAgent) -> None:
        request_id = str(item["request_id"])
        try:
            result = downloader(item)
            agent.update_download(request_id, "downloaded")
            return result if isinstance(result, dict) else {}
        except Exception:
            try:
                agent.update_download(request_id, "failed")
            finally:
                raise

    return handle
