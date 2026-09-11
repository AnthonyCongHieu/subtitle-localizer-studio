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

    def test_clean_translation_and_voice_keep_source_cues(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-proxy"}
        proj_id = "proj-clean-artifacts"
        proj = ProjectManifestV1(
            project_id=proj_id,
            title="Clean artifacts",
            source_video_path="E:/dummy.mp4",
            video_fingerprint="fp-clean",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(proj)
        self.repo.save_cues(proj_id, [SubtitleCueV1(
            cue_id="c1", start_pts=0.0, end_pts=1.0,
            source_text="你好", translated_text="Xin chào",
            style={"spoken_text": "Xin chào", "speaker": "female"},
        )])
        out_dir = self.output_root / proj_id
        (out_dir / "cues").mkdir(parents=True)
        (out_dir / f"voiceover_{proj_id}.mp3").write_bytes(b"master")
        (out_dir / "cues" / "c1.mp3").write_bytes(b"cue")
        (out_dir / "keep.txt").write_text("keep", encoding="utf-8")

        cleaned = client.post(f"/api/v1/projects/{proj_id}/translation/clean", headers=headers)
        self.assertEqual(cleaned.status_code, 200, cleaned.text)
        cue = self.repo.get_cues(proj_id)[0]
        self.assertEqual(cue.source_text, "你好")
        self.assertEqual(cue.translated_text, "")
        self.assertNotIn("spoken_text", cue.style)
        self.assertFalse((out_dir / f"voiceover_{proj_id}.mp3").exists())
        self.assertFalse((out_dir / "cues" / "c1.mp3").exists())
        self.assertTrue((out_dir / "keep.txt").exists())
        project_view = client.get(f"/api/v1/projects/{proj_id}", headers=headers).json()
        self.assertEqual(project_view["translated_count"], 0)
        self.assertFalse(project_view["has_voiceover"])

        # Voice clean is idempotent and must not touch source/translation fields.
        self.repo.save_cues(proj_id, [SubtitleCueV1(
            cue_id="c1", start_pts=0.0, end_pts=1.0,
            source_text="你好", translated_text="Xin chào",
        )])
        cleaned_voice = client.post(f"/api/v1/projects/{proj_id}/dubbing/clean", headers=headers)
        self.assertEqual(cleaned_voice.status_code, 200, cleaned_voice.text)
        cue_after_voice = self.repo.get_cues(proj_id)[0]
        self.assertEqual(cue_after_voice.translated_text, "Xin chào")

    def test_clean_single_cue_translation_and_voice(self) -> None:
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        headers = {"Authorization": "Bearer test-token-proxy"}
        project_id = "proj-clean-one-cue"
        self.repo.save_project(ProjectManifestV1(
            project_id=project_id, title="Clean one", source_video_path="E:/dummy.mp4",
            video_fingerprint="fp-clean-one", source_language="zh", target_language="vi",
        ))
        self.repo.save_cues(project_id, [
            SubtitleCueV1(cue_id="c1", start_pts=0, end_pts=1, source_text="你好", translated_text="Xin chào", style={"spoken_text": "Xin chào"}),
            SubtitleCueV1(cue_id="c2", start_pts=1, end_pts=2, source_text="再见", translated_text="Tạm biệt"),
        ])
        cue_dir = self.output_root / project_id / "cues"
        cue_dir.mkdir(parents=True)
        (cue_dir / "c1.mp3").write_bytes(b"cue1")
        (cue_dir / "c2.mp3").write_bytes(b"cue2")
        master = self.output_root / project_id / f"voiceover_{project_id}.mp3"
        master.write_bytes(b"master")

        res = client.post(f"/api/v1/projects/{project_id}/cues/c1/translation/clean", headers=headers)
        self.assertEqual(res.status_code, 200, res.text)
        cues = self.repo.get_cues(project_id)
        self.assertEqual(cues[0].translated_text, "")
        self.assertNotIn("spoken_text", cues[0].style)
        self.assertEqual(cues[1].translated_text, "Tạm biệt")

        res_voice = client.post(f"/api/v1/projects/{project_id}/cues/c1/dubbing/clean", headers=headers)
        self.assertEqual(res_voice.status_code, 200, res_voice.text)
        self.assertFalse((cue_dir / "c1.mp3").exists())
        self.assertTrue((cue_dir / "c2.mp3").exists())
        self.assertFalse(master.exists())

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

        with patch("subtitle_localizer.dubbing.tts.is_valid_speech_audio", return_value=True):
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
