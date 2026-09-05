"""
Unit test suite for Advanced Search Filters, Bilingual Translation,
and Download History Tracking (inspired by bilibili-downloader-pro).
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from fastapi.testclient import TestClient
from subtitle_localizer.downloader.translator import (
    translate_text,
    translate_titles_batch,
    clear_translation_cache,
)
from subtitle_localizer.downloader.download_history import (
    record_downloaded_item,
    is_item_downloaded,
    clear_download_history,
)
from subtitle_localizer.downloader.bilibili_extractor import (
    filter_videos_by_topic,
    search_bilibili_videos,
    search_youtube_videos,
)
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.server import create_app


class TestAdvancedSearchAndHistory(unittest.TestCase):
    """Test advanced filters, translation caching, and history badges."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.temp_path = Path(self.temp_dir.name)
        self.db_path = self.temp_path / "test.db"
        self.database = Database(self.db_path)
        self.database.migrate()
        self.repository = ProjectRepository(self.database)
        self.output_root = self.temp_path / "outputs"
        self.output_root.mkdir(parents=True, exist_ok=True)

        self.auth_token = "test-token-adv"
        self.app = create_app(
            database=self.database,
            repo=self.repository,
            auth_token=self.auth_token,
            output_root=self.output_root,
        )
        self.client = TestClient(self.app)
        self.auth_headers = {"Authorization": f"Bearer {self.auth_token}"}
        clear_translation_cache()
        clear_download_history()

    def tearDown(self) -> None:
        clear_translation_cache()
        clear_download_history()
        self.database.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_translator_cache_and_batch(self) -> None:
        """Test translator caching and batch translation."""
        self.assertEqual(translate_text("", target_lang="vi"), "")
        self.assertEqual(translate_titles_batch([], target_lang="vi"), [])

        with patch("urllib.request.urlopen") as mock_url:
            mock_resp = MagicMock()
            mock_resp.read.return_value = json.dumps([[["Phim ngắn hot", "热门短剧"]]]).encode("utf-8")
            mock_url.return_value.__enter__.return_value = mock_resp

            vi = translate_text("热门短剧", target_lang="vi")
            self.assertEqual(vi, "Phim ngắn hot")

            # Second call should use local memory cache (urlopen called once)
            vi2 = translate_text("热门短剧", target_lang="vi")
            self.assertEqual(vi2, "Phim ngắn hot")
            self.assertEqual(mock_url.call_count, 1)

    def test_download_history_tracking_and_clear(self) -> None:
        """Test download history recording, lookup, and clearing."""
        test_bvid = "BV1testHistory999"
        self.assertFalse(is_item_downloaded(test_bvid))

        record_downloaded_item(test_bvid)
        self.assertTrue(is_item_downloaded(test_bvid))

        clear_res = self.client.post(
            "/api/v1/downloader/history/clear",
            headers=self.auth_headers,
        )
        self.assertEqual(clear_res.status_code, 200)
        self.assertTrue(clear_res.json()["success"])
        self.assertFalse(is_item_downloaded(test_bvid))

    def test_topic_filter_must_and_must_not(self) -> None:
        """Test must_contain and must_not_contain logic."""
        videos = [
            {"title": "Đại Hiệp Quyết Đấu Full HD", "bvid": "BV1"},
            {"title": "Đại Hiệp Quyết Đấu Trailer Preview", "bvid": "BV2"},
            {"title": "Hài Kịch Gia Đình Tập 1", "bvid": "BV3"},
        ]

        filtered1 = filter_videos_by_topic(videos, must_contain="Đại Hiệp", must_not_contain="")
        self.assertEqual(len(filtered1), 2)

        filtered2 = filter_videos_by_topic(videos, must_contain="Đại Hiệp", must_not_contain="Trailer, Preview")
        self.assertEqual(len(filtered2), 1)
        self.assertEqual(filtered2[0]["bvid"], "BV1")

    def test_server_advanced_search_endpoint_with_history_and_filters(self) -> None:
        """Test /api/v1/downloader/search with filters and history annotation."""
        record_downloaded_item("BV_DOWNLOADED_ALREADY")

        mock_raw_bili = [
            {
                "id": "1",
                "bvid": "BV_DOWNLOADED_ALREADY",
                "title": "Bilibili Short Drama Ep 1",
                "author": "CreatorA",
                "pic": "https://i0.hdslb.com/1.jpg",
                "duration": "05:00",
                "play": 1000,
                "url": "https://www.bilibili.com/video/BV_DOWNLOADED_ALREADY",
                "title_vi": "Phim Ngắn Bilibili Tập 1",
            },
            {
                "id": "2",
                "bvid": "BV_NEW_FRESH",
                "title": "Bilibili Short Drama Ep 2",
                "author": "CreatorB",
                "pic": "https://i0.hdslb.com/2.jpg",
                "duration": "12:00",
                "play": 2000,
                "url": "https://www.bilibili.com/video/BV_NEW_FRESH",
                "title_vi": "Phim Ngắn Bilibili Tập 2",
            }
        ]

        with patch("subtitle_localizer.downloader.bilibili_extractor.search_bilibili_videos") as mock_search:
            mock_search.return_value = mock_raw_bili

            res = self.client.post(
                "/api/v1/downloader/search",
                headers=self.auth_headers,
                json={
                    "keyword": "短剧",
                    "platform": "bilibili",
                    "page": 1,
                    "order": "click",
                    "duration": 1,
                    "must_contain": "Ep",
                    "must_not_contain": "Trailer",
                    "auto_translate": True,
                    "translate_titles": True,
                },
            )
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["platform"], "bilibili")
            self.assertEqual(len(data["results"]), 2)

            item1 = next(x for x in data["results"] if x["bvid"] == "BV_DOWNLOADED_ALREADY")
            item2 = next(x for x in data["results"] if x["bvid"] == "BV_NEW_FRESH")
            self.assertTrue(item1["downloaded"])
            self.assertFalse(item2["downloaded"])
            self.assertEqual(item1["title_vi"], "Phim Ngắn Bilibili Tập 1")

        clear_download_history()


if __name__ == "__main__":
    unittest.main()
