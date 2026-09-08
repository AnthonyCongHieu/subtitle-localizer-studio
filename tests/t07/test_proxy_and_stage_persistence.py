import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, AsyncMock, MagicMock

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1, StageRunV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.server import create_app


class ProxyAndStagePersistenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.temp_dir.name) / "test_proxy.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.output_root = Path(self.temp_dir.name) / "outputs"
        self.app = create_app(
            database=self.db,
            repo=self.repo,
            auth_token="test-token-proxy",
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

    def test_video_proxy_endpoint(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)

        # Create dummy video file
        dummy_video = Path(self.temp_dir.name) / "source_video.mp4"
        dummy_video.write_bytes(b"FAKE_MP4_CONTENT_" * 100)

        proj_id = "proj-proxy-test-1"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="Proxy Stream Test",
            source_video_path=str(dummy_video),
            video_fingerprint="fp-proxy",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(proj)

        # 1. Original stream request
        res = client.get(f"/api/v1/projects/{proj_id}/video/stream?quality=original")
        self.assertEqual(res.status_code, 200)
        self.assertIn("video/mp4", res.headers.get("content-type", ""))

        # 2. Proxy request with existing cached proxy file
        proxy_dir = self.output_root / proj_id / "proxies"
        proxy_dir.mkdir(parents=True, exist_ok=True)
        cached_720p = proxy_dir / "proxy_720p.mp4"
        cached_720p.write_bytes(b"CACHED_720P_PROXY_" * 100)

        res_proxy = client.get(f"/api/v1/projects/{proj_id}/video/stream?quality=720p")
        self.assertEqual(res_proxy.status_code, 200)
        self.assertIn("video/mp4", res_proxy.headers.get("content-type", ""))
        self.assertEqual(res_proxy.content, cached_720p.read_bytes())

    def test_retranslate_saves_stages(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-proxy"}

        proj_id = "proj-trans-stage-1"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="Translation Stage Test",
            source_video_path="E:/dummy.mp4",
            video_fingerprint="fp-trans",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(proj)
        self.repo.save_cues(
            proj_id,
            [
                SubtitleCueV1(cue_id="c1", start_pts=1.0, end_pts=3.0, source_text="你好", translated_text=""),
            ]
        )

        res = client.post(f"/api/v1/projects/{proj_id}/retranslate", headers=headers)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "success")

        # Verify StageRun was saved to SQLite database
        stages = self.repo.get_stage_runs(proj_id)
        trans_stages = [s for s in stages if s.stage_name == "translation"]
        self.assertTrue(len(trans_stages) >= 1)
        latest_trans = trans_stages[-1]
        self.assertEqual(latest_trans.status, "completed")
        self.assertEqual(latest_trans.progress, 1.0)
        self.assertIn("câu", latest_trans.metrics.get("label", ""))

    @patch("subtitle_localizer.dubbing.tts.generate_timed_voiceover", new_callable=AsyncMock)
    def test_dubbing_saves_stages_and_progress(self, mock_gen) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-proxy"}

        proj_id = "proj-dub-stage-1"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="Dubbing Stage Test",
            source_video_path="E:/dummy.mp4",
            video_fingerprint="fp-dub",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(proj)
        self.repo.save_cues(
            proj_id,
            [
                SubtitleCueV1(cue_id="c1", start_pts=1.0, end_pts=3.0, source_text="你好", translated_text="Xin chào"),
            ]
        )

        async def fake_generate(**kwargs):
            cb = kwargs.get("progress_callback")
            if cb:
                cb(1, 1, "Xin chào")
            out = Path(kwargs.get("output_path"))
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(b"RIFF_FAKE_AUDIO")
            return out

        mock_gen.side_effect = fake_generate

        res = client.post(
            f"/api/v1/projects/{proj_id}/dubbing/run",
            json={"mode": "single", "voice": "vi-VN-NamMinhNeural"},
            headers=headers,
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["status"], "completed")

        # Verify stages were recorded in SQLite
        stages = self.repo.get_stage_runs(proj_id)
        dub_stages = [s for s in stages if s.stage_name == "dubbing"]
        self.assertTrue(len(dub_stages) >= 2)  # running + completed (and optionally progress)
        self.assertEqual(dub_stages[-1].status, "completed")
        self.assertEqual(dub_stages[-1].progress, 1.0)
