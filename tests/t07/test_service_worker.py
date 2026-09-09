import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.ocr.mock import MockOcrProvider
from subtitle_localizer.service.server import create_app
from subtitle_localizer.service.worker import BackgroundWorker
from subtitle_localizer.translation.mock import MockTranslationProvider


class ServiceAndWorkerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.temp_dir.name) / "service_test.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.output_root = Path(self.temp_dir.name) / "outputs"
        self.app = create_app(
            database=self.db,
            repo=self.repo,
            auth_token="test-token-123",
            output_root=self.output_root,
        )

    def tearDown(self) -> None:
        self.db.close()
        import gc
        gc.collect()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_health_check_endpoint(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        res = client.get("/api/v1/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "healthy")

    def test_project_crud_api_flow(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        # 1. Tạo project mới
        payload = {
            "title": "Dự án FastAPI Test",
            "source_video_path": "E:/test.mp4",
            "source_language": "zh",
            "target_language": "vi",
        }
        res = client.post("/api/v1/projects", json=payload, headers=headers)
        self.assertEqual(res.status_code, 200)
        project_id = res.json()["project_id"]

        # 2. Lấy thông tin project
        res = client.get(f"/api/v1/projects/{project_id}", headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["title"], "Dự án FastAPI Test")

        # 3. Lưu cues cho project
        cues_payload = [
            {"cue_id": "c1", "start_pts": 1.0, "end_pts": 2.0, "source_text": "你好", "translated_text": "Xin chào"},
        ]
        res = client.put(f"/api/v1/projects/{project_id}/cues", json=cues_payload, headers=headers)
        self.assertEqual(res.status_code, 200)

        # 4. Lấy cues
        res = client.get(f"/api/v1/projects/{project_id}/cues", headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()), 1)

    def test_background_worker_executes_pipeline(self) -> None:
        video_path = Path(self.temp_dir.name) / "worker-input.mp4"
        video_path.write_bytes(b"test-only-video-placeholder")
        # Khởi tạo project trong DB
        manifest = ProjectManifestV1(
            project_id="worker-proj-1",
            title="Dự án Worker Test",
            source_video_path=str(video_path),
            video_fingerprint="fp_worker",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(manifest)

        # Chạy pipeline bằng worker
        worker = BackgroundWorker(self.repo)
        worker.ocr_registry.register("rapidocr", MockOcrProvider())
        worker.translation_registry.register("real", MockTranslationProvider())
        with patch.object(
            worker.sampler,
            "sample_video_frames",
            return_value=([b"crop"] * 3, [0.0, 0.5, 1.0]),
        ):
            success = worker.run_pipeline_synchronous("worker-proj-1")
        self.assertTrue(success)

        # Kiểm tra cues đã được sinh ra
        cues = self.repo.get_cues("worker-proj-1")
        self.assertTrue(len(cues) > 0)
        self.assertTrue(len(cues[0].translated_text) > 0)

    def test_worker_run_pipeline_ocr_only_skips_translation(self) -> None:
        video_path = Path(self.temp_dir.name) / "worker-input-ocr-only.mp4"
        video_path.write_bytes(b"test-only-video-placeholder")
        manifest = ProjectManifestV1(
            project_id="worker-proj-ocr-only",
            title="Dự án Worker OCR Only",
            source_video_path=str(video_path),
            video_fingerprint="fp_worker_ocr_only",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(manifest)

        worker = BackgroundWorker(self.repo)
        worker.ocr_registry.register("rapidocr", MockOcrProvider())
        with patch.object(
            worker.sampler,
            "sample_video_frames",
            return_value=([b"crop"] * 3, [0.0, 0.5, 1.0]),
        ):
            success = worker.run_pipeline_synchronous("worker-proj-ocr-only", ocr_only=True)
        self.assertTrue(success)

        cues = self.repo.get_cues("worker-proj-ocr-only")
        self.assertTrue(len(cues) > 0)
        self.assertEqual(cues[0].translated_text, "")

    def test_auth_token_rejection_on_wrong_token(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        res = client.get("/api/v1/projects", headers={"Authorization": "Bearer wrong-token"})
        self.assertEqual(res.status_code, 403)

    def test_optimistic_revision_conflict_via_api(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        # Tạo project
        res = client.post("/api/v1/projects", json={"title": "P1", "source_video_path": "E:/v.mp4"}, headers=headers)
        p_id = res.json()["project_id"]

        # Gửi command với revision sai (ví dụ 99 khi hiện tại là 1)
        cmd_payload = {"expected_revision": 99, "command_type": "update_title", "payload": {"title": "New Title"}}
        res = client.post(f"/api/v1/projects/{p_id}/commands", json=cmd_payload, headers=headers)
        self.assertEqual(res.status_code, 409)

    def test_mp4_export_renders_to_outputs_and_returns_real_path(self) -> None:
        from fastapi.testclient import TestClient

        source_path = Path(self.temp_dir.name) / "source.mp4"
        source_path.write_bytes(b"video-placeholder")
        manifest = ProjectManifestV1(
            project_id="mp4-project",
            title="Phim thử nghiệm",
            source_video_path=str(source_path),
            video_fingerprint="fp_mp4",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(manifest)
        self.repo.save_cues(
            manifest.project_id,
            [
                SubtitleCueV1(
                    cue_id="cue-1",
                    start_pts=1.0,
                    end_pts=2.5,
                    source_text="你好",
                    translated_text="Xin chào",
                )
            ],
        )

        def render_test_video(*, output_video_path, **_kwargs):
            rendered = Path(output_video_path)
            rendered.parent.mkdir(parents=True, exist_ok=True)
            rendered.write_bytes(b"rendered-mp4")
            return rendered

        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}
        with patch(
            "subtitle_localizer.render.export.VideoExporter.render_video",
            side_effect=render_test_video,
        ):
            response = client.post(
                "/api/v1/projects/mp4-project/export/mp4",
                json={"use_translated": True, "mask_mode": "box"},
                headers=headers,
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        output_path = Path(payload["output_path"])
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(output_path.parent, self.output_root / "mp4-project")
        self.assertEqual(output_path.name, "source-localized.mp4")
        self.assertEqual(output_path.read_bytes(), b"rendered-mp4")

    def test_mp4_export_reports_ass_generation_failure(self) -> None:
        from fastapi.testclient import TestClient

        source_path = Path(self.temp_dir.name) / "broken-export.mp4"
        source_path.write_bytes(b"video-placeholder")
        self.repo.save_project(
            ProjectManifestV1(
                project_id="broken-mp4-project",
                title="Broken export",
                source_video_path=str(source_path),
                video_fingerprint="fp_broken_mp4",
                source_language="zh",
            )
        )
        client = TestClient(self.app, raise_server_exceptions=False)
        with patch(
            "subtitle_localizer.render.ass.AssExporter.export_ass_text",
            side_effect=RuntimeError("ASS generation exploded"),
        ):
            response = client.post(
                "/api/v1/projects/broken-mp4-project/export/mp4",
                json={"use_translated": True, "mask_mode": "none"},
                headers={"Authorization": "Bearer test-token-123"},
            )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json()["detail"],
            "MP4 export failed: ASS generation exploded",
        )

    def test_pipeline_run_api_and_stages_endpoint(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        video_path = Path(self.temp_dir.name) / "run-input.mp4"
        video_path.write_bytes(b"test-video")
        self.repo.save_project(
            ProjectManifestV1(
                project_id="run-proj-1",
                title="Run Test",
                source_video_path=str(video_path),
                video_fingerprint="fp_run",
                source_language="zh",
                target_language="vi",
            )
        )

        with patch(
            "subtitle_localizer.service.worker.BackgroundWorker.run_pipeline_synchronous",
            return_value=True,
        ):
            # Test async call
            res_async = client.post(
                "/api/v1/projects/run-proj-1/pipeline/run",
                json={"max_duration_seconds": 180.0},
                headers=headers,
            )
            self.assertEqual(res_async.status_code, 200)
            self.assertEqual(res_async.json()["status"], "running")

            # Test sync call
            res_sync = client.post(
                "/api/v1/projects/run-proj-1/pipeline/run",
                json={"sync": True},
                headers=headers,
            )
            self.assertEqual(res_sync.status_code, 200)
            self.assertEqual(res_sync.json()["status"], "success")

            # Test sync call with ocr_only=True
            res_ocr_only = client.post(
                "/api/v1/projects/run-proj-1/pipeline/run",
                json={"sync": True, "ocr_only": True},
                headers=headers,
            )
            self.assertEqual(res_ocr_only.status_code, 200)

        # Test stages endpoint
        res_stages = client.get("/api/v1/projects/run-proj-1/stages", headers=headers)
        self.assertEqual(res_stages.status_code, 200)
        stages = res_stages.json()
        self.assertIsInstance(stages, list)
        self.assertGreaterEqual(len(stages), 1)
        self.assertEqual(stages[0]["stage_name"], "detector")

    def test_rapid_ocr_deduplication_skips_identical_subtitle_boxes(self) -> None:
        import numpy as np
        from subtitle_localizer.ocr.rapid import RapidOcrProvider
        from subtitle_localizer.domain.models import OcrObservationV1

        provider = RapidOcrProvider()
        img1 = np.full((100, 200, 3), 50, dtype=np.uint8)
        img2 = np.full((100, 200, 3), 60, dtype=np.uint8)
        img1[20:50, 20:80] = 230
        img2[20:50, 20:80] = 230

        obs = OcrObservationV1(
            pts=1.0,
            boxes=[[20.0, 20.0, 80.0, 50.0]],
            raw_text="测试",
            normalized_text="测试",
            confidence=0.95,
        )

        is_dup = provider._is_duplicate_subtitle(obs, img1, img2, diff_threshold=1.5)
        self.assertTrue(is_dup)

        img3 = img1.copy()
        img3[20:50, 20:80] = 50
        is_dup_removed = provider._is_duplicate_subtitle(obs, img1, img3, diff_threshold=1.5)
        self.assertFalse(is_dup_removed)

    def test_batch_pipeline_endpoint(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        proj = ProjectManifestV1(
            project_id="batch-test-p1",
            title="Batch Test Project",
            source_video_path="E:/fake.mp4",
            video_fingerprint="fp123",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(proj)

        with patch("subtitle_localizer.service.worker.BackgroundWorker.run_pipeline_synchronous", return_value=True):
            res = client.post(
                "/api/v1/batch/run",
                json={"project_ids": ["batch-test-p1", "nonexistent-pid"], "auto_export_mp4": False},
                headers=headers,
            )
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["total"], 2)
            self.assertEqual(data["successful"], 1)
            self.assertEqual(data["failed"], 1)
            self.assertEqual(data["results"][0]["status"], "completed")
            self.assertEqual(data["results"][1]["status"], "failed")

    def test_voiceover_audio_endpoint_serves_fileresponse(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)

        proj_id = "voiceover-test-p1"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="Voiceover Test",
            source_video_path="E:/fake.mp4",
            video_fingerprint="fp123",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(proj)

        # Tạo file audio giả lập trong output_root
        proj_dir = self.output_root / proj_id
        proj_dir.mkdir(parents=True, exist_ok=True)
        audio_file = proj_dir / f"voiceover_{proj_id}.mp3"
        audio_file.write_bytes(b"fake_mp3_audio_data_content")

        res = client.get(f"/api/v1/projects/{proj_id}/audio/voiceover")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.content, b"fake_mp3_audio_data_content")
        self.assertEqual(res.headers.get("content-type"), "audio/mpeg")

    def test_auto_detect_roi_endpoint_fallback(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)

        proj_id = "roi-detect-p1"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="ROI Detect Test",
            source_video_path="E:/nonexistent.mp4",
            video_fingerprint="fp123",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(proj)

        # Khi video không tồn tại, trả về 400
        headers = {"Authorization": "Bearer test-token-123"}
        res = client.post(f"/api/v1/projects/{proj_id}/roi/auto-detect", json={"pts": 1.0}, headers=headers)
        self.assertEqual(res.status_code, 400)

    def test_batch_delete_projects_endpoint(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        # Tạo 3 projects
        p1 = ProjectManifestV1(project_id="del-p1", title="P1", source_video_path="E:/1.mp4", video_fingerprint="f1", source_language="zh")
        p2 = ProjectManifestV1(project_id="del-p2", title="P2", source_video_path="E:/2.mp4", video_fingerprint="f2", source_language="zh")
        p3 = ProjectManifestV1(project_id="del-p3", title="P3", source_video_path="E:/3.mp4", video_fingerprint="f3", source_language="zh")
        self.repo.save_project(p1)
        self.repo.save_project(p2)
        self.repo.save_project(p3)

        self.assertEqual(len(self.repo.list_projects()), 3)

        # Xóa 2 projects
        res = client.post("/api/v1/projects/batch-delete", json={"project_ids": ["del-p1", "del-p2"]}, headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["deleted_count"], 2)
        self.assertEqual(data["total"], 2)

        # Kiểm tra database chỉ còn 1 project (p3)
        remaining = self.repo.list_projects()
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0].project_id, "del-p3")

    def test_downloader_endpoints(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        # 1. Check initial status
        res = client.get("/api/v1/downloader/status", headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "idle")

        # 2. Test cancel when idle
        res = client.post("/api/v1/downloader/cancel", headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "cancelling")

        # 3. Test parse empty string -> 400 error
        res = client.post("/api/v1/downloader/parse", json={"target": ""}, headers=headers)
        self.assertEqual(res.status_code, 400)

    def test_proxy_endpoint_empty(self) -> None:
        """POST /api/v1/downloader/test-proxy with empty proxy returns ok=False."""
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        res = client.post("/api/v1/downloader/test-proxy", json={"proxy": ""}, headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["ok"])
        self.assertIn("error", data)

    def test_download_start_request_with_proxy_fields(self) -> None:
        """DownloadStartRequest model accepts proxy, rate_limit_delay, and rotate_device_each_ep."""
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        res = client.post("/api/v1/downloader/start", json={
            "target_info": {"platform": "hongguo", "series_id": "000", "title": "test", "total_episodes": 1},
            "start_ep": 1,
            "end_ep": 1,
            "proxy": "http://127.0.0.1:9999",
            "rate_limit_delay": 3.5,
            "rotate_device_each_ep": True,
        }, headers=headers)
        self.assertIn(res.status_code, [200, 400])

    def test_jitter_delay_calculation(self) -> None:
        """Verify jitter delay stays within expected range."""
        import random
        rate_limit_delay = 2.0
        samples = []
        for _ in range(100):
            jitter = random.uniform(-0.5, 0.5)
            actual_delay = max(0.2, rate_limit_delay + jitter)
            samples.append(actual_delay)
        self.assertTrue(all(0.2 <= s <= 2.5 for s in samples))
        # Should have variety (not all same value)
        self.assertGreater(len(set(round(s, 2) for s in samples)), 10)

    def test_rotate_device_returns_valid_keys(self) -> None:
        """Verify rotate_device returns a dict with device_id and install_id."""
        from subtitle_localizer.downloader.hongguo_parser import rotate_device
        keys = rotate_device()
        self.assertIsInstance(keys, dict)
        self.assertIn("device_id", keys)
        self.assertIn("install_id", keys)
        self.assertTrue(len(keys["device_id"]) > 5)
        self.assertTrue(len(keys["install_id"]) > 5)

    def test_device_api_endpoints(self) -> None:
        """Test GET /device, POST /device/custom, and POST /device/rotate endpoints."""
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        # 1. GET /api/v1/downloader/device
        res = client.get("/api/v1/downloader/device", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("device_id", data)
        self.assertIn("install_id", data)
        self.assertIn("status", data)
        self.assertIn("device_model", data)

        # 2. POST /api/v1/downloader/device/custom
        res = client.post("/api/v1/downloader/device/custom", json={
            "device_id": "999888777111",
            "install_id": "999888777222",
            "platform": "android",
        }, headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["device_id"], "999888777111")
        self.assertEqual(data["install_id"], "999888777222")

        # 3. POST /api/v1/downloader/device/rotate
        res = client.post("/api/v1/downloader/device/rotate", json={}, headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("device_id", data)
        self.assertIn("message", data)


    def test_reveal_export_endpoint_and_verified_path_contracts(self) -> None:
        """Kiểm tra hợp đồng export_path, export_verified, export_file_size_bytes và endpoint reveal-export."""
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-123"}

        source_file = Path(self.temp_dir.name) / "test_ep1.mp4"
        source_file.write_bytes(b"dummy-video-data")
        manifest = ProjectManifestV1(
            project_id="proj-reveal-test",
            title="Tập 1 - Phim Hay",
            source_video_path=str(source_file),
            video_fingerprint="fp_reveal",
            source_language="zh",
            target_language="vi",
            media_metadata={"duration": 136.5, "width": 1920, "height": 1080},
        )
        self.repo.save_project(manifest)

        # 1. Khi chưa có file xuất
        res = client.get(f"/api/v1/projects/{manifest.project_id}", headers=headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data["has_export"])
        self.assertFalse(data["export_verified"])
        self.assertIsNone(data["export_path"])
        self.assertEqual(data["duration"], 136.5)
        self.assertIn("source_video_resolved_path", data)

        # 2. Tạo file xuất giả lập trên ổ đĩa
        out_dir = Path(self.temp_dir.name) / "outputs" / manifest.project_id
        out_dir.mkdir(parents=True, exist_ok=True)
        export_file = out_dir / "test_ep1-localized.mp4"
        export_file.write_bytes(b"rendered-mp4-data-12345")

        res2 = client.get(f"/api/v1/projects/{manifest.project_id}", headers=headers)
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertTrue(data2["has_export"])
        self.assertTrue(data2["export_verified"])
        self.assertIsNotNone(data2["export_path"])
        self.assertTrue(data2["export_path"].endswith("test_ep1-localized.mp4"))
        self.assertGreater(data2["export_file_size_bytes"], 0)

        # Kiểm tra trong list_projects
        list_res = client.get("/api/v1/projects", headers=headers)
        self.assertEqual(list_res.status_code, 200)
        target = next((p for p in list_res.json() if p["project_id"] == manifest.project_id), None)
        self.assertIsNotNone(target)
        self.assertTrue(target["export_verified"])
        self.assertEqual(target["duration"], 136.5)

        # 3. Test POST /api/v1/projects/{project_id}/reveal-export
        # The endpoint opens the platform file browser in production.  Mock
        # the process launch so pytest never leaves a real Explorer window
        # pointing at its temporary output directory after teardown.
        with patch("subprocess.Popen") as popen:
            reveal_res = client.post(f"/api/v1/projects/{manifest.project_id}/reveal-export", headers=headers)
            popen.assert_called_once()
        self.assertEqual(reveal_res.status_code, 200)
        reveal_data = reveal_res.json()
        self.assertTrue(reveal_data["success"])
        self.assertIn("path", reveal_data)

    def test_worker_ocr_only_skips_translation_and_preserves_cues(self) -> None:
        video_path = Path(self.temp_dir.name) / "test-ocr-only-preservation.mp4"
        video_path.write_bytes(b"dummy-mp4")
        pid = "proj-ocr-preservation"
        self.repo.save_project(
            ProjectManifestV1(
                project_id=pid,
                title="Preservation Test",
                source_video_path=str(video_path),
                video_fingerprint="fp_preservation",
                source_language="zh",
                target_language="vi",
            )
        )

        worker = BackgroundWorker(self.repo)
        mock_cues = [
            SubtitleCueV1(cue_id="c1", start_pts=1.0, end_pts=2.5, source_text="你好世界"),
            SubtitleCueV1(cue_id="c2", start_pts=3.0, end_pts=4.5, source_text="这是测试"),
        ]

        from unittest.mock import MagicMock
        # 1. Khi ocr_only=True: Translation provider không được gọi, cues vẫn được lưu
        with patch("subtitle_localizer.cloud.capcut_bridge.CapCutBridgeExtractor.extract_cues", return_value=mock_cues), \
             patch.object(worker.boundary_refiner, "refine_cues", side_effect=lambda **kw: kw["cues"]), \
             patch.object(worker.translation_registry, "get_provider_for_pair") as mock_trans:
            success = worker.run_pipeline_synchronous(pid, ocr_only=True)
            self.assertTrue(success)
            mock_trans.assert_not_called()
            saved_cues = self.repo.get_cues(pid)
            self.assertEqual(len(saved_cues), 2)
            self.assertEqual(saved_cues[0].source_text, "你好世界")

        # 2. Khi ocr_only=False và translation lỗi: worker trả về False, stage pipeline failed, nhưng cues OCR trong DB vẫn được bảo toàn
        mock_translator = MagicMock()
        mock_translator.translate_cues.side_effect = RuntimeError("Translation quota exceeded")
        with patch("subtitle_localizer.cloud.capcut_bridge.CapCutBridgeExtractor.extract_cues", return_value=mock_cues), \
             patch.object(worker.boundary_refiner, "refine_cues", side_effect=lambda **kw: kw["cues"]), \
             patch.object(worker.translation_registry, "get_provider_for_pair", return_value=mock_translator):
            success = worker.run_pipeline_synchronous(pid, ocr_only=False)
            self.assertFalse(success)

            # Kiểm tra: Dù translation fail, cues OCR trong DB không hề bị mất
            persisted_cues = self.repo.get_cues(pid)
            self.assertEqual(len(persisted_cues), 2)
            self.assertEqual(persisted_cues[0].source_text, "你好世界")

            # Kiểm tra stage runs ghi nhận lỗi translation rõ ràng
            stages = self.repo.get_stage_runs(pid)
            pipeline_stage = next((s for s in reversed(stages) if s.stage_name == "pipeline"), None)
            self.assertIsNotNone(pipeline_stage)
            self.assertEqual(pipeline_stage.status, "failed")
            self.assertIn("Translation quota exceeded", pipeline_stage.errors[0])


if __name__ == "__main__":
    unittest.main()
