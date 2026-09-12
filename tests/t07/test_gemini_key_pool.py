import time
import unittest
import json

from subtitle_localizer.translation.key_pool import GeminiKeyPool


def _json_response(payload: dict):
    from unittest.mock import MagicMock

    response = MagicMock()
    response.status = 200
    response.read.return_value = json.dumps(payload).encode("utf-8")
    response.__enter__.return_value = response
    return response


def _gemini_ok_response(text: str):
    return _json_response({"candidates": [{"content": {"parts": [{"text": text}]}}]})


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

    def test_gemini_translation_is_one_request_even_when_legacy_batch_size_is_set(self) -> None:
        import json
        import os
        from unittest.mock import MagicMock, patch
        from subtitle_localizer.domain.models import SubtitleCueV1
        from subtitle_localizer.translation.real import RealTranslationProvider
        from subtitle_localizer.translation.key_pool import GeminiKeyPool

        provider = RealTranslationProvider()
        pool = GeminiKeyPool(["key_mock_1"])
        cues = [
            SubtitleCueV1(cue_id=f"c{i}", start_pts=float(i), end_pts=float(i + 1), source_text=f"中文{i}")
            for i in range(25)
        ]
        response = MagicMock()
        response.status = 200
        response.read.return_value = json.dumps({
            "candidates": [{"content": {"parts": [{
                "text": "\n".join(f"[{i + 1}] Bản dịch {i}" for i in range(25))
            }]}}]
        }).encode("utf-8")
        response.__enter__.return_value = response

        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}), \
             patch("urllib.request.urlopen", return_value=response) as urlopen:
            result = provider._translate_with_gemini(
                cues, "zh", "vi", key_pool=pool, batch_size=10
            )

        self.assertTrue(result)
        self.assertEqual(urlopen.call_count, 1)
        self.assertTrue(all(cue.translated_text for cue in cues))

    def test_gemini_401_dead_service_account_key_is_quarantined(self) -> None:
        import io
        import os
        import urllib.error
        from unittest.mock import patch
        from subtitle_localizer.domain.models import SubtitleCueV1
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        pool = GeminiKeyPool(["key_dead", "key_alive"])
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="中文一"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="中文二"),
        ]
        dead_hits = {"count": 0}

        def fake_urlopen(request, *args, **kwargs):
            if "key_dead" in request.full_url:
                dead_hits["count"] += 1
                raise urllib.error.HTTPError(
                    url=request.full_url,
                    code=401,
                    msg="Unauthorized",
                    hdrs={},
                    fp=io.BytesIO(
                        b'{"error":{"code":401,"message":"The bound service account is deleted or disabled."}}'
                    ),
                )
            return _gemini_ok_response("[1] Bản dịch một\n[2] Bản dịch hai")

        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}), \
             patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = provider._translate_with_gemini(cues, "zh", "vi", key_pool=pool)

        self.assertTrue(result)
        self.assertEqual(dead_hits["count"], 1)
        self.assertEqual(pool.get_status()["active_keys"], 1)
        self.assertEqual(pool._reasons.get("key_dead"), "http_401_invalid")

    def test_gemini_model_404_falls_forward_to_available_model(self) -> None:
        import io
        import os
        import urllib.error
        from unittest.mock import patch
        from subtitle_localizer.domain.models import SubtitleCueV1
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        pool = GeminiKeyPool(["key_only"])
        cues = [SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="中文一")]
        attempted_models: list[str] = []

        def fake_urlopen(request, *args, **kwargs):
            model = request.full_url.split("/models/")[1].split(":")[0]
            attempted_models.append(model)
            if model == "gemini-2.5-flash":
                raise urllib.error.HTTPError(
                    url=request.full_url,
                    code=404,
                    msg="Not Found",
                    hdrs={},
                    fp=io.BytesIO(
                        b'{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users."}}'
                    ),
                )
            return _gemini_ok_response("[1] Bản dịch một")

        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}), \
             patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = provider._translate_with_gemini(
                cues, "zh", "vi", key_pool=pool, gemini_model="gemini-2.5-flash"
            )

        self.assertTrue(result)
        self.assertEqual(attempted_models[0], "gemini-2.5-flash")
        self.assertIn("gemini-3.8-flash", attempted_models)
        # A model-scoped 404 must not blacklist a healthy API key.
        self.assertEqual(pool.get_status()["active_keys"], 1)

    def test_gemini_400_generation_config_retries_same_key_with_minimal_payload(self) -> None:
        import io
        import json as json_module
        import os
        import urllib.error
        from unittest.mock import patch
        from subtitle_localizer.domain.models import SubtitleCueV1
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        pool = GeminiKeyPool(["key_only"])
        cues = [SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="中文一")]
        payloads: list[dict] = []

        def fake_urlopen(request, *args, **kwargs):
            body = json_module.loads(request.data.decode("utf-8"))
            payloads.append(body)
            if "generationConfig" in body:
                raise urllib.error.HTTPError(
                    url=request.full_url,
                    code=400,
                    msg="Bad Request",
                    hdrs={},
                    fp=io.BytesIO(
                        b'{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}'
                    ),
                )
            return _gemini_ok_response("[1] Bản dịch một")

        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}), \
             patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = provider._translate_with_gemini(
                cues, "zh", "vi", key_pool=pool, gemini_model="gemini-2.5-flash"
            )

        self.assertTrue(result)
        self.assertEqual(len(payloads), 2)
        self.assertIn("thinkingConfig", payloads[0]["generationConfig"])
        self.assertNotIn("generationConfig", payloads[1])
        # The key answered twice, so it must stay usable.
        self.assertEqual(pool.get_status()["active_keys"], 1)

    def test_local_qwen_native_fallback_when_openai_content_is_empty(self) -> None:
        from unittest.mock import patch
        from subtitle_localizer.domain.models import SubtitleCueV1
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="中文一"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="中文二"),
        ]
        requested_urls: list[str] = []

        def fake_urlopen(request, *args, **kwargs):
            url = request.full_url
            requested_urls.append(url)
            if url.endswith("/v1/chat/completions"):
                return _json_response({
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": "", "reasoning": "thinking..."}}]
                })
            if url.endswith("/api/chat"):
                return _json_response({"message": {"role": "assistant", "content": "[1] Bản dịch một\n[2] Bản dịch hai"}})
            raise AssertionError(f"unexpected url: {url}")

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = provider._translate_with_local_qwen(
                cues, "zh", "vi", model="qwen3:14b", endpoint="http://localhost:11434", batch_size=2
            )

        self.assertTrue(result)
        self.assertEqual(cues[0].translated_text, "Bản dịch một")
        self.assertEqual(cues[1].translated_text, "Bản dịch hai")
        self.assertTrue(any(url.endswith("/api/chat") for url in requested_urls))

    def test_local_qwen_empty_choices_does_not_raise_index_error(self) -> None:
        from unittest.mock import patch
        from subtitle_localizer.domain.models import SubtitleCueV1
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        cues = [SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="中文一")]

        def fake_urlopen(request, *args, **kwargs):
            if request.full_url.endswith("/v1/chat/completions"):
                return _json_response({"choices": []})
            return _json_response({"message": {"role": "assistant", "content": ""}})

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = provider._translate_with_local_qwen(
                cues, "zh", "vi", model="qwen3:14b", endpoint="http://localhost:11434", batch_size=1
            )

        self.assertFalse(result)
        self.assertEqual(cues[0].translated_text, "")

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


