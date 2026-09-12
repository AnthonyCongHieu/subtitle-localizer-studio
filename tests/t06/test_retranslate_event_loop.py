"""Regression: /retranslate must not block the server event loop.

The translation provider is a blocking HTTP client. Running it inline inside an
``async def`` endpoint froze the whole Studio (UI polling, cancel, progress) and
left stage rows stuck in ``running`` forever.
"""

import asyncio
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1


class RetranslateEventLoopTest(unittest.TestCase):
    def setUp(self) -> None:
        from subtitle_localizer.persistence.database import Database
        from subtitle_localizer.persistence.repository import ProjectRepository
        from subtitle_localizer.service.server import create_app
        from subtitle_localizer.service.worker import BackgroundWorker

        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db = Database(Path(self.temp_dir.name) / "retranslate-async.db")
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        worker = BackgroundWorker(self.repo)

        translator = MagicMock()
        translator.load.return_value = None
        translator.unload.return_value = None

        def slow_translate(cues, source_lang="zh", target_lang="vi"):
            time.sleep(1.5)
            for cue in cues:
                cue.translated_text = "Bản dịch"
            return cues

        translator.translate_cues.side_effect = slow_translate
        worker.translation_registry.get_provider_for_pair = MagicMock(return_value=translator)

        self.app = create_app(
            database=self.db,
            repo=self.repo,
            auth_token="test-token-async",
            output_root=Path(self.temp_dir.name) / "outputs",
            worker=worker,
        )
        self.project_id = "proj-retranslate-async"
        self.repo.save_project(
            ProjectManifestV1(
                project_id=self.project_id,
                title="Retranslate async",
                source_video_path="E:/dummy.mp4",
                video_fingerprint="fp-async",
                source_language="zh",
                target_language="vi",
            )
        )
        self.repo.save_cues(
            self.project_id,
            [SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="你好")],
        )

    def tearDown(self) -> None:
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_slow_retranslate_keeps_server_responsive(self) -> None:
        import httpx

        headers = {"Authorization": "Bearer test-token-async"}

        async def scenario() -> tuple[int, int, float]:
            transport = httpx.ASGITransport(app=self.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://studio") as client:
                started = time.perf_counter()
                slow = asyncio.create_task(
                    client.post(f"/api/v1/projects/{self.project_id}/retranslate", headers=headers)
                )
                # Let the endpoint reach the (blocking) translation call.
                await asyncio.sleep(0.1)
                fast = await client.get("/api/v1/settings/gemini-pool", headers=headers)
                fast_elapsed = time.perf_counter() - started
                slow_response = await slow
                return slow_response.status_code, fast.status_code, fast_elapsed

        slow_status, fast_status, fast_elapsed = asyncio.run(scenario())

        self.assertEqual(slow_status, 200)
        self.assertEqual(fast_status, 200)
        # An inline blocking call holds the loop for the whole 1.5s translation,
        # so any concurrent request can only finish after it.
        self.assertLess(fast_elapsed, 1.0, f"event loop bị chặn {fast_elapsed:.2f}s")

    def test_stage_row_is_not_left_running(self) -> None:
        import httpx

        headers = {"Authorization": "Bearer test-token-async"}

        async def scenario() -> int:
            transport = httpx.ASGITransport(app=self.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://studio") as client:
                response = await client.post(
                    f"/api/v1/projects/{self.project_id}/retranslate", headers=headers
                )
                return response.status_code

        self.assertEqual(asyncio.run(scenario()), 200)
        stages = [
            stage
            for stage in self.repo.get_stage_runs(self.project_id)
            if stage.stage_name == "translation"
        ]
        self.assertTrue(stages)
        self.assertEqual(stages[-1].status, "completed")


if __name__ == "__main__":
    unittest.main()
