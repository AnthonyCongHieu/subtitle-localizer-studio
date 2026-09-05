"""
Unit test suite for PlatformAuthManager, Bilibili Wbi signing and search,
Xiaohongshu clean video extraction, and Server auth endpoints.
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict
from unittest.mock import MagicMock, patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from fastapi.testclient import TestClient
from subtitle_localizer.downloader.platform_auth import PlatformAuthManager
from subtitle_localizer.downloader.bilibili_extractor import (
    sign_wbi,
    get_mixin_key,
    search_bilibili_videos,
    probe_bilibili_video_details,
)
from subtitle_localizer.downloader.xhs_extractor import (
    resolve_canonical_xhs_url,
    parse_xhs_note_info,
)
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.downloader import DownloadManager
from subtitle_localizer.service.server import create_app


class TestPlatformAuthAndSearch(unittest.TestCase):
    """Test Platform Authentication, Guest Capabilities, and Video Search."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.temp_path = Path(self.temp_dir.name)
        self.db_path = self.temp_path / "test.db"
        self.database = Database(self.db_path)
        self.database.migrate()
        self.repository = ProjectRepository(self.database)
        self.output_root = self.temp_path / "outputs"
        self.output_root.mkdir(parents=True, exist_ok=True)

        self.cookie_file = self.temp_path / "test_cookies.json"
        self.auth_mgr = PlatformAuthManager(cookie_store_path=self.cookie_file)

        self.auth_token = "test-token"
        self.app = create_app(
            database=self.database,
            repo=self.repository,
            auth_token=self.auth_token,
            output_root=self.output_root,
        )
        self.client = TestClient(self.app)
        self.auth_headers = {"Authorization": f"Bearer {self.auth_token}"}

    def tearDown(self) -> None:
        self.database.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_platform_auth_cookie_storage_and_netscape_conversion(self) -> None:
        status = self.auth_mgr.list_auth_status()
        self.assertIn("platforms", status)
        self.assertIn("accountless_capabilities", status)
        self.assertFalse(status["platforms"]["bilibili"]["logged_in"])

        raw_cookie = "SESSDATA=mock_sessdata_12345; bili_jct=mock_csrf_token; DedeUserID=999888"
        self.auth_mgr.save_cookie("bilibili", raw_cookie)
        self.assertEqual(self.auth_mgr.get_cookie("bilibili"), raw_cookie)

        status2 = self.auth_mgr.list_auth_status()
        self.assertTrue(status2["platforms"]["bilibili"]["logged_in"])

        netscape_path = self.auth_mgr.create_temp_netscape_cookie_file(
            "bilibili", "https://www.bilibili.com/video/BV1xx411c7mD"
        )
        self.assertIsNotNone(netscape_path)
        content = Path(netscape_path).read_text(encoding="utf-8")
        self.assertIn("# Netscape HTTP Cookie File", content)
        self.assertIn(".bilibili.com", content)
        self.assertIn("SESSDATA", content)
        self.assertIn("mock_sessdata_12345", content)

        try:
            os.remove(netscape_path)
        except OSError:
            pass

        deleted = self.auth_mgr.delete_cookie("bilibili")
        self.assertTrue(deleted)
        self.assertIsNone(self.auth_mgr.get_cookie("bilibili"))
        self.assertFalse(self.auth_mgr.list_auth_status()["platforms"]["bilibili"]["logged_in"])

    def test_bilibili_wbi_signing(self) -> None:
        img_key = "653657f524a147869197482773e8284d"
        sub_key = "245ae70515124b62baf8e3ae1d4f7328"
        params = {"keyword": "test_drama", "page": 1}
        signed = sign_wbi(params, img_key=img_key, sub_key=sub_key)

        self.assertIn("w_rid", signed)
        self.assertIn("wts", signed)
        self.assertEqual(signed["keyword"], "test_drama")
        self.assertEqual(signed["page"], 1)
        self.assertEqual(len(signed["w_rid"]), 32)

    def test_xhs_clean_origin_extraction(self) -> None:
        sample_html = """
        <!DOCTYPE html>
        <html>
        <head><title>Xiaohongshu Video Note</title></head>
        <body>
        <script>
        window.__INITIAL_STATE__ = {
            "note": {
                "noteDetailMap": {
                    "64ab1234": {
                        "note": {
                            "title": "Short Drama Episode 1",
                            "desc": "Watch this amazing clean drama",
                            "video": {
                                "consumer": {
                                    "originVideoKey": "spectrum/origin/test_clean_video_key_1080p"
                                }
                            }
                        }
                    }
                }
            }
        };
        </script>
        </body>
        </html>
        """
        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_response = MagicMock()
            mock_response.read.return_value = sample_html.encode("utf-8")
            mock_response.geturl.return_value = "https://www.xiaohongshu.com/explore/64ab1234"
            mock_urlopen.return_value.__enter__.return_value = mock_response

            res = parse_xhs_note_info("https://www.xiaohongshu.com/explore/64ab1234")
            self.assertEqual(res["title"], "Short Drama Episode 1")
            self.assertEqual(
                res["url"],
                "http://sns-video-bd.xhscdn.com/spectrum/origin/test_clean_video_key_1080p",
            )
            self.assertEqual(res["platform"], "xiaohongshu")
            self.assertTrue(len(res["resolutions"]) >= 1)
            self.assertEqual(res["resolutions"][0]["id"], "1080p")

    def test_server_auth_and_search_endpoints(self) -> None:
        res = self.client.get("/api/v1/downloader/auth/status", headers=self.auth_headers)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("platforms", data)
        self.assertIn("accountless_capabilities", data)

        save_payload = {"platform": "douyin", "cookie": "passport_csrf_token=test1234;"}
        save_res = self.client.post(
            "/api/v1/downloader/auth/cookies",
            headers=self.auth_headers,
            json=save_payload,
        )
        self.assertEqual(save_res.status_code, 200)
        self.assertTrue(save_res.json()["success"])

        del_res = self.client.delete(
            "/api/v1/downloader/auth/cookies/douyin",
            headers=self.auth_headers,
        )
        self.assertEqual(del_res.status_code, 200)
        self.assertTrue(del_res.json()["success"])

        with patch("subtitle_localizer.downloader.bilibili_extractor.search_bilibili_videos") as mock_search:
            mock_search.return_value = [
                {
                    "id": "12345",
                    "bvid": "BV1xx411c7mD",
                    "title": "Bilibili Short Drama Test",
                    "author": "DramaCreator",
                    "pic": "https://i0.hdslb.com/bfs/archive/test.jpg",
                    "play": 50000,
                    "duration": "03:45",
                    "url": "https://www.bilibili.com/video/BV1xx411c7mD",
                }
            ]
            search_res = self.client.post(
                "/api/v1/downloader/search",
                headers=self.auth_headers,
                json={"keyword": "短剧", "platform": "bilibili", "page": 1},
            )
            self.assertEqual(search_res.status_code, 200)
            search_data = search_res.json()
            self.assertEqual(search_data["platform"], "bilibili")
            self.assertEqual(len(search_data["results"]), 1)
            self.assertEqual(search_data["results"][0]["bvid"], "BV1xx411c7mD")

        with patch("subtitle_localizer.downloader.bilibili_extractor.search_youtube_videos") as mock_yt_search:
            mock_yt_search.return_value = [
                {
                    "id": "abc123xyz",
                    "title": "Documentary 2026",
                    "author": "DocuChannel",
                    "pic": "https://i.ytimg.com/vi/abc123xyz/hqdefault.jpg",
                    "duration": "45:00",
                    "url": "https://www.youtube.com/watch?v=abc123xyz",
                    "platform": "youtube",
                }
            ]
            yt_res = self.client.post(
                "/api/v1/downloader/search",
                headers=self.auth_headers,
                json={"keyword": "纪录片", "platform": "youtube", "page": 1},
            )
            self.assertEqual(yt_res.status_code, 200)
            yt_data = yt_res.json()
            self.assertEqual(yt_data["platform"], "youtube")
            self.assertEqual(len(yt_data["results"]), 1)
            self.assertEqual(yt_data["results"][0]["id"], "abc123xyz")


if __name__ == "__main__":
    unittest.main()