class GeminiPoolBudgetAndIsolationTest(unittest.TestCase):
    """Regression: dead keys must not starve the healthy keys in one run."""

    def test_health_check_falls_forward_for_legacy_probe_model(self) -> None:
        import io
        import urllib.error
        from unittest.mock import patch

        pool = GeminiKeyPool(["key_new_cohort"])
        probed_models: list[str] = []

        def fake_urlopen(request, *args, **kwargs):
            model = request.full_url.split("/models/")[1].split(":")[0]
            probed_models.append(model)
            if model == "gemini-2.5-flash":
                raise urllib.error.HTTPError(
                    url=request.full_url,
                    code=404,
                    msg="Not Found",
                    hdrs={},
                    fp=io.BytesIO(
                        b'{"error":{"code":404,"message":"This model is no longer available to new users."}}'
                    ),
                )
            return _gemini_ok_response("hi")

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            res = pool.check_key_health("key_new_cohort")

        # Key thuộc nhóm mới 404 với model cũ nhưng vẫn dịch tốt -> phải báo "ok",
        # không được báo lỗi giả.
        self.assertEqual(res["status"], "ok")
        self.assertIn("gemini-3.8-flash", probed_models)

    def test_health_check_keeps_probing_when_first_model_is_retired(self) -> None:
        import io
        import urllib.error
        from unittest.mock import patch

        pool = GeminiKeyPool(["key_legacy"])

        def fake_urlopen(request, *args, **kwargs):
            model = request.full_url.split("/models/")[1].split(":")[0]
            if model != "gemini-2.5-flash":
                raise urllib.error.HTTPError(
                    url=request.full_url,
                    code=404,
                    msg="Not Found",
                    hdrs={},
                    fp=io.BytesIO(b'{"error":{"code":404,"message":"not available"}}'),
                )
            return _gemini_ok_response("hi")

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            res = pool.check_key_health("key_legacy")

        self.assertEqual(res["status"], "ok")

    @staticmethod
    def _cues(count: int = 1):
        from subtitle_localizer.domain.models import SubtitleCueV1

        return [
            SubtitleCueV1(
                cue_id=f"c{i}", start_pts=float(i), end_pts=float(i + 1), source_text=f"中文{i}"
            )
            for i in range(count)
        ]

    def test_key_budget_reaches_live_key_behind_dead_keys(self) -> None:
        import io
        import os
        import urllib.error
        from unittest.mock import patch
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        pool = GeminiKeyPool([f"key_dead_{i}" for i in range(20)] + ["key_alive"])
        alive_hits = {"count": 0}

        def fake_urlopen(request, *args, **kwargs):
            if "key_alive" in request.full_url:
                alive_hits["count"] += 1
                return _gemini_ok_response("[1] Bản dịch một")
            raise urllib.error.HTTPError(
                url=request.full_url,
                code=401,
                msg="Unauthorized",
                hdrs={},
                fp=io.BytesIO(
                    b'{"error":{"code":401,"message":"The bound service account is deleted or disabled."}}'
                ),
            )

        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}), \
             patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = provider._translate_with_gemini(self._cues(), "zh", "vi", key_pool=pool)

        self.assertTrue(result)
        self.assertGreaterEqual(alive_hits["count"], 1)

    def test_request_level_400_does_not_quarantine_healthy_keys(self) -> None:
        import io
        import os
        import urllib.error
        from unittest.mock import patch
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        pool = GeminiKeyPool(["key_a", "key_b"])

        def fake_urlopen(request, *args, **kwargs):
            raise urllib.error.HTTPError(
                url=request.full_url,
                code=400,
                msg="Bad Request",
                hdrs={},
                fp=io.BytesIO(
                    b'{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}'
                ),
            )

        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}), \
             patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = provider._translate_with_gemini(self._cues(), "zh", "vi", key_pool=pool)

        # A malformed-request 400 is not the key's fault: both keys stay usable.
        self.assertFalse(result)
        self.assertEqual(pool.get_status()["active_keys"], 2)

    def test_key_without_any_available_model_is_parked(self) -> None:
        import io
        import os
        import urllib.error
        from unittest.mock import patch
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        pool = GeminiKeyPool(["key_legacy", "key_new"])

        def fake_urlopen(request, *args, **kwargs):
            if "key_legacy" in request.full_url:
                raise urllib.error.HTTPError(
                    url=request.full_url,
                    code=404,
                    msg="Not Found",
                    hdrs={},
                    fp=io.BytesIO(
                        b'{"error":{"code":404,"message":"This model is no longer available to new users."}}'
                    ),
                )
            return _gemini_ok_response("[1] Bản dịch một")

        with patch.dict(os.environ, {"TEST_WITH_GEMINI": "1"}), \
             patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = provider._translate_with_gemini(self._cues(), "zh", "vi", key_pool=pool)

        self.assertTrue(result)
        # Every model 404'd for the legacy key -> park it for later runs.
        self.assertEqual(pool.get_status()["active_keys"], 1)
        self.assertEqual(pool._reasons.get("key_legacy"), "http_404_model_unavailable")

    def test_batch_engine_binding_is_thread_scoped(self) -> None:
        import threading
        import time as time_module
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        provider._batch_engine_fn = None
        worker_engine = (lambda *args, **kwargs: True)
        worker_started = threading.Event()

        def worker() -> None:
            provider._batch_engine_fn = worker_engine
            worker_started.set()
            time_module.sleep(0.3)

        thread = threading.Thread(target=worker)
        thread.start()
        self.assertTrue(worker_started.wait(timeout=2.0))
        time_module.sleep(0.05)
        observed = provider._batch_engine_fn
        thread.join(timeout=2.0)

        # Another thread's engine must never be visible to this thread.
        self.assertIsNone(observed)


if __name__ == '__main__':
    unittest.main()

