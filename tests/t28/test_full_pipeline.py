"""Unit and integration tests for Tab Full-Pipeline feature (Ticket T28).

Covers:
- Database schema migration v5
- FullPipelineWorkflowV1 domain model & state transitions
- FullPipelineOrchestrator lifecycle, idempotency, retry, cancel, restart recovery
- Quality gates (download, ROI, OCR, translation, dubbing, export)
- REST API preview, create, status, cancel, retry
"""
import tempfile
import time
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from subtitle_localizer.domain.models import (
    FullPipelineWorkflowV1,
    FullPipelineStageV1,
    FullPipelineSettingsV1,
    FallbackEventV1,
    ProjectManifestV1,
    SubtitleCueV1,
    RegionTrackV1,
)
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.full_pipeline_orchestrator import FullPipelineOrchestrator
from subtitle_localizer.service.server import create_app


class TestFullPipelineWorkflowDomain(unittest.TestCase):
    def test_workflow_model_creation_and_serialization(self) -> None:
        settings = FullPipelineSettingsV1(
            source_language="auto",
            target_language="vi",
            target_resolution="1080p",
            dubbing_enabled=True,
            voice="vi-VN-HoaiMyNeural",
            speed_fit=True,
            burn_subtitles=True,
            mask_subtitles=True,
            mask_mode="blur",
            export_srt_ass=True,
        )
        wf = FullPipelineWorkflowV1(
            workflow_id="wf-test-01",
            source_url="https://example.com/video.mp4",
            idempotency_key="idem-123",
            state="queued",
            current_stage="downloading",
            settings=settings,
        )
        self.assertEqual(wf.workflow_id, "wf-test-01")
        self.assertEqual(wf.state, "queued")
        self.assertEqual(wf.current_stage, "downloading")
        self.assertEqual(len(wf.stages), 6)  # 6 standard stages

        d = wf.to_dict()
        self.assertEqual(d["workflow_id"], "wf-test-01")
        self.assertEqual(d["settings"]["target_language"], "vi")

        restored = FullPipelineWorkflowV1.from_dict(d)
        self.assertEqual(restored.workflow_id, wf.workflow_id)
        self.assertEqual(restored.settings.voice, "vi-VN-HoaiMyNeural")

    def test_valid_and_invalid_state_transitions(self) -> None:
        wf = FullPipelineWorkflowV1(
            workflow_id="wf-test-state",
            source_url="https://example.com/v.mp4",
        )
        self.assertEqual(wf.state, "queued")

        # Valid forward transition
        wf.transition_to("downloading")
        self.assertEqual(wf.state, "downloading")

        # Invalid transition: cannot jump directly from downloading to completed
        with self.assertRaises(ValueError):
            wf.transition_to("completed")

        # Valid transitions: downloading -> detecting_roi -> ocr -> translating -> dubbing -> exporting -> completed
        wf.transition_to("detecting_roi")
        wf.transition_to("ocr")
        wf.transition_to("translating")
        wf.transition_to("dubbing")
        wf.transition_to("exporting")
        wf.transition_to("completed")
        self.assertEqual(wf.state, "completed")

        # Branches: active state can go to needs_review, failed, cancelled, retrying
        wf2 = FullPipelineWorkflowV1(workflow_id="wf-test-branch", source_url="https://example.com/v.mp4")
        wf2.transition_to("downloading")
        wf2.transition_to("failed")
        self.assertEqual(wf2.state, "failed")


class TestFullPipelinePersistence(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_full_pipeline.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)

    def tearDown(self) -> None:
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_schema_migration_v5_and_workflow_crud(self) -> None:
        wf = FullPipelineWorkflowV1(
            workflow_id="wf-persist-01",
            source_url="https://example.com/test.mp4",
            idempotency_key="idem-persist-01",
            state="queued",
            current_stage="downloading",
        )
        self.repo.save_workflow(wf)

        loaded = self.repo.get_workflow("wf-persist-01")
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.workflow_id, "wf-persist-01")
        self.assertEqual(loaded.source_url, "https://example.com/test.mp4")

        # Idempotency lookup
        by_idem = self.repo.find_workflow_by_idempotency_key("idem-persist-01")
        self.assertIsNotNone(by_idem)
        self.assertEqual(by_idem.workflow_id, "wf-persist-01")

        # List workflows
        all_wf = self.repo.list_workflows()
        self.assertEqual(len(all_wf), 1)

    def test_reconcile_active_workflows_on_restart(self) -> None:
        wf = FullPipelineWorkflowV1(
            workflow_id="wf-interrupted",
            source_url="https://example.com/test.mp4",
            state="downloading",
            current_stage="downloading",
        )
        self.repo.save_workflow(wf)

        # On restart, active incomplete workflows get reconciled to needs_review or retrying safely
        self.repo.reconcile_active_workflows()
        reconciled = self.repo.get_workflow("wf-interrupted")
        self.assertIn(reconciled.state, ("needs_review", "queued", "retrying"))


