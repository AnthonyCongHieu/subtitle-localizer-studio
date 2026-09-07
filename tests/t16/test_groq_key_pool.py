import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.cloud.groq_pool import GroqKeyPool, mask_groq_key
from subtitle_localizer.cloud.groq_whisper import GroqWhisperExtractor


class GroqKeyPoolTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.pool_file = Path(self.temp_dir.name) / "test_groq_keys.json"

    def tearDown(self) -> None:
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_mask_groq_key(self) -> None:
        self.assertEqual(mask_groq_key("gsk_1234567890abcdef1234567890abcdef"), "gsk_123...cdef")
        self.assertEqual(mask_groq_key("short"), "***")

    def test_load_keys_and_deduplication(self) -> None:
        pool = GroqKeyPool()
        pool.load_keys(["  gsk_key1  ", "gsk_key2", "gsk_key1", "", "   "])
        self.assertEqual(pool.total_keys, 2)
        # Round robin rotation
        k1 = pool.get_next_key()
        k2 = pool.get_next_key()
        k3 = pool.get_next_key()
        self.assertEqual(k1, "gsk_key1")
        self.assertEqual(k2, "gsk_key2")
        self.assertEqual(k3, "gsk_key1")

    def test_mark_rate_limited_and_cooldown(self) -> None:
        pool = GroqKeyPool(["gsk_key1", "gsk_key2", "gsk_key3"])
        # Key 1 bị dính 429 rate limit
        pool.mark_rate_limited("gsk_key1", cooldown_seconds=60.0, reason="HTTP 429")
        self.assertFalse(pool.is_usable("gsk_key1"))
        self.assertTrue(pool.is_usable("gsk_key2"))
        self.assertTrue(pool.is_usable("gsk_key3"))

        # get_next_key() phải tự động bỏ qua key1 và chỉ lấy key2, key3
        k1 = pool.get_next_key()
        self.assertIn(k1, ["gsk_key2", "gsk_key3"])
        k2 = pool.get_next_key()
        self.assertIn(k2, ["gsk_key2", "gsk_key3"])
        self.assertNotEqual(k1, k2)

        # Trạng thái pool
        status = pool.get_status()
        self.assertEqual(status["total_keys"], 3)
        self.assertEqual(status["active_keys"], 2)
        self.assertEqual(status["cooldown_keys"], 1)

    def test_delete_key(self) -> None:
        pool = GroqKeyPool(["gsk_key1", "gsk_key2", "gsk_key3"])
        self.assertTrue(pool.delete_key(1))  # Xóa key2
        status = pool.get_status()
        self.assertEqual(status["total_keys"], 2)

    def test_save_and_load_from_file(self) -> None:
        pool = GroqKeyPool(["gsk_keyA", "gsk_keyB"])
        self.assertTrue(pool.save_to_file(self.pool_file))
        self.assertTrue(self.pool_file.exists())

        new_pool = GroqKeyPool()
        self.assertTrue(new_pool.load_from_file(self.pool_file))
        self.assertEqual(new_pool.total_keys, 2)
        self.assertEqual(new_pool.get_next_key(), "gsk_keyA")

    @patch("subtitle_localizer.cloud.groq_whisper.subprocess.run")
    @patch("subtitle_localizer.cloud.groq_whisper.requests.post")
    def test_groq_whisper_extractor_auto_rotates_on_429(self, mock_post: MagicMock, mock_run: MagicMock) -> None:
        """Kiểm tra GroqWhisperExtractor tự động xoay tua sang key tiếp theo khi gặp HTTP 429."""
        mock_run.return_value = MagicMock(returncode=0)

        # Giả lập response: key 1 trả 429, key 2 trả 200 OK
        resp_429 = MagicMock()
        resp_429.status_code = 429
        resp_429.ok = False
        resp_429.text = "Rate limit reached"

        resp_200 = MagicMock()
        resp_200.status_code = 200
        resp_200.ok = True
        resp_200.json.return_value = {
            "segments": [
                {"start": 1.0, "end": 3.5, "text": "Hảo vũ tri thì tiết"}
            ]
        }

        mock_post.side_effect = [resp_429, resp_200]

        # Chuẩn bị file giả lập
        dummy_video = Path(self.temp_dir.name) / "test.mp4"
        dummy_video.write_bytes(b"dummy video data")

        # Chuẩn bị pool với 2 keys
        test_pool = GroqKeyPool(["gsk_key_first", "gsk_key_second"])

        with patch("subtitle_localizer.cloud.groq_whisper.get_global_groq_pool", return_value=test_pool):
            extractor = GroqWhisperExtractor()
            with patch.object(extractor, "_extract_audio") as mock_extract:
                def create_fake_mp3(vpath, outpath):
                    outpath.write_bytes(b"fake_mp3_data")
                mock_extract.side_effect = create_fake_mp3

                cues = extractor.extract_cues(dummy_video)

                self.assertEqual(len(cues), 1)
                self.assertEqual(cues[0].source_text, "Hảo vũ tri thì tiết")
                self.assertEqual(mock_post.call_count, 2)

                # Kiểm tra key đầu tiên đã bị đưa vào cooldown
                self.assertFalse(test_pool.is_usable("gsk_key_first"))
                self.assertTrue(test_pool.is_usable("gsk_key_second"))

    def test_groq_pool_api_endpoints(self) -> None:
        """Kiểm tra các REST API endpoints /settings/groq-pool."""
        from fastapi.testclient import TestClient
        from subtitle_localizer.service.server import create_app

        pool_file = Path("groq_keys_pool.json")
        backup = pool_file.read_text(encoding="utf-8") if pool_file.exists() else None

        try:
            app = create_app()
            client = TestClient(app)

            # 1. Update keys via POST
            post_res = client.post("/api/v1/settings/groq-pool", json={"keys": ["gsk_api_key_1", "gsk_api_key_2"]})
            self.assertEqual(post_res.status_code, 200)
            data = post_res.json()
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["pool_status"]["total_keys"], 2)

            # 2. Get status via GET
            get_res = client.get("/api/v1/settings/groq-pool")
            self.assertEqual(get_res.status_code, 200)
            status_data = get_res.json()
            self.assertEqual(status_data["total_keys"], 2)
            self.assertEqual(status_data["active_keys"], 2)
            self.assertEqual(len(status_data["items"]), 2)

            # 3. Delete key via DELETE
            del_res = client.delete("/api/v1/settings/groq-pool/key/0")
            self.assertEqual(del_res.status_code, 200)
            self.assertEqual(del_res.json()["pool_status"]["total_keys"], 1)

        finally:
            if backup is not None:
                pool_file.write_text(backup, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()

