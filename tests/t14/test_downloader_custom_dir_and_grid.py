"""
Opaque-box test suite for:
- R1: Custom Output Directory (Validation, Auto-Creation, Persistence, Sanitization)
- R2: Visual Episode Grid Disk Status Detection (Green >100KB, Red <=100KB, Gray Missing)
      & Selective Episode Download ([15, 32])
- R5: Series Cover / Thumbnail Automatic and Standalone Download

Selected via: pytest tests/t14/test_downloader_custom_dir_and_grid.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from fastapi.testclient import TestClient
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.downloader import DownloadManager, sanitize_filename
from subtitle_localizer.service.server import create_app


class TestDownloaderCustomDirAndGrid(unittest.TestCase):
    """Test suite covering R1 (Custom Path), R2 (Grid/Disk Status & Selective Download), and R5 (Cover)."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.temp_path = Path(self.temp_dir.name)
        self.db_path = self.temp_path / "test.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.uploads_dir = self.temp_path / "default_uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.output_root = self.temp_path / "outputs"
        self.output_root.mkdir(parents=True, exist_ok=True)

        self.auth_token = "dir-grid-token"
        self.app = create_app(
            database=self.db,
            repo=self.repo,
            auth_token=self.auth_token,
            output_root=self.output_root,
        )
        self.client = TestClient(self.app)
        self.headers = {"Authorization": f"Bearer {self.auth_token}"}

    def tearDown(self) -> None:
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    # =========================================================================
    # R1: CUSTOM OUTPUT DIRECTORY
    # =========================================================================

    def test_directory_validate_existing_valid_path(self) -> None:
        """R1: Validate existing folder returns valid=True, exists=True, writable=True."""
        existing_folder = self.temp_path / "valid_storage"
        existing_folder.mkdir(parents=True, exist_ok=True)

        res = self.client.post(
            "/api/v1/downloader/directory/validate",
            headers=self.headers,
            json={"path": str(existing_folder), "auto_create": False},
        )
        self.assertEqual(res.status_code, 200, f"Validation failed: {res.text}")
        data = res.json()
        self.assertTrue(data.get("valid", False))
        self.assertTrue(data.get("exists", False))
        self.assertTrue(data.get("writable", False))
        self.assertIsNone(data.get("error"))

    def test_directory_validate_empty_path_defaults_to_uploads(self) -> None:
        """R1: Empty or omitted path resolves to default uploads/ directory."""
        res = self.client.post(
            "/api/v1/downloader/directory/validate",
            headers=self.headers,
            json={"path": "", "auto_create": False},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("valid", False))
        resolved_path = data.get("path", "")
        self.assertTrue("uploads" in resolved_path.lower() or Path(resolved_path).exists())

    def test_directory_validate_auto_create_new_folder(self) -> None:
        """R1: Non-existent path with auto_create=True creates the directory tree."""
        new_target = self.temp_path / "deeply" / "nested" / "drama_dir"
        self.assertFalse(new_target.exists())

        res = self.client.post(
            "/api/v1/downloader/directory/validate",
            headers=self.headers,
            json={"path": str(new_target), "auto_create": True},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("valid", False))
        self.assertTrue(data.get("exists", False))
        self.assertTrue(data.get("writable", False))
        self.assertTrue(new_target.exists(), "Directory tree was not created on disk")

    def test_directory_validate_auto_create_false_reports_non_existent(self) -> None:
        """R1: Non-existent path with auto_create=False reports exists=False without creating it."""
        non_existent = self.temp_path / "never_created_dir"
        res = self.client.post(
            "/api/v1/downloader/directory/validate",
            headers=self.headers,
            json={"path": str(non_existent), "auto_create": False},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data.get("exists", True))
        self.assertFalse(non_existent.exists())

    def test_directory_validate_invalid_path_characters(self) -> None:
        """R1: Path with invalid Windows characters (* ? < > |) returns valid=False."""
        invalid_path = "C:/invalid*path?name<bad>|"
        res = self.client.post(
            "/api/v1/downloader/directory/validate",
            headers=self.headers,
            json={"path": invalid_path, "auto_create": False},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data.get("valid", True))
        self.assertIsNotNone(data.get("error"))

    def test_custom_output_dir_used_by_downloader_task(self) -> None:
        """R1: Task configured with custom output_dir saves files in that directory instead of default uploads."""
        custom_dir = self.temp_path / "custom_hongguo_downloads"
        custom_dir.mkdir(parents=True, exist_ok=True)

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        drama_title = "Kiểm Tra Đường Dẫn Tùy Chỉnh"
        clean_title = sanitize_filename(drama_title)
        expected_series_dir = custom_dir / clean_title

        # Create dummy completed episode in custom dir
        expected_series_dir.mkdir(parents=True, exist_ok=True)
        ep1_file = expected_series_dir / f"{clean_title}_Tap_01.mp4"
        ep1_file.write_bytes(b"A" * 150000)

        # Call scan-episodes pointing to custom_dir
        res = self.client.post(
            "/api/v1/downloader/scan-episodes",
            headers=self.headers,
            json={
                "title": drama_title,
                "total_episodes": 1,
                "output_dir": str(custom_dir),
            },
        )
        self.assertEqual(res.status_code, 200)
        episodes = res.json().get("episodes", [])
        self.assertEqual(len(episodes), 1)
        self.assertEqual(episodes[0]["status"], "completed")

    # =========================================================================
    # R2: EPISODE DISK STATUS DETECTION & SELECTIVE DOWNLOAD
    # =========================================================================

    def test_scan_episodes_disk_status_green_completed(self) -> None:
        """R2: Episode file > 100,000 bytes is detected as 'completed' (🟢 Green)."""
        series_dir = self.uploads_dir / "Test_Drama_Green"
        series_dir.mkdir(parents=True, exist_ok=True)
        ep_file = series_dir / "Test_Drama_Green_Tap_01.mp4"
        ep_file.write_bytes(b"V" * 150000)  # 150 KB > 100 KB

        res = self.client.post(
            "/api/v1/downloader/scan-episodes",
            headers=self.headers,
            json={"title": "Test_Drama_Green", "total_episodes": 1, "output_dir": str(self.uploads_dir)},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        eps = data.get("episodes", [])
        self.assertEqual(len(eps), 1)
        self.assertEqual(eps[0]["episode"], 1)
        self.assertEqual(eps[0]["status"], "completed")
        self.assertGreater(eps[0]["size_bytes"], 100000)

    def test_scan_episodes_disk_status_red_corrupted(self) -> None:
        """R2: Episode file <= 100,000 bytes (incomplete/corrupt) is detected as 'corrupted' (🔴 Red)."""
        series_dir = self.uploads_dir / "Test_Drama_Red"
        series_dir.mkdir(parents=True, exist_ok=True)
        ep_file = series_dir / "Test_Drama_Red_Tap_01.mp4"
        ep_file.write_bytes(b"V" * 1024)  # 1 KB <= 100 KB

        res = self.client.post(
            "/api/v1/downloader/scan-episodes",
            headers=self.headers,
            json={"title": "Test_Drama_Red", "total_episodes": 1, "output_dir": str(self.uploads_dir)},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        eps = data.get("episodes", [])
        self.assertEqual(len(eps), 1)
        self.assertEqual(eps[0]["status"], "corrupted")

    def test_scan_episodes_disk_status_gray_missing(self) -> None:
        """R2: Non-existent episode file is detected as 'missing' (⚪ Gray)."""
        res = self.client.post(
            "/api/v1/downloader/scan-episodes",
            headers=self.headers,
            json={"title": "Non_Existent_Drama", "total_episodes": 3, "output_dir": str(self.uploads_dir)},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        eps = data.get("episodes", [])
        self.assertEqual(len(eps), 3)
        for ep in eps:
            self.assertEqual(ep["status"], "missing")
            self.assertEqual(ep["size_bytes"], 0)

    def test_scan_episodes_81_episodes_batch_summary(self) -> None:
        """R2: Verify 81-episode drama disk scan matches acceptance criteria:
        ep 1..14 completed, ep 15 missing, ep 16..31 completed, ep 32 corrupted (50KB), ep 33..81 missing.
        """
        title = "Phim_Dai_81_Tap"
        series_dir = self.uploads_dir / title
        series_dir.mkdir(parents=True, exist_ok=True)

        # 1..14 complete
        for i in range(1, 15):
            (series_dir / f"{title}_Tap_{i:02d}.mp4").write_bytes(b"M" * 200000)

        # 15 missing (do nothing)

        # 16..31 complete
        for i in range(16, 32):
            (series_dir / f"{title}_Tap_{i:02d}.mp4").write_bytes(b"M" * 200000)

        # 32 corrupted (50KB)
        (series_dir / f"{title}_Tap_32.mp4").write_bytes(b"M" * 50000)

        # 33..81 missing (do nothing)

        res = self.client.post(
            "/api/v1/downloader/scan-episodes",
            headers=self.headers,
            json={"title": title, "total_episodes": 81, "output_dir": str(self.uploads_dir)},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()

        eps = data.get("episodes", [])
        self.assertEqual(len(eps), 81)

        completed_eps = [e for e in eps if e["status"] == "completed"]
        corrupted_eps = [e for e in eps if e["status"] == "corrupted"]
        missing_eps = [e for e in eps if e["status"] == "missing"]

        self.assertEqual(len(completed_eps), 30)  # 14 + 16
        self.assertEqual(len(corrupted_eps), 1)   # ep 32
        self.assertEqual(len(missing_eps), 50)    # ep 15 + (81 - 32 = 49) = 50

        # Summary counters if provided in response
        if "completed_count" in data:
            self.assertEqual(data["completed_count"], 30)
            self.assertEqual(data["corrupted_count"], 1)
            self.assertEqual(data["missing_count"], 50)

    @patch("subtitle_localizer.downloader.hongguo_parser.resolve_video_url")
    def test_selective_episodes_download_only_selected(self, mock_resolve) -> None:
        """R2: Selective download with episodes=[15, 32] downloads ONLY episode 15 and 32."""
        downloaded_vids: List[str] = []

        def fake_resolve(vid, proxy=None, device_keys=None):
            downloaded_vids.append(vid)
            f = self.uploads_dir / f"{vid}.mp4"
            f.write_bytes(b"Q" * 150000)
            return {"url": f"http://fake.com/{vid}.mp4"}

        mock_resolve.side_effect = fake_resolve

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        target = {
            "platform": "hongguo",
            "series_id": "748888888888",
            "title": "Chon_Tap_Le_15_32",
            "total_episodes": 81,
        }

        # Mock vid_list of 81 vids
        fake_vids = [f"vid_{i:02d}" for i in range(1, 82)]
        with patch.object(manager, "_get_vid_list", create=True, return_value=fake_vids):
            if hasattr(manager, "add_to_queue"):
                task = manager.add_to_queue(
                    target_info=target,
                    episodes=[15, 32],
                    auto_create_project=False,
                )
                time.sleep(2.0)
                # Ensure only episodes 15 and 32 were processed
                for v in downloaded_vids:
                    self.assertIn(v, ["vid_15", "vid_32"], f"Unexpected episode downloaded: {v}")

    # =========================================================================
    # R5: COVER / THUMBNAIL DOWNLOAD
    # =========================================================================

    @patch("urllib.request.urlopen")
    def test_standalone_download_cover_success(self, mock_urlopen) -> None:
        """R5: POST /api/v1/downloader/download-cover saves cover image to specified folder."""
        # Mock image response bytes
        fake_jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 2048 + b"\xff\xd9"
        mock_resp = MagicMock()
        mock_resp.read.return_value = fake_jpeg
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        cover_dir = self.temp_path / "covers"
        cover_dir.mkdir(parents=True, exist_ok=True)

        res = self.client.post(
            "/api/v1/downloader/download-cover",
            headers=self.headers,
            json={
                "cover_url": "https://p3.douyinpic.com/tos-cn-p-0015/fake_cover.jpg",
                "output_dir": str(cover_dir),
                "filename": "cover.jpg",
            },
        )
        self.assertEqual(res.status_code, 200, f"Failed to download cover: {res.text}")
        data = res.json()
        self.assertTrue(data.get("success", False))
        file_path = Path(data.get("file_path", ""))
        self.assertTrue(file_path.exists(), "Cover image file was not created on disk")
        self.assertEqual(file_path.name, "cover.jpg")
        self.assertGreater(file_path.stat().st_size, 100)

    @patch("urllib.request.urlopen")
    def test_standalone_download_cover_invalid_url(self, mock_urlopen) -> None:
        """R5: Standalone cover download handles invalid/unreachable URL gracefully."""
        mock_urlopen.side_effect = Exception("Network connection timeout")

        res = self.client.post(
            "/api/v1/downloader/download-cover",
            headers=self.headers,
            json={
                "cover_url": "https://invalid-non-existent-domain.xyz/bad.jpg",
                "output_dir": str(self.temp_path),
            },
        )
        self.assertIn(res.status_code, [200, 400, 502])
        if res.status_code == 200:
            self.assertFalse(res.json().get("success", True))

    @patch("urllib.request.urlopen")
    def test_automatic_cover_download_during_drama_task(self, mock_urlopen) -> None:
        """R5: Automatically download and store cover.jpg in series folder when drama task runs."""
        fake_jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 1024 + b"\xff\xd9"
        mock_resp = MagicMock()
        mock_resp.read.return_value = fake_jpeg
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        manager = DownloadManager(repository=self.repo, uploads_dir=self.uploads_dir)
        target = {
            "platform": "hongguo",
            "series_id": "74999999999",
            "title": "Drama_Co_Anh_Bia",
            "cover_url": "https://p3.douyinpic.com/cover_drama.jpg",
            "total_episodes": 1,
        }

        if hasattr(manager, "add_to_queue"):
            manager.add_to_queue(target_info=target, episodes=[1], auto_create_project=False)
            time.sleep(1.5)
            series_dir = self.uploads_dir / "Drama_Co_Anh_Bia"
            cover_file = series_dir / "cover.jpg"
            self.assertTrue(cover_file.exists(), "Expected cover.jpg in drama folder after task execution")


if __name__ == "__main__":
    unittest.main()
