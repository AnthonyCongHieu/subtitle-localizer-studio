import sys
import tempfile
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from fastapi.testclient import TestClient

from subtitle_localizer.downloader.hongguo_parser import select_best_quality
from subtitle_localizer.service.downloader import DownloadTask
from subtitle_localizer.service.server import create_app
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository

class TestResolutionAndSizeEstimation(unittest.TestCase):
    def setUp(self):
        self.sample_video_list = {
            "video_5": {"vheight": 1920, "vwidth": 1080, "definition": "1080p", "size": 7029513, "bitrate": 1823456},
            "video_4": {"vheight": 1280, "vwidth": 720, "definition": "720p", "size": 3681439, "bitrate": 923456},
            "video_3": {"vheight": 960, "vwidth": 540, "definition": "540p", "size": 3358054, "bitrate": 623456},
            "video_2": {"vheight": 854, "vwidth": 480, "definition": "480p", "size": 3101683, "bitrate": 423456},
            "video_1": {"vheight": 640, "vwidth": 360, "definition": "360p", "size": 2311894, "bitrate": 223456},
        }

    def test_select_best_quality_resolutions(self):
        k, v = select_best_quality(self.sample_video_list, "best")
        self.assertEqual(k, "video_5")
        k, v = select_best_quality(self.sample_video_list, "720p")
        self.assertEqual(k, "video_4")
        k, v = select_best_quality(self.sample_video_list, "540p")
        self.assertEqual(k, "video_3")
        k, v = select_best_quality(self.sample_video_list, "480p")
        self.assertEqual(k, "video_2")
        k, v = select_best_quality(self.sample_video_list, "360p")
        self.assertEqual(k, "video_1")

    def test_download_task_target_resolution(self):
        task = DownloadTask(task_id="task_res_01", target_info={"title": "Test", "series_id": "123"}, target_resolution="720p")
        self.assertEqual(task.target_resolution, "720p")
        self.assertEqual(task.to_dict()["target_resolution"], "720p")

    def test_api_queue_add_with_resolution(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
            temp_path = Path(td)
            db = Database(temp_path / "test.db")
            db.migrate()
            repo = ProjectRepository(db)
            app = create_app(database=db, repo=repo, auth_token="test-token", output_root=temp_path / "outputs")
            client = TestClient(app)
            headers = {"Authorization": "Bearer test-token"}
            target = {"platform": "hongguo", "series_id": "7675940162605435928", "title": "Phim Test", "total_episodes": 10}
            add_res = client.post("/api/v1/downloader/queue/add", headers=headers, json={"target_info": target, "episodes": [1, 2], "target_resolution": "720p"})
            self.assertEqual(add_res.status_code, 200)
            task_id = add_res.json()["task_id"]
            list_res = client.get("/api/v1/downloader/queue/list", headers=headers)
            self.assertEqual(list_res.status_code, 200)
            tasks = list_res.json()["tasks"]
            matched = next((t for t in tasks if t["task_id"] == task_id), None)
            self.assertIsNotNone(matched)
            self.assertEqual(matched["target_resolution"], "720p")
            db.close()

if __name__ == "__main__":
    unittest.main()
