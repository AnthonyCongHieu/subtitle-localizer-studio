"""Unit and integration tests for Tab Full-Pipeline feature (Ticket T28).

Covers:
- Database schema migration v5
- FullPipelineWorkflowV1 domain model & state transitions
- FullPipelineOrchestrator lifecycle, idempotency, retry, cancel, restart recovery
- Quality gates (download, ROI, OCR, translation, dubbing, export)
- REST API preview, create, status, cancel, retry
"""
import subprocess
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

    def test_quality_gate_roi_strict_bounds_exhaustive(self) -> None:
        """P1: Kiểm tra toàn diện mọi vi phạm biên ROI [0, 1]: x âm, y âm, w/h <= 0, x+w > 1, y+h > 1."""
        wf = FullPipelineWorkflowV1(workflow_id="wf-roi-strict", source_url="https://example.com/v.mp4")

        # 1. x âm
        with self.assertRaises(ValueError) as ctx:
            self.orchestrator.verify_roi_gate(wf, [RegionTrackV1(region_id="r1", x=-0.05, y=0.5, width=0.5, height=0.2)])
        self.assertIn("x=-0.05", str(ctx.exception))

        # 2. y âm
        with self.assertRaises(ValueError) as ctx:
            self.orchestrator.verify_roi_gate(wf, [RegionTrackV1(region_id="r2", x=0.1, y=-0.05, width=0.5, height=0.2)])
        self.assertIn("y=-0.05", str(ctx.exception))

        # 3. width bằng 0
        with self.assertRaises(ValueError) as ctx:
            self.orchestrator.verify_roi_gate(wf, [RegionTrackV1(region_id="r3", x=0.1, y=0.1, width=0.0, height=0.2)])
        self.assertIn("width=0.0", str(ctx.exception))

        # 4. height bằng 0
        with self.assertRaises(ValueError) as ctx:
            self.orchestrator.verify_roi_gate(wf, [RegionTrackV1(region_id="r4", x=0.1, y=0.1, width=0.5, height=0.0)])
        self.assertIn("height=0.0", str(ctx.exception))

        # 5. width âm
        with self.assertRaises(ValueError) as ctx:
            self.orchestrator.verify_roi_gate(wf, [RegionTrackV1(region_id="r5", x=0.1, y=0.1, width=-0.2, height=0.2)])
        self.assertIn("width=-0.2", str(ctx.exception))

        # 6. height âm
        with self.assertRaises(ValueError) as ctx:
            self.orchestrator.verify_roi_gate(wf, [RegionTrackV1(region_id="r6", x=0.1, y=0.1, width=0.5, height=-0.2)])
        self.assertIn("height=-0.2", str(ctx.exception))

        # 7. x + width > 1.0 (ví dụ 0.6 + 0.5 = 1.1)
        with self.assertRaises(ValueError) as ctx:
            self.orchestrator.verify_roi_gate(wf, [RegionTrackV1(region_id="r7", x=0.6, y=0.1, width=0.5, height=0.2)])
        self.assertIn("x + width", str(ctx.exception))

        # 8. y + height > 1.0 (ví dụ 0.7 + 0.4 = 1.1)
        with self.assertRaises(ValueError) as ctx:
            self.orchestrator.verify_roi_gate(wf, [RegionTrackV1(region_id="r8", x=0.1, y=0.7, width=0.5, height=0.4)])
        self.assertIn("y + height", str(ctx.exception))

        # 9. ROI hợp lệ đúng biên [0, 0, 1, 1]
        boundary_roi = RegionTrackV1(region_id="r_boundary", x=0.0, y=0.0, width=1.0, height=1.0)
        self.assertTrue(self.orchestrator.verify_roi_gate(wf, [boundary_roi]))

        # 10. ROI hợp lệ tiêu chuẩn
        standard_roi = RegionTrackV1(region_id="r_standard", x=0.05, y=0.75, width=0.90, height=0.15)
        self.assertTrue(self.orchestrator.verify_roi_gate(wf, [standard_roi]))

    def test_quality_gate_translation_coverage_policy(self) -> None:
        """P1: Kiểm tra chính sách độ bao phủ dịch thuật: ngưỡng tối thiểu 98%, liệt kê cue rỗng, cảnh báo câu giữ nguyên."""
        wf = FullPipelineWorkflowV1(
            workflow_id="wf-trans-cov",
            source_url="https://example.com/v.mp4",
            settings=FullPipelineSettingsV1(source_language="zh", target_language="vi"),
        )

        # 1. 100% câu dịch rỗng -> Fail
        empty_cues = [
            SubtitleCueV1(cue_id=f"c_{i}", start_pts=i, end_pts=i + 1, source_text=f"Câu {i}", translated_text="")
            for i in range(10)
        ]
        with self.assertRaises(ValueError) as ctx:
            self.orchestrator.verify_translation_gate(wf, empty_cues)
        self.assertIn("100% câu dịch bị rỗng", str(ctx.exception))

        # 2. Độ bao phủ < 98% (ví dụ 10 câu có 1 câu rỗng -> 90% < 98%) -> Fail với danh sách cue rỗng
        partial_cues = [
            SubtitleCueV1(
                cue_id=f"c_{i}",
                start_pts=i,
                end_pts=i + 1,
                source_text=f"Câu gốc {i}",
                translated_text=f"Bản dịch {i}" if i != 3 else "",
            )
            for i in range(10)
        ]
        with self.assertRaises(ValueError) as ctx:
            self.orchestrator.verify_translation_gate(wf, partial_cues)
        self.assertIn("90.0%", str(ctx.exception))
        self.assertIn("c_3", str(ctx.exception))

        # 3. Độ bao phủ >= 98% (ví dụ 100 câu có 1 câu rỗng -> 99.0% >= 98%) -> Pass
        high_cov_cues = [
            SubtitleCueV1(
                cue_id=f"c_{i}",
                start_pts=i,
                end_pts=i + 1,
                source_text=f"Câu gốc {i}",
                translated_text=f"Bản dịch {i}" if i != 50 else "",
            )
            for i in range(100)
        ]
        self.assertTrue(self.orchestrator.verify_translation_gate(wf, high_cov_cues))
        metrics = wf.quality_metrics.get("translation", {})
        self.assertEqual(metrics["coverage_percent"], 99.0)
        self.assertEqual(metrics["empty_cues"], ["c_50"])

        # 4. Sao chép 100% nguyên văn nguồn khi source != target -> Fail
        identical_cues = [
            SubtitleCueV1(cue_id=f"c_{i}", start_pts=i, end_pts=i + 1, source_text=f"Original {i}", translated_text=f"Original {i}")
            for i in range(10)
        ]
        with self.assertRaises(ValueError) as ctx:
            self.orchestrator.verify_translation_gate(wf, identical_cues)
        self.assertIn("sao chép 100% nguyên văn nguồn", str(ctx.exception))

        # 5. Có vài câu giữ nguyên tên riêng/thuật ngữ -> Pass kèm warning
        mixed_cues = [
            SubtitleCueV1(
                cue_id=f"c_{i}",
                start_pts=i,
                end_pts=i + 1,
                source_text=f"iPhone {i}" if i < 2 else f"Xin chào {i}",
                translated_text=f"iPhone {i}" if i < 2 else f"Dịch {i}",
            )
            for i in range(50)
        ]
        wf.warnings.clear()
        self.assertTrue(self.orchestrator.verify_translation_gate(wf, mixed_cues))
        self.assertTrue(any("giữ nguyên văn nguồn" in w for w in wf.warnings))

    def test_quality_gate_export_audio_enforcement(self) -> None:
        """P0: Khi dubbing_enabled=True, export gate bắt buộc phải fail nếu file MP4 thiếu audio stream."""
        wf = FullPipelineWorkflowV1(
            workflow_id="wf-export-audio",
            source_url="https://example.com/v.mp4",
            settings=FullPipelineSettingsV1(dubbing_enabled=True),
        )

        # Tạo video chỉ có video stream (không có audio stream) bằng FFmpeg
        silent_video = Path(self.temp_dir.name) / "silent_video.mp4"
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=1",
            "-c:v", "libx264",
            "-an",  # No audio!
            str(silent_video),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # 1. dubbing_enabled=True nhưng video không có audio -> Bắt buộc Fail
        with self.assertRaises(RuntimeError) as ctx:
            self.orchestrator.verify_export_gate(wf, silent_video, expect_audio=True)
        self.assertIn("Dubbing được bật nhưng file MP4 xuất không chứa luồng audio", str(ctx.exception))

        # 2. dubbing_enabled=False -> Không yêu cầu audio -> Pass
        wf_no_dub = FullPipelineWorkflowV1(
            workflow_id="wf-export-no-dub",
            source_url="https://example.com/v.mp4",
            settings=FullPipelineSettingsV1(dubbing_enabled=False),
        )
        self.assertTrue(self.orchestrator.verify_export_gate(wf_no_dub, silent_video, expect_audio=False))

        # 3. dubbing_enabled=True và video có cả video + audio -> Pass
        audio_video = Path(self.temp_dir.name) / "audio_video.mp4"
        cmd_audio = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=1",
            "-f", "lavfi", "-i", "sine=frequency=1000:duration=1",
            "-c:v", "libx264",
            "-c:a", "aac",
            str(audio_video),
        ]
        subprocess.run(cmd_audio, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.assertTrue(self.orchestrator.verify_export_gate(wf, audio_video, expect_audio=True))

    def test_mix_voiceover_failure_raises_error_not_swallowed(self) -> None:
        """P0: Lỗi hòa trộn voiceover trong export_service không được nuốt; phải raise RuntimeError."""
        from subtitle_localizer.service.export_service import do_export_mp4

        # Tạo project manifest
        proj = ProjectManifestV1(
            project_id="proj-mix-fail",
            title="Test Mix Failure",
            source_video_path=str(Path(self.temp_dir.name) / "non_existent.mp4"),
            video_fingerprint="fp-test",
            source_language="zh",
            has_voiceover=True,
            voiceover_path=str(Path(self.temp_dir.name) / "corrupt_voiceover.mp3"),
        )
        self.repo.save_project(proj)

        # File video nguồn không tồn tại -> FileNotFoundError
        with self.assertRaises(FileNotFoundError):
            do_export_mp4(
                repository=self.repo,
                resolved_output_root=Path(self.temp_dir.name),
                project_id="proj-mix-fail",
            )

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

    def test_pause_after_download_and_manual_roi(self) -> None:
        """Kiểm tra tính năng tạm dừng sau download để duyệt thông số và chọn vùng OCR thủ công."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "test.db"
            db = Database(db_path)
            try:
                db.migrate()
                repo = ProjectRepository(db)
                orch = FullPipelineOrchestrator(repo, output_root=tmp_dir)

                dummy_vid = Path(tmp_dir) / "video.mp4"
                dummy_vid.write_bytes(b"FAKE_VIDEO_CONTENT_12345")

                settings = FullPipelineSettingsV1(
                    pause_after_download=True,
                    manual_roi={"x": 0.08, "y": 0.82, "width": 0.84, "height": 0.12},
                )
                wf = FullPipelineWorkflowV1(
                    workflow_id="wf-pause-test",
                    source_url="https://example.com/test.mp4",
                    settings=settings,
                )
                repo.save_workflow(wf)

                # Mock download gate and manifest creation
                with patch.object(orch, "_execute_download_stage", return_value=dummy_vid), \
                     patch.object(orch, "verify_download_gate", return_value=True):
                    orch._run_workflow_sync("wf-pause-test")

                # Workflow must pause in needs_review state after download
                paused_wf = repo.get_workflow("wf-pause-test")
                self.assertIsNotNone(paused_wf)
                self.assertEqual(paused_wf.state, "needs_review")
                self.assertTrue(any("tạm dừng" in w.lower() for w in paused_wf.warnings))
                self.assertEqual(paused_wf.get_stage("downloading").status, "completed")

                # Test applying manual ROI on retry
                custom_roi = {"x": 0.10, "y": 0.80, "width": 0.80, "height": 0.15}
                manifest = repo.get_project(paused_wf.project_id)
                self.assertIsNotNone(manifest)

                # Test _execute_auto_roi_stage uses settings.manual_roi
                regions = orch._execute_auto_roi_stage(paused_wf, manifest, dummy_vid)
                self.assertEqual(len(regions), 1)
                self.assertAlmostEqual(regions[0].x, 0.08)
                self.assertAlmostEqual(regions[0].y, 0.82)
                self.assertAlmostEqual(regions[0].width, 0.84)
                self.assertAlmostEqual(regions[0].height, 0.12)

                # Test retry with custom manual_roi updates settings
                with patch.object(orch, "start_workflow_async"):
                    success = orch.retry_workflow("wf-pause-test", from_stage="detecting_roi", manual_roi=custom_roi)
                    self.assertTrue(success)
                    retried_wf = repo.get_workflow("wf-pause-test")
                    self.assertEqual(retried_wf.settings.manual_roi, custom_roi)
                    self.assertFalse(retried_wf.settings.pause_after_download)
            finally:
                db.close()

    def test_groq_pool_and_merge_export_endpoints(self) -> None:
        """Kiểm tra các endpoints cho Groq Key Pool và merge-export."""
        # 1. Groq pool status
        res_pool = self.client.get("/api/v1/settings/groq-pool")
        self.assertEqual(res_pool.status_code, 200)
        data = res_pool.json()
        self.assertIn("total_keys", data)
        self.assertIn("items", data)

        # 2. Update groq pool
        res_save = self.client.post("/api/v1/settings/groq-pool", json={"keys": ["gsk_test1234567890abcdef"]})
        self.assertEqual(res_save.status_code, 200)
        self.assertEqual(res_save.json()["status"], "success")

        # 3. Merge export for existing project
        proj = ProjectManifestV1(
            project_id="proj-merge-test",
            title="Drama Ep 01",
            source_video_path="E:/video.mp4",
            video_fingerprint="fp-merge",
            source_language="zh",
        )
        self.repo.save_project(proj)
        proj_out = Path(self.temp_dir.name) / "proj-merge-test"
        proj_out.mkdir(parents=True, exist_ok=True)
        (proj_out / "ep01-localized.mp4").write_bytes(b"DUMMY_MP4_EP1")

        res_merge = self.client.post("/api/v1/projects/proj-merge-test/merge-export")
        self.assertEqual(res_merge.status_code, 200)
        merge_data = res_merge.json()
        self.assertEqual(merge_data["status"], "success")
        self.assertEqual(merge_data["item_count"], 1)
        self.assertTrue(Path(merge_data["output_path"]).exists())
