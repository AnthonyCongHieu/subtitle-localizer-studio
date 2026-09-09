"""Small coordinator client intended to run beside a full Windows worker stack."""
from __future__ import annotations

import json
import socket
import shutil
import subprocess
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, Optional


def collect_worker_capabilities() -> Dict[str, Any]:
    """Collect only locally observable capabilities for registration."""
    metadata: Dict[str, Any] = {"platform": "windows", "capabilities": {"downloader": True}}
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi:
        metadata["capabilities"]["cuda"] = False
        return metadata
    try:
        output = subprocess.check_output(
            [nvidia_smi, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            text=True,
            encoding="utf-8",
            timeout=5,
        ).splitlines()
        if output:
            name, _, memory = output[0].partition(",")
            metadata.update({"gpu_name": name.strip(), "vram_mb": int(float(memory.strip())) if memory.strip() else 0})
            metadata["capabilities"]["cuda"] = True
    except (OSError, ValueError, subprocess.SubprocessError):
        metadata["capabilities"]["cuda"] = False
    return metadata


class LanWorkerAgent:
    def __init__(self, coordinator_url: str, worker_id: str, token: str, *, interval_seconds: float = 5.0, opener: Any = urllib.request.urlopen, state_path: Optional[Path | str] = None) -> None:
        self.coordinator_url = coordinator_url.rstrip("/")
        self.worker_id = worker_id
        self.token = token
        self.interval_seconds = max(1.0, float(interval_seconds))
        self.opener = opener
        self.state_path = Path(state_path) if state_path else None
        self._pending_updates: list[tuple[str, Dict[str, Any]]] = []
        self._load_outbox()
        self._stop = threading.Event()

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

    def register(self, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
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

    def run(self, job_handler: Callable[[Dict[str, Any], "LanWorkerAgent"], None], download_handler: Optional[Callable[[Dict[str, Any], "LanWorkerAgent"], None]] = None, registration_metadata: Optional[Dict[str, Any]] = None) -> None:
        self.register(registration_metadata)
        while not self._stop.is_set():
            try:
                self._flush_outbox()
                job = self.claim()
                self.heartbeat(active_job_id=job.get("job_id") if job else None, queue_depth=0, last_error=None)
                if job:
                    job_handler(job, self)
                if download_handler:
                    download = self.claim_download()
                    if download:
                        download_handler(download, self)
            except Exception as error:
                # Connectivity failures are retried on the next heartbeat tick;
                # the local full-stack worker remains responsible for its state.
                try:
                    self.heartbeat(active_job_id=None, queue_depth=0, last_error=str(error))
                except Exception:
                    pass
            self._stop.wait(self.interval_seconds)

    def stop(self) -> None:
        self._stop.set()


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
            payload: Dict[str, Any] = {"status": "completed" if success else "failed", "progress": 1.0 if success else 0.0, "metrics": stage_metrics}
            if errors and not success:
                payload["error"] = errors[-1]
            agent.update_job(job["job_id"], **payload)
        except Exception as error:
            agent.update_job(job["job_id"], status="failed", error=str(error))
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

        def downloader(item: Dict[str, Any]) -> None:
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
                    return
                time.sleep(1.0)
            raise TimeoutError("Download vượt quá thời gian chờ 24 giờ")

    def handle(item: Dict[str, Any], agent: LanWorkerAgent) -> None:
        request_id = str(item["request_id"])
        try:
            downloader(item)
            agent.update_download(request_id, "downloaded")
        except Exception:
            try:
                agent.update_download(request_id, "failed")
            finally:
                raise

    return handle
