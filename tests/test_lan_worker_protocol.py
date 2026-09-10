import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.lan_artifacts import CoordinatorArtifactStore, JobWorkspace
from subtitle_localizer.service.lan_protocol import ArtifactMetadata, JobPackage, ProtocolError, ResultPackage, sha256_file
from subtitle_localizer.service.lan_worker import LanWorkerAgent, build_protocol_job_handler
from subtitle_localizer.service.server import create_app


def test_protocol_rejects_unsafe_artifact_and_invalid_stage_plan(tmp_path):
    try:
        ArtifactMetadata("../escape", "source", 0, "0" * 64)
        assert False, "unsafe name accepted"
    except ProtocolError:
        pass
    package = JobPackage("j", "p", {}, stage_plan=["ocr", "unknown", "publish"])
    try:
        package.validate()
        assert False, "invalid stage accepted"
    except ProtocolError:
        pass


def test_artifact_store_atomic_sha_validation(tmp_path):
    store = CoordinatorArtifactStore(tmp_path / "store", max_result_bytes=20)
    metadata = ArtifactMetadata("result.bin", "result", 4, "0" * 64)
    import io
    try:
        store.save_result("job-1", metadata, io.BytesIO(b"data"))
        assert False, "bad sha accepted"
    except ProtocolError:
        pass
    assert not store.result_path("job-1", "result.bin").exists()


def test_server_package_source_upload_and_verified_commit(tmp_path):
    db = Database(tmp_path / "coordinator.db")
    db.migrate()
    repo = ProjectRepository(db)
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source-video")
    manifest = ProjectManifestV1("project-1", "Project", str(source), "fp", "zh", "vi")
    repo.save_project(manifest)
    app = create_app(database=db, repo=repo, auth_token="secret", output_root=tmp_path / "out")
    client = TestClient(app)
    headers = {"Authorization": "Bearer secret"}
    client.post("/api/v1/admin/workers/register", json={"worker_id": "worker-1"}, headers=headers)
    response = client.post("/api/v1/admin/jobs", json={
        "project_id": manifest.project_id, "worker_id": "worker-1", "idempotency_key": "one",
        "protocol_version": "lan-worker-v1", "stage_plan": ["download", "prepare", "ocr", "publish"],
    }, headers=headers)
    assert response.status_code == 200, response.text
    job = response.json()
    assert job["protocol_version"] == "lan-worker-v1"
    package = client.get(f"/api/v1/admin/jobs/{job['job_id']}/package", headers=headers)
    assert package.status_code == 200
    package_data = package.json()
    source_meta = package_data["artifacts"][0]
    downloaded = client.get(source_meta["download_url"], headers=headers)
    assert downloaded.content == b"source-video"

    result_file = tmp_path / "rendered.mp4"
    result_file.write_bytes(b"rendered")
    result_meta = ArtifactMetadata(result_file.name, "video", result_file.stat().st_size, sha256_file(result_file))
    upload_headers = {**headers, "X-Artifact-Size": str(result_meta.size_bytes),
                      "X-Artifact-Sha256": result_meta.sha256, "X-Artifact-Kind": result_meta.kind}
    uploaded = client.put(f"/api/v1/admin/jobs/{job['job_id']}/results/{result_meta.name}",
                          content=result_file.read_bytes(), headers=upload_headers)
    assert uploaded.status_code == 200, uploaded.text
    worker_manifest = manifest.to_dict()
    worker_manifest["source_video_path"] = "worker-local/source.mp4"
    result = ResultPackage(job["job_id"], manifest.project_id, worker_manifest,
                           [SubtitleCueV1("c1", 0, 1, "你好", "Xin chào").to_dict()], [], [result_meta])
    committed = client.post(f"/api/v1/admin/jobs/{job['job_id']}/results/commit",
                            json=result.to_dict(), headers=headers)
    assert committed.status_code == 200, committed.text
    assert committed.json()["project_id"] == manifest.project_id
    assert repo.get_cues(manifest.project_id)[0].translated_text == "Xin chào"
    assert app.state.lan_coordinator.get_job(job["job_id"]).status == "completed"
    db.close()


def test_worker_imports_package_rewrites_source_and_commits(tmp_path):
    db = Database(tmp_path / "worker.db")
    db.migrate()
    repo = ProjectRepository(db)
    source_bytes = b"remote-source"
    metadata = ArtifactMetadata("input.mp4", "source", len(source_bytes),
                                __import__("hashlib").sha256(source_bytes).hexdigest(),
                                download_url="/source/input.mp4")
    package = JobPackage("job-1", "project-1", ProjectManifestV1(
        "project-1", "Remote", "coordinator/path.mp4", "fp", "zh", "vi"
    ).to_dict(), stage_plan=["download", "prepare", "ocr", "publish"], artifacts=[metadata])

    class Agent:
        interval_seconds = 1.0
        def __init__(self): self.committed = None; self.updates = []
        def _set_status(self, **kwargs): pass
        def download_artifact(self, path, destination, meta):
            destination.write_bytes(source_bytes); return destination
        def job_lease(self, job_id): return {"cancel_requested": False}
        def upload_artifact(self, *args): raise AssertionError("no output artifacts expected")
        def commit_result(self, job_id, result): self.committed = result; return {"status": "completed"}
        def update_job(self, job_id, **payload): self.updates.append(payload)

    agent = Agent()
    with patch("subtitle_localizer.service.worker.BackgroundWorker.run_pipeline_synchronous", return_value=True):
        build_protocol_job_handler(repo, workspace_root=tmp_path / "jobs", output_root=tmp_path / "out")(
            {"job_id": "job-1", "project_id": "project-1", "package": package.to_dict()}, agent
        )
    local = repo.get_project("project-1")
    assert Path(local.source_video_path).read_bytes() == source_bytes
    assert agent.committed is not None
    db.close()


def test_worker_status_contract_never_contains_token(tmp_path):
    agent = LanWorkerAgent("http://coordinator", "worker-1", "top-secret", data_root=tmp_path / "worker"/ "data")
    status = json.loads(agent.status_path.read_text(encoding="utf-8"))
    config = json.loads(agent.config_path.read_text(encoding="utf-8"))
    assert {"connection", "readiness", "current_job", "stage", "progress", "recent_logs", "capabilities"} <= status.keys()
    assert "top-secret" not in agent.status_path.read_text(encoding="utf-8")
    assert "top-secret" not in agent.config_path.read_text(encoding="utf-8")
    assert config["protocol_version"] == "lan-worker-v1"