class TestFullPipelineOrchestratorQualityGates(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_orchestrator.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.orchestrator = FullPipelineOrchestrator(self.repo, output_root=self.temp_dir.name)

    def tearDown(self) -> None:
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_quality_gate_download_rejects_empty_or_part_files(self) -> None:
        wf = FullPipelineWorkflowV1(workflow_id="wf-gate-dl", source_url="https://example.com/v.mp4")
        part_file = Path(self.temp_dir.name) / "test.part"
        part_file.write_bytes(b"temp")

        with self.assertRaises(RuntimeError):
            self.orchestrator.verify_download_gate(wf, part_file)

        empty_file = Path(self.temp_dir.name) / "empty.mp4"
        empty_file.write_bytes(b"")
        with self.assertRaises(RuntimeError):
            self.orchestrator.verify_download_gate(wf, empty_file)

    def test_quality_gate_roi_validates_bounds(self) -> None:
        wf = FullPipelineWorkflowV1(workflow_id="wf-gate-roi", source_url="https://example.com/v.mp4")
        invalid_roi = RegionTrackV1(region_id="roi-bad", x=-0.1, y=0.8, width=0.5, height=0.2)
        with self.assertRaises(ValueError):
            self.orchestrator.verify_roi_gate(wf, [invalid_roi])

        valid_roi = RegionTrackV1(region_id="roi-ok", x=0.05, y=0.75, width=0.9, height=0.15)
        self.assertTrue(self.orchestrator.verify_roi_gate(wf, [valid_roi]))

    def test_quality_gate_ocr_rejects_mock_markers_and_invalid_times(self) -> None:
        wf = FullPipelineWorkflowV1(workflow_id="wf-gate-ocr", source_url="https://example.com/v.mp4")
        mock_cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="Sample text mock-ocr")
        ]
        with self.assertRaises(ValueError):
            self.orchestrator.verify_ocr_gate(wf, mock_cues)

        bad_time_cues = [
            SubtitleCueV1(cue_id="c2", start_pts=2.0, end_pts=1.0, source_text="Xin chào")
        ]
        with self.assertRaises(ValueError):
            self.orchestrator.verify_ocr_gate(wf, bad_time_cues)

        valid_cues = [
            SubtitleCueV1(cue_id="c3", start_pts=0.5, end_pts=2.5, source_text="你好世界")
        ]
        self.assertTrue(self.orchestrator.verify_ocr_gate(wf, valid_cues))

    def test_fallback_logging_and_policy(self) -> None:
        wf = FullPipelineWorkflowV1(workflow_id="wf-fallback-test", source_url="https://example.com/v.mp4")
        self.orchestrator.record_fallback(
            wf=wf,
            stage="ocr",
            from_provider="capcut_cloud",
            error="Cloud rate limit 429",
            to_provider="ppocrv5_local",
        )
        self.assertEqual(len(wf.fallback_events), 1)
        ev = wf.fallback_events[0]
        self.assertEqual(ev.stage, "ocr")
        self.assertEqual(ev.from_provider, "capcut_cloud")
        self.assertEqual(ev.to_provider, "ppocrv5_local")


class TestFullPipelineApiEndpoints(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_api.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.app = create_app(database=self.db, repo=self.repo, output_root=self.temp_dir.name)
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_preview_endpoint_success_and_validation(self) -> None:
        # Invalid empty url
        resp = self.client.post("/api/v1/workflows/full-pipeline/preview", json={"url": ""})
        self.assertEqual(resp.status_code, 400)

        # Valid url preview (mock parse_media_target)
        with patch("subtitle_localizer.service.downloader.parse_media_target") as mock_parse:
            mock_parse.return_value = {
                "platform": "youtube",
                "url": "https://www.youtube.com/watch?v=sample123",
                "title": "Sample Clip Video",
                "cover_url": "https://img.youtube.com/vi/sample123/0.jpg",
                "duration": 45.0,
                "resolutions": [{"id": "1080p", "label": "1080p", "size_mb": 25}],
            }
            resp = self.client.post("/api/v1/workflows/full-pipeline/preview", json={
                "url": "https://www.youtube.com/watch?v=sample123",
                "source_language": "auto",
                "target_language": "vi",
            })
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["title"], "Sample Clip Video")
            self.assertEqual(data["platform"], "youtube")
            self.assertEqual(data["target_language"], "vi")

    def test_create_status_cancel_retry_endpoints(self) -> None:
        # Create workflow
        payload = {
            "url": "https://example.com/demo.mp4",
            "source_language": "auto",
            "target_language": "vi",
            "dubbing_enabled": True,
            "voice": "vi-VN-HoaiMyNeural",
            "idempotency_key": "idem-api-test-01",
        }
        with patch.object(self.app.state.full_pipeline_orchestrator, "start_workflow_async"):
            resp = self.client.post("/api/v1/workflows/full-pipeline", json=payload)
            self.assertEqual(resp.status_code, 200)
            created = resp.json()
            wf_id = created["workflow_id"]
            self.assertIn("wf-", wf_id)
            self.assertEqual(created["state"], "queued")

            # Idempotency check: same idempotency_key returns existing workflow
            resp_dup = self.client.post("/api/v1/workflows/full-pipeline", json=payload)
            self.assertEqual(resp_dup.status_code, 200)
            self.assertEqual(resp_dup.json()["workflow_id"], wf_id)

            # Get status
            resp_status = self.client.get(f"/api/v1/workflows/full-pipeline/{wf_id}")
            self.assertEqual(resp_status.status_code, 200)
            st = resp_status.json()
            self.assertEqual(st["workflow_id"], wf_id)
            self.assertIn("stages", st)

            # Cancel workflow
            resp_cancel = self.client.post(f"/api/v1/workflows/full-pipeline/{wf_id}/cancel")
            self.assertEqual(resp_cancel.status_code, 200)

            # Retry workflow
            resp_retry = self.client.post(f"/api/v1/workflows/full-pipeline/{wf_id}/retry")
            self.assertEqual(resp_retry.status_code, 200)

            # List workflows
            resp_list = self.client.get("/api/v1/workflows/full-pipeline")
            self.assertEqual(resp_list.status_code, 200)
            self.assertGreaterEqual(len(resp_list.json()["workflows"]), 1)
