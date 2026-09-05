import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from fastapi.testclient import TestClient

from subtitle_localizer.service.downloader import DownloadManager, DownloadTask
from subtitle_localizer.service.server import create_app
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository


class TestMultithreadedDownloader(unittest.TestCase):
    """Test suite for concurrent multi-threaded episode downloading."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.temp_path = Path(self.temp_dir.name)
        self.db = Database(self.temp_path / "test_mt.db")
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.uploads_dir = self.temp_path / "uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.output_root = self.temp_path / "outputs"
        self.output_root.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_download_task_concurrency_serialization(self) -> None:
        """Verify concurrency parameter initializes properly and serializes in to_dict()."""
        task = DownloadTask(
            task_id="task_mt_01",
            target_info={"title": "Multi Thread Drama", "series_id": "12345"},
            concurrency=5,
        )
        self.assertEqual(task.concurrency, 5)
        d = task.to_dict()
        self.assertEqual(d.get("concurrency"), 5)

    @patch("subtitle_localizer.service.downloader.parser.resolve_video_url")
    def test_concurrent_episode_download_speedup(self, mock_resolve) -> None:
        """Verify 4 episodes downloaded with concurrency=4 finish concurrently and create all output files."""
        # Setup mock behavior simulating network delay per episode
        def fake_resolve(vid, proxy=None, device_keys=None, **kwargs):
            # Create a mock mp4 file
            fake_file = self.uploads_dir / f"mock_{vid}.mp4"
            fake_file.write_bytes(b"DATA" * 30000)
            time.sleep(0.1)  # small simulated latency
            return {"url": f"http://fake.local/src/mock_{vid}.mp4"}

        mock_resolve.side_effect = fake_resolve

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)

        target = {
            "platform": "hongguo",
            "series_id": "series_mt_02",
            "title": "Drama Concurrency Test",
            "total_episodes": 4,
            "vid_list": ["vid_1", "vid_2", "vid_3", "vid_4"],
        }

        task = manager.add_to_queue(
            target_info=target,
            episodes=[1, 2, 3, 4],
            concurrency=4,
            auto_create_project=False,
        )

        start_wait = time.time()
        completed = False
        while time.time() - start_wait < 10.0:
            q_info = manager.get_queue()
            t = next((x for x in q_info.get("tasks", []) if x["task_id"] == task.task_id), None)
            if t and t["status"] == "completed":
                completed = True
                break
            time.sleep(0.2)

        self.assertTrue(completed, "Multi-threaded task failed to complete within timeout.")

        # Verify all 4 episode files exist
        series_dir = self.uploads_dir / "Drama Concurrency Test"
        for ep in [1, 2, 3, 4]:
            ep_file = series_dir / f"Drama Concurrency Test_Tap_{ep:02d}.mp4"
            self.assertTrue(ep_file.exists(), f"Episode file missing: {ep_file}")

    def test_api_queue_add_with_concurrency(self) -> None:
        """Verify API accepts concurrency in request and reflects in queue task item."""
        app = create_app(
            database=self.db,
            repo=self.repo,
            auth_token="test-token",
            output_root=self.output_root,
        )
        client = TestClient(app)
        headers = {"Authorization": "Bearer test-token"}

        target = {
            "platform": "hongguo",
            "series_id": "series_mt_api",
            "title": "API Concurrency Test",
            "total_episodes": 10,
            "vid_list": [f"vid_{i}" for i in range(1, 11)],
        }

        res = client.post(
            "/api/v1/downloader/queue/add",
            headers=headers,
            json={
                "target_info": target,
                "episodes": [1, 2, 3],
                "concurrency": 5,
            },
        )
        self.assertEqual(res.status_code, 200)
        task_id = res.json()["task_id"]

        list_res = client.get("/api/v1/downloader/queue/list", headers=headers)
        self.assertEqual(list_res.status_code, 200)
        tasks = list_res.json()["tasks"]
        matched = next((t for t in tasks if t["task_id"] == task_id), None)
        self.assertIsNotNone(matched)
        self.assertEqual(matched.get("concurrency"), 5)

    @patch("subprocess.Popen")
    def test_generic_download_robust_execution(self, mock_popen) -> None:
        """Verify _download_generic_task runs yt-dlp, parses progress, and registers project."""
        clean_title = "Facebook_Empress_Test"
        series_dir = self.uploads_dir / clean_title
        series_dir.mkdir(parents=True, exist_ok=True)
        dummy_mp4 = series_dir / f"{clean_title}.mp4"
        dummy_mp4.write_bytes(b"MP4_DATA" * 5000)

        # Mock stdout lines from yt-dlp
        fake_lines = [
            "[download] Destination: " + str(dummy_mp4),
            "[download]  25.0% of ~10.00MiB at 2.50MiB/s ETA 00:03",
            "[download]  75.0% of ~10.00MiB at 4.00MiB/s ETA 00:01",
            "[download] 100% of 10.00MiB in 00:03 at 3.00MiB/s",
            "[Merger] Merging formats into \"" + str(dummy_mp4) + "\"",
        ]

        import io

        class FakeProc:
            pid = 12345
            returncode = 0

            def __init__(self):
                self.stdout = io.StringIO("\n".join(fake_lines) + "\n")

            def wait(self):
                return 0

        mock_popen.return_value = FakeProc()

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        task = DownloadTask(
            task_id="task_generic_01",
            target_info={
                "platform": "generic",
                "title": clean_title,
                "url": "https://www.facebook.com/share/r/1745u1s9XG/",
            },
            auto_create_project=True,
            output_dir=str(self.uploads_dir),
        )

        manager._download_generic_task(task, series_dir)

        # Verify task progress updated to 100%
        self.assertEqual(task.progress, 100.0)
        # Verify project created
        self.assertEqual(len(task.created_projects), 1)
        created_id = task.created_projects[0]["project_id"]
        manifest = self.repo.get_project(created_id)
        self.assertIsNotNone(manifest)
        self.assertEqual(manifest.title, clean_title)

    @patch("subprocess.Popen")
    def test_youtube_cmd_and_bdp_progress_parsing(self, mock_popen) -> None:
        """Verify YouTube URLs inject player_client bypass args and parse BDP progress templates."""
        clean_title = "Road_To_Empress_Test"
        series_dir = self.uploads_dir / clean_title
        series_dir.mkdir(parents=True, exist_ok=True)
        dummy_mp4 = series_dir / f"{clean_title}.mp4"
        dummy_mp4.write_bytes(b"YT_DATA" * 5000)

        fake_lines = [
            f"__BDP_PROGRESS__50.0%|3.50MiB/s|00:02|5.0MiB|10.0MiB",
            f"__BDP_PROGRESS__100%|4.00MiB/s|00:00|10.0MiB|10.0MiB",
            f"__BDP_OUTPUT__{dummy_mp4}",
        ]

        import io

        class FakeProc:
            pid = 23456
            returncode = 0

            def __init__(self):
                self.stdout = io.StringIO("\n".join(fake_lines) + "\n")

            def wait(self):
                return 0

        mock_popen.return_value = FakeProc()

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        task = DownloadTask(
            task_id="task_yt_01",
            target_info={
                "platform": "generic",
                "title": clean_title,
                "url": "https://www.youtube.com/watch?v=pwr48u0-OrI",
            },
            auto_create_project=True,
            output_dir=str(self.uploads_dir),
        )

        manager._download_generic_task(task, series_dir)

        # Verify yt-dlp arguments passed
        executed_cmd = mock_popen.call_args[0][0]
        self.assertIn("--windows-filenames", executed_cmd)
        self.assertNotIn("--windowsfilenames", executed_cmd)
        self.assertTrue(any("youtube:player_client=" in arg for arg in executed_cmd))
        self.assertIn("--progress-template", executed_cmd)

        # Verify task progress updated to 100%
        self.assertEqual(task.progress, 100.0)
        self.assertEqual(len(task.created_projects), 1)


if __name__ == "__main__":
    unittest.main()
