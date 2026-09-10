import gc
import sys
import tempfile
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.server import PipelineRunRequest, create_app
from subtitle_localizer.service.worker import BackgroundWorker


def _store():
    temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
    db = Database(Path(temp_dir.name) / "test.db")
    db.migrate()
    return temp_dir, db, ProjectRepository(db)


def _project(repo, temp_dir, project_id="ocr-only-project"):
    video = Path(temp_dir.name) / f"{project_id}.mp4"
    video.write_bytes(b"test-video")
    repo.save_project(
        ProjectManifestV1(
            project_id=project_id,
            title="OCR only test",
            source_video_path=str(video),
            video_fingerprint=f"fp-{project_id}",
            source_language="zh",
            target_language="vi",
            custom_pipeline_settings={
                "ocr": {
                    "mode": "api",
                    "api_provider": "capcut",
                    "api_fusion_mode": "api_only",
                }
            },
        )
    )
    return project_id


def _close(temp_dir, db):
    db.close()
    gc.collect()
    temp_dir.cleanup()


def test_pipeline_run_request_schema_includes_ocr_only():
    assert PipelineRunRequest(ocr_only=True).ocr_only is True
    assert PipelineRunRequest().ocr_only is False


def test_server_forwards_ocr_only_for_sync_and_async_runs():
    temp_dir, db, repo = _store()
    try:
        project_id = _project(repo, temp_dir)
        worker = MagicMock(spec=BackgroundWorker)
        worker.run_pipeline_synchronous.return_value = True
        app = create_app(database=db, repo=repo, auth_token="token", worker=worker)
        client = TestClient(app)
        headers = {"Authorization": "Bearer token"}

        sync = client.post(
            f"/api/v1/projects/{project_id}/pipeline/run",
            json={"sync": True, "ocr_only": True, "max_duration_seconds": 12.5},
            headers=headers,
        )
        assert sync.status_code == 200
        assert sync.json()["ocr_only"] is True
        worker.run_pipeline_synchronous.assert_called_once_with(
            project_id, max_duration_seconds=12.5, ocr_only=True
        )

        started = threading.Event()
        release = threading.Event()

        def run_async(*_args, **_kwargs):
            started.set()
            assert release.wait(2)
            return True

        worker.run_pipeline_synchronous.reset_mock(side_effect=True)
        worker.run_pipeline_synchronous.side_effect = run_async
        async_response = client.post(
            f"/api/v1/projects/{project_id}/pipeline/run",
            json={"ocr_only": True},
            headers=headers,
        )
        assert async_response.status_code == 200
        assert async_response.json() == {
            "status": "running",
            "project_id": project_id,
            "max_duration_seconds": None,
            "ocr_only": True,
        }
        assert started.wait(2)

        duplicate = client.post(
            f"/api/v1/projects/{project_id}/pipeline/run",
            json={"ocr_only": True},
            headers=headers,
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["ocr_only"] is True
        assert worker.run_pipeline_synchronous.call_count == 1
        release.set()
    finally:
        _close(temp_dir, db)


def test_worker_ocr_only_never_starts_translation_or_loses_source_cues():
    temp_dir, db, repo = _store()
    try:
        project_id = _project(repo, temp_dir, "worker-ocr-only")
        worker = BackgroundWorker(repo)
        extracted = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="你好"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="再见"),
        ]
        with patch(
            "subtitle_localizer.cloud.capcut_bridge.CapCutBridgeExtractor.extract_cues",
            return_value=extracted,
        ), patch.object(
            worker.boundary_refiner,
            "refine_cues",
            side_effect=lambda **kwargs: kwargs["cues"],
        ), patch.object(worker.translation_registry, "get_provider_for_pair") as translator:
            assert worker.run_pipeline_synchronous(project_id, ocr_only=True) is True

        translator.assert_not_called()
        cues = repo.get_cues(project_id)
        assert [cue.source_text for cue in cues] == ["你好", "再见"]
        assert all(cue.translated_text == "" for cue in cues)
        stages = repo.get_stage_runs(project_id)
        assert not any(stage.stage_name == "translation" for stage in stages)
        assert stages[-1].stage_name == "pipeline"
        assert stages[-1].status == "completed"
    finally:
        _close(temp_dir, db)
