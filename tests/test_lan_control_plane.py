import tempfile
import unittest
import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.lan import LanCoordinator
from subtitle_localizer.service.server import create_app
from subtitle_localizer.service.lan_worker import LanWorkerAgent
from unittest.mock import patch


class LanCoordinatorTests(unittest.TestCase):
    def test_worker_capability_report_is_local_and_structured(self) -> None:
        from subtitle_localizer.service.lan_worker import collect_worker_capabilities
        report = collect_worker_capabilities()
        self.assertEqual(report["platform"], "windows")
        self.assertIn("cuda", report["capabilities"])
        self.assertIn("downloader", report["capabilities"])

    def test_registration_heartbeat_and_idempotent_job(self) -> None:
        coordinator = LanCoordinator()
        worker = coordinator.register_worker({"worker_id": "w1", "gpu_name": "RTX 3050"})
        self.assertEqual(worker.worker_id, "w1")
        coordinator.heartbeat("w1", {"queue_depth": 2})
        first = coordinator.create_job({"project_id": "p1", "worker_id": "w1", "idempotency_key": "k1"})
        second = coordinator.create_job({"project_id": "p1", "worker_id": "w1", "idempotency_key": "k1"})
        self.assertEqual(first.job_id, second.job_id)
        self.assertEqual(coordinator.list_jobs()[0]["status"], "queued")

    def test_state_survives_coordinator_restart(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db = Database(Path(tmp) / "lan.db")
            db.migrate()
            first = LanCoordinator(db)
            first.register_worker({"worker_id": "persist-w"})
            first.create_job({"project_id": "persist-p", "worker_id": "persist-w", "idempotency_key": "persist-k"})
            restarted = LanCoordinator(db)
            self.assertEqual(restarted.list_workers()[0]["worker_id"], "persist-w")
            self.assertEqual(restarted.list_jobs()[0]["project_id"], "persist-p")
            db.close()

    def test_job_without_worker_is_assigned_to_lowest_queue_online_worker(self) -> None:
        coordinator = LanCoordinator()
        coordinator.register_worker({"worker_id": "busy", "queue_depth": 5})
        coordinator.register_worker({"worker_id": "free", "queue_depth": 0})
        coordinator.heartbeat("busy", {"queue_depth": 5})
        job = coordinator.create_job({"project_id": "p-auto", "idempotency_key": "auto-key"})
        self.assertEqual(job.worker_id, "free")

    def test_heartbeat_does_not_override_admin_draining_or_disabled_state(self) -> None:
        coordinator = LanCoordinator()
        coordinator.register_worker({"worker_id": "w-drain"})
        coordinator.set_worker_status("w-drain", "draining")
        coordinator.heartbeat("w-drain", {"queue_depth": 0})
        self.assertEqual(coordinator.list_workers()[0]["status"], "draining")
        coordinator.set_worker_status("w-drain", "disabled")
        coordinator.heartbeat("w-drain", {})
        self.assertEqual(coordinator.list_workers()[0]["status"], "disabled")

    def test_heartbeat_persists_worker_error_for_admin(self) -> None:
        coordinator = LanCoordinator()
        coordinator.register_worker({"worker_id": "w-error"})
        coordinator.heartbeat("w-error", {"last_error": "OCR session failed"})
        self.assertEqual(coordinator.list_workers()[0]["last_error"], "OCR session failed")

    def test_retry_reassigns_job_when_original_worker_unavailable(self) -> None:
        coordinator = LanCoordinator()
        coordinator.register_worker({"worker_id": "old"})
        coordinator.register_worker({"worker_id": "new"})
        coordinator.set_worker_status("old", "disabled")
        job = coordinator.create_job({"project_id": "p", "worker_id": "old", "idempotency_key": "retry-reassign"})
        coordinator.update_job(job.job_id, {"status": "failed", "error": "test"})
        retried = coordinator.retry_job(job.job_id)
        self.assertEqual(retried.worker_id, "new")
        self.assertEqual(retried.status, "queued")

    def test_cancel_clears_worker_active_job(self) -> None:
        coordinator = LanCoordinator()
        coordinator.register_worker({"worker_id": "w"})
        job = coordinator.create_job({"project_id": "p", "worker_id": "w", "idempotency_key": "cancel-active"})
        coordinator.claim_next_job("w")
        self.assertEqual(coordinator.list_workers()[0]["active_job_id"], job.job_id)
        coordinator.cancel_job(job.job_id)
        worker = coordinator.list_workers()[0]
        self.assertIsNone(worker["active_job_id"])
        self.assertEqual(worker["queue_depth"], 0)

    def test_worker_agent_builds_registration_heartbeat_and_claim_contract(self) -> None:
        calls = []
        class Response:
            def __init__(self, payload): self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return json.dumps(self.payload).encode("utf-8")
        def opener(request, timeout=15):
            calls.append((request.method, request.full_url, json.loads((request.data or b"{}").decode("utf-8"))))
            if request.method == "POST" and request.full_url.endswith("/claim"):
                return Response({"job": None})
            return Response({"worker_id": "agent-1"})
        agent = LanWorkerAgent("http://coordinator", "agent-1", "token", opener=opener)
        agent.register({"gpu_name": "RTX 3050"})
        agent.heartbeat(queue_depth=0)
        self.assertIsNone(agent.claim())
        self.assertEqual([call[0] for call in calls], ["POST", "POST", "POST"])

    def test_pipeline_handler_updates_completed_job(self) -> None:
        from subtitle_localizer.service.lan_worker import build_pipeline_job_handler
        class Agent:
            def __init__(self): self.payload = None
            def update_job(self, job_id, **payload): self.payload = (job_id, payload)
        with patch("subtitle_localizer.service.worker.BackgroundWorker.run_pipeline_synchronous", return_value=True):
            agent = Agent()
            build_pipeline_job_handler(object())({"job_id": "j1", "project_id": "p1"}, agent)
            self.assertEqual(agent.payload[0], "j1")
            self.assertEqual(agent.payload[1]["status"], "completed")
            self.assertEqual(agent.payload[1]["progress"], 1.0)
            self.assertIn("metrics", agent.payload[1])

    def test_worker_agent_persists_failed_update_and_replays_after_reconnect(self) -> None:
        calls = []
        state_path = Path(tempfile.mkdtemp()) / "outbox.json"
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return b'{"status":"completed"}'
        def offline(request, timeout=15):
            raise OSError("coordinator offline")
        agent = LanWorkerAgent("http://coordinator", "w1", "token", opener=offline, state_path=state_path)
        with self.assertRaises(OSError): agent.update_job("j1", status="completed")
        self.assertTrue(state_path.exists())
        def online(request, timeout=15):
            calls.append(request.full_url)
            return Response()
        agent.opener = online
        agent._flush_outbox()
        self.assertEqual(calls, ["http://coordinator/api/v1/admin/jobs/j1"])
        self.assertEqual(json.loads(state_path.read_text(encoding="utf-8")), [])

    def test_download_handler_reports_terminal_state(self) -> None:
        from subtitle_localizer.service.lan_worker import build_download_handler
        class Agent:
            def __init__(self): self.status = None
            def update_download(self, request_id, status): self.status = (request_id, status)
        agent = Agent()
        build_download_handler(object(), downloader=lambda item: None)({"request_id": "d1", "source": "mock"}, agent)
        self.assertEqual(agent.status, ("d1", "downloaded"))

    def test_download_handler_reports_failure(self) -> None:
        from subtitle_localizer.service.lan_worker import build_download_handler
        class Agent:
            def __init__(self): self.status = []
            def update_download(self, request_id, status): self.status.append((request_id, status))
        agent = Agent()
        with self.assertRaisesRegex(RuntimeError, "boom"):
            build_download_handler(object(), downloader=lambda item: (_ for _ in ()).throw(RuntimeError("boom")))({"request_id": "d2", "source": "mock"}, agent)
        self.assertEqual(agent.status, [("d2", "failed")])

    def test_download_update_replays_after_offline(self) -> None:
        state_path = Path(tempfile.mkdtemp()) / "outbox.json"
        def offline(request, timeout=15):
            raise OSError("offline")
        agent = LanWorkerAgent("http://coordinator", "w1", "token", opener=offline, state_path=state_path)
        with self.assertRaises(OSError):
            agent.update_download("d3", "downloaded")
        self.assertIn("download:d3", state_path.read_text(encoding="utf-8"))
        calls = []
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return b'{}'
        def online(request, timeout=15):
            calls.append(request.full_url); return Response()
        agent.opener = online
        agent._flush_outbox()
        self.assertEqual(calls, ["http://coordinator/api/v1/admin/downloads/d3"])


class LanApiTests(unittest.TestCase):
    def test_optional_lan_ip_whitelist_denies_non_allowed_client(self) -> None:
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"SL_LAN_ALLOWED_IPS": "192.0.2.10"}):
            db = Database(Path(tmp) / "ip.db")
            repo = ProjectRepository(db)
            client = TestClient(create_app(database=db, repo=repo, auth_token="secret", output_root=Path(tmp) / "out"))
            response = client.get("/api/v1/admin/workers", headers={"Authorization": "Bearer secret"})
            self.assertEqual(response.status_code, 403)
            db.close()

    def test_lan_changes_are_broadcast_over_existing_websocket(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db = Database(Path(tmp) / "ws.db")
            repo = ProjectRepository(db)
            client = TestClient(create_app(database=db, repo=repo, auth_token="secret", output_root=Path(tmp) / "out"))
            headers = {"Authorization": "Bearer secret"}
            with client.websocket_connect("/api/v1/ws") as websocket:
                response = client.post("/api/v1/admin/workers/register", json={"worker_id": "ws-worker"}, headers=headers)
                self.assertEqual(response.status_code, 200)
                event = websocket.receive_json()
                self.assertEqual(event["event_type"], "worker_registered")
                self.assertEqual(event["payload"]["worker_id"], "ws-worker")
            db.close()

    def test_admin_worker_and_job_routes_require_auth_and_work(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db = Database(Path(tmp) / "test.db")
            repo = ProjectRepository(db)
            client = TestClient(create_app(database=db, repo=repo, auth_token="secret", output_root=Path(tmp) / "out"))
            headers = {"Authorization": "Bearer secret"}
            self.assertEqual(client.get("/api/v1/admin/workers").status_code, 401)
            registered = client.post("/api/v1/admin/workers/register", json={"worker_id": "w1", "platform": "windows"}, headers=headers)
            self.assertEqual(registered.status_code, 200)
            job = client.post("/api/v1/admin/jobs", json={"project_id": "p1", "worker_id": "w1", "idempotency_key": "idem-1"}, headers=headers)
            self.assertEqual(job.status_code, 200)
            duplicate = client.post("/api/v1/admin/jobs", json={"project_id": "p1", "worker_id": "w1", "idempotency_key": "idem-1"}, headers=headers)
            self.assertEqual(duplicate.json()["job_id"], job.json()["job_id"])
            listed = client.get("/api/v1/admin/jobs?status=queued", headers=headers)
            self.assertEqual(len(listed.json()), 1)
            claimed = client.post("/api/v1/admin/workers/w1/claim", headers=headers)
            self.assertEqual(claimed.status_code, 200)
            self.assertEqual(claimed.json()["job"]["status"], "running")
            self.assertEqual(len(client.get("/api/v1/admin/jobs?status=queued", headers=headers).json()), 0)
            self.assertEqual(client.post("/api/v1/admin/jobs/unknown/cancel", headers=headers).status_code, 404)
            self.assertEqual(client.post("/api/v1/admin/workers/w1/status?status=draining", headers=headers).status_code, 200)
            # retry only applies after a terminal job state
            self.assertEqual(client.post(f"/api/v1/admin/jobs/{job.json()['job_id']}/cancel", headers=headers).status_code, 200)
            retried = client.post(f"/api/v1/admin/jobs/{job.json()['job_id']}/retry", headers=headers)
            self.assertEqual(retried.status_code, 200)
            self.assertEqual(retried.json()["status"], "queued")
            # Draining workers do not claim new work; restore explicitly.
            self.assertEqual(client.post("/api/v1/admin/workers/w1/status?status=online", headers=headers).status_code, 200)
            preview = client.post(
                "/api/v1/admin/downloads/preview",
                json={"request_id": "download-1", "worker_id": "w1", "source": "https://example.invalid/video", "title": "Phim thử"},
                headers=headers,
            )
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(preview.json()["status"], "preview_ready")
            decision = client.post("/api/v1/admin/downloads/download-1/decision", json={"approved": True}, headers=headers)
            self.assertEqual(decision.status_code, 200)
            self.assertEqual(decision.json()["status"], "approved")
            claimed_download = client.post("/api/v1/admin/workers/w1/claim-download", headers=headers)
            self.assertEqual(claimed_download.status_code, 200)
            self.assertEqual(claimed_download.json()["download"]["status"], "downloading")
            self.assertEqual(len(client.get("/api/v1/admin/downloads?status=downloading", headers=headers).json()), 1)
            updated = client.patch("/api/v1/admin/downloads/download-1", json={"status": "downloaded"}, headers=headers)
            self.assertEqual(updated.status_code, 200)
            self.assertEqual(updated.json()["status"], "downloaded")
            db.close()
