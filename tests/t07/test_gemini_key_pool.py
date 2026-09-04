import time
import unittest

from subtitle_localizer.translation.key_pool import GeminiKeyPool


class GeminiKeyPoolTest(unittest.TestCase):
    def test_round_robin_rotation(self) -> None:
        pool = GeminiKeyPool(['key_a', 'key_b', 'key_c'])
        self.assertEqual(pool.total_keys, 3)

        # Lấy lần lượt theo thứ tự vòng tròn
        self.assertEqual(pool.get_next_key(), 'key_a')
        self.assertEqual(pool.get_next_key(), 'key_b')
        self.assertEqual(pool.get_next_key(), 'key_c')
        # Vòng lại từ đầu
        self.assertEqual(pool.get_next_key(), 'key_a')
        self.assertEqual(pool.get_next_key(), 'key_b')

    def test_cooldown_on_429(self) -> None:
        pool = GeminiKeyPool(['key_1', 'key_2', 'key_3'])

        # Key 1 bị 429 rate limit
        pool.mark_rate_limited('key_1', cooldown_seconds=60.0)

        # Khi lấy tiếp, phải tự động bỏ qua key_1 và lấy key_2
        self.assertEqual(pool.get_next_key(), 'key_2')
        self.assertEqual(pool.get_next_key(), 'key_3')
        # Vòng lại: vẫn phải bỏ qua key_1
        self.assertEqual(pool.get_next_key(), 'key_2')

        # Kiểm tra trạng thái
        status = pool.get_status()
        self.assertEqual(status['total_keys'], 3)
        self.assertEqual(status['active_keys'], 2)
        self.assertEqual(status['cooldown_keys'], 1)

    def test_cooldown_expiration(self) -> None:
        pool = GeminiKeyPool(['key_x', 'key_y'])
        # Cooldown cực ngắn 0.1s
        pool.mark_rate_limited('key_x', cooldown_seconds=0.1)

        self.assertEqual(pool.get_next_key(), 'key_y')
        self.assertEqual(pool.get_next_key(), 'key_y')

        # Đợi 0.15s để hết cooldown
        time.sleep(0.15)

        # key_x đã hồi phục và quay lại vòng quay
        keys_obtained = {pool.get_next_key(), pool.get_next_key()}
        self.assertIn('key_x', keys_obtained)

    def test_all_keys_in_cooldown_with_timeout(self) -> None:
        pool = GeminiKeyPool(['key_only'])
        pool.mark_rate_limited('key_only', cooldown_seconds=0.2)

        # Chờ timeout 0.3s -> key sẽ hết hạn và trả về thành công
        k = pool.get_next_key(wait_timeout=0.3)
        self.assertEqual(k, 'key_only')

        # Cooldown 10s nhưng chỉ chờ 0.05s -> hết timeout trả về None
        pool.mark_rate_limited('key_only', cooldown_seconds=10.0)
        k_none = pool.get_next_key(wait_timeout=0.05)
        self.assertIsNone(k_none)

    def test_load_keys_prunes_stale_cooldowns(self) -> None:
        pool = GeminiKeyPool(['key_a', 'key_b'])
        pool.mark_rate_limited('key_a', cooldown_seconds=60.0)
        self.assertEqual(pool.get_status()['cooldown_keys'], 1)

        # Nạp lại danh sách keys mới không còn key_a
        pool.load_keys(['key_b', 'key_c'])
        status = pool.get_status()
        self.assertEqual(status['total_keys'], 2)
        self.assertEqual(status['cooldown_keys'], 0)
        self.assertEqual(status['active_keys'], 2)

    def test_masked_keys(self) -> None:
        pool = GeminiKeyPool(['AQ.Ab8FAKE_SAMPLE_KEY_FOR_TESTING_PURPOSES_ABC123lN1g', 'short'])
        status = pool.get_status()
        masked = status['masked_keys']
        self.assertEqual(len(masked), 2)
        self.assertTrue(masked[0].startswith('AQ.Ab8'))
        self.assertTrue(masked[0].endswith('lN1g'))
        self.assertIn('...', masked[0])

    def test_gemini_pool_api_endpoints(self) -> None:
        from fastapi.testclient import TestClient
        from pathlib import Path
        from subtitle_localizer.service.server import create_app

        pool_file = Path("gemini_keys_pool.json")
        backup_content = pool_file.read_text(encoding="utf-8") if pool_file.exists() else None

        try:
            app = create_app()
            client = TestClient(app)

            # 1. Update keys via POST
            post_res = client.post("/api/v1/settings/gemini-pool", json={"keys": ["test_key_1", "test_key_2"]})
            self.assertEqual(post_res.status_code, 200)
            data = post_res.json()
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["pool_status"]["total_keys"], 2)

            # 2. Get status via GET
            get_res = client.get("/api/v1/settings/gemini-pool")
            self.assertEqual(get_res.status_code, 200)
            status_data = get_res.json()
            self.assertEqual(status_data["total_keys"], 2)
            self.assertEqual(status_data["active_keys"], 2)
            self.assertEqual(len(status_data["masked_keys"]), 2)
            self.assertIn("items", status_data)
            self.assertEqual(len(status_data["items"]), 2)
            self.assertTrue(status_data["items"][0]["is_usable"])
            self.assertEqual(status_data["items"][0]["status"], "active")

            # 3. Verify single key via POST /verify
            from unittest.mock import MagicMock, patch
            mock_resp = MagicMock()
            mock_resp.status = 200
            mock_resp.read.return_value = b'{"candidates": []}'
            mock_resp.__enter__.return_value = mock_resp

            with patch("urllib.request.urlopen", return_value=mock_resp):
                verify_res = client.post("/api/v1/settings/gemini-pool/verify", json={"index": 1})
                self.assertEqual(verify_res.status_code, 200)
                v_data = verify_res.json()
                self.assertEqual(v_data["status"], "success")

            # 4. Delete a key via DELETE /key/{index}
            del_res = client.delete("/api/v1/settings/gemini-pool/key/1")
            self.assertEqual(del_res.status_code, 200)
            del_data = del_res.json()
            self.assertEqual(del_data["status"], "success")
            self.assertEqual(del_data["pool_status"]["total_keys"], 1)
        finally:
            if backup_content is not None:
                pool_file.write_text(backup_content, encoding="utf-8")
                from subtitle_localizer.translation.key_pool import get_global_gemini_pool
                get_global_gemini_pool().load_from_file(pool_file)
            elif pool_file.exists():
                pool_file.unlink(missing_ok=True)

    def test_remove_key_by_index(self) -> None:
        pool = GeminiKeyPool(["k1", "k2", "k3"])
        pool.mark_rate_limited("k2", cooldown_seconds=60.0)
        self.assertEqual(pool.total_keys, 3)

        # Xóa key thứ 2
        ok = pool.remove_key_by_index(2)
        self.assertTrue(ok)
        self.assertEqual(pool.total_keys, 2)
        self.assertEqual(pool._keys, ["k1", "k3"])
        # Cooldown của k2 phải bị xóa
        self.assertNotIn("k2", pool._cooldowns)

        # Xóa index ngoài phạm vi
        self.assertFalse(pool.remove_key_by_index(99))
        self.assertFalse(pool.remove_key_by_index(0))

    def test_check_key_health_mocked(self) -> None:
        import io
        import urllib.error
        from unittest.mock import MagicMock, patch

        pool = GeminiKeyPool(["test_key"])

        # 1. 200 OK -> ok
        mock_ok = MagicMock()
        mock_ok.status = 200
        mock_ok.__enter__.return_value = mock_ok
        with patch("urllib.request.urlopen", return_value=mock_ok):
            res = pool.check_key_health("test_key")
            self.assertEqual(res["status"], "ok")
            self.assertEqual(res["status_label"], "Khả dụng")

        # 2. 403 Forbidden -> invalid
        err_403 = urllib.error.HTTPError(
            url="https://gemini.api",
            code=403,
            msg="Forbidden",
            hdrs={},
            fp=io.BytesIO(b'{"error":{"code":403,"message":"API_KEY_INVALID"}}')
        )
        with patch("urllib.request.urlopen", side_effect=err_403):
            res = pool.check_key_health("test_key")
            self.assertEqual(res["status"], "invalid")
            self.assertEqual(res["status_label"], "Không hợp lệ")

        # 3. verify_all_keys
        with patch("urllib.request.urlopen", return_value=mock_ok):
            all_res = pool.verify_all_keys()
            self.assertEqual(len(all_res), 1)
            self.assertEqual(all_res[0]["status"], "ok")


    def test_gemini_real_provider_mocked_success(self) -> None:
        import io
        import json
        import os
        from unittest.mock import MagicMock, patch
        from subtitle_localizer.domain.models import SubtitleCueV1
        from subtitle_localizer.translation.real import RealTranslationProvider
        from subtitle_localizer.translation.key_pool import GeminiKeyPool

        provider = RealTranslationProvider()
        test_pool = GeminiKeyPool(["key_mock_1"])
        cues = [SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="你好")]

        # Giả lập phản hồi JSON hợp lệ từ Gemini
        gemini_response_payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "[0] Xin chào"}
                        ]
                    }
                }
            ]
        }
        mock_response = MagicMock()
        mock_response.status = 200
        mock_response.read.return_value = json.dumps(gemini_response_payload).encode("utf-8")
        mock_response.__enter__.return_value = mock_response

        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}), \
             patch("subtitle_localizer.translation.key_pool.get_global_gemini_pool", return_value=test_pool), \
             patch("urllib.request.urlopen", return_value=mock_response):
            result = provider.translate_cues(cues, source_lang="zh", target_lang="vi")

        self.assertEqual(result[0].translated_text, "Xin chào")

    def test_gemini_real_provider_429_rpm_vs_rpd(self) -> None:
        import io
        import os
        import urllib.error
        from unittest.mock import MagicMock, patch
        from subtitle_localizer.domain.models import SubtitleCueV1
        from subtitle_localizer.translation.real import RealTranslationProvider
        from subtitle_localizer.translation.key_pool import GeminiKeyPool

        provider = RealTranslationProvider()
        cues = [SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="你好")]

        # 1. Test 429 standard RPM limit (chỉ có RESOURCE_EXHAUSTED thông thường)
        pool_rpm = GeminiKeyPool(["key_rpm"])
        rpm_err = urllib.error.HTTPError(
            url="https://gemini.api",
            code=429,
            msg="Too Many Requests",
            hdrs={},
            fp=io.BytesIO(b'{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}')
        )

        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}), \
             patch("subtitle_localizer.translation.key_pool.get_global_gemini_pool", return_value=pool_rpm), \
             patch("urllib.request.urlopen", side_effect=rpm_err):
            # Cố dịch, sẽ gặp 429 và rơi xuống GoogleTranslator
            mock_gt = MagicMock()
            mock_gt.return_value.translate.return_value = "Xin chào fallback"
            with patch("deep_translator.GoogleTranslator", mock_gt):
                provider.translate_cues(cues, source_lang="zh", target_lang="vi")

        # Kiểm tra key_rpm: phải bị rate_limit (60s), KHÔNG PHẢI daily_quota
        self.assertIn("key_rpm", pool_rpm._cooldowns)
        self.assertEqual(pool_rpm._reasons.get("key_rpm"), "rate_limit_exceeded")

        # 2. Test 429 Daily Quota Exceeded (chứa từ khóa "RequestsPerDay" hoặc "daily")
        pool_rpd = GeminiKeyPool(["key_rpd"])
        rpd_err = urllib.error.HTTPError(
            url="https://gemini.api",
            code=429,
            msg="Too Many Requests",
            hdrs={},
            fp=io.BytesIO(b'{"error":{"code":429,"message":"Quota exceeded for metric RequestsPerDay","status":"RESOURCE_EXHAUSTED"}}')
        )
        provider._cache.clear()
        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}), \
             patch("subtitle_localizer.translation.key_pool.get_global_gemini_pool", return_value=pool_rpd), \
             patch("urllib.request.urlopen", side_effect=rpd_err):
            mock_gt = MagicMock()
            mock_gt.return_value.translate.return_value = "Xin chào fallback"
            with patch("deep_translator.GoogleTranslator", mock_gt):
                provider.translate_cues(cues, source_lang="zh", target_lang="vi")

        # Kiểm tra key_rpd: phải bị daily_quota_exhausted (4 giờ)
        self.assertIn("key_rpd", pool_rpd._cooldowns)
        self.assertEqual(pool_rpd._reasons.get("key_rpd"), "daily_quota_exhausted")


if __name__ == '__main__':
    unittest.main()

