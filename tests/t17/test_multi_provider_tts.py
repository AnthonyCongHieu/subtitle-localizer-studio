import asyncio
import base64
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.dubbing.tts import (
    AVAILABLE_VOICES,
    TTS_CATALOG,
    get_tts_catalog,
    synthesize_text,
    clean_subtitle_text,
    default_voice_pools,
    detect_voice_provider,
    normalize_voice_for_provider,
    resolve_tts_provider,
)
from subtitle_localizer.dubbing.capcut_tts import (
    CAPCUT_VOICE_CATALOG,
    CapCutTTSClient,
    CapCutTTSRequestError,
)
from subtitle_localizer.dubbing.gemini_tts import (
    GeminiTTSClient,
    GEMINI_VOICE_CATALOG,
)
from subtitle_localizer.service.pipeline_settings import DubbingSettings


class MultiProviderTTSTest(unittest.TestCase):
    def test_dubbing_settings_has_provider_and_gemini_prompt(self) -> None:
        dub = DubbingSettings()
        self.assertEqual(dub.provider, "capcut")
        self.assertEqual(dub.gemini_prompt_style, "dramatic")

        custom_dub = DubbingSettings(provider="capcut", voice="BV075_streaming")
        self.assertEqual(custom_dub.provider, "capcut")
        self.assertEqual(custom_dub.voice, "BV075_streaming")

    def test_tts_catalog_structure(self) -> None:
        catalog = get_tts_catalog()
        self.assertIn("edge", catalog)
        self.assertIn("capcut", catalog)
        self.assertIn("gemini", catalog)

        # Check catalog counts
        self.assertGreaterEqual(len(catalog["capcut"]), 120)  # 127 verified CapCut voices
        self.assertGreaterEqual(len(catalog["edge"]), 50)      # 51 Edge-TTS voices
        self.assertGreaterEqual(len(catalog["gemini"]), 20)    # 20 Gemini Speech personas

        # Verify all voices have complete metadata
        for provider, voices in catalog.items():
            for v in voices:
                self.assertTrue(v.get("voice_id"), f"Missing voice_id in {provider}")
                self.assertTrue(v.get("display_name"), f"Missing display_name in {provider}/{v.get('voice_id')}")
                self.assertTrue(v.get("lang"), f"Missing lang in {provider}/{v.get('voice_id')}")
                self.assertIn(v.get("gender"), ("male", "female", "neutral"), f"Invalid gender in {provider}/{v.get('voice_id')}")
                self.assertTrue(v.get("description"), f"Missing description in {provider}/{v.get('voice_id')}")
                self.assertIsInstance(v.get("tags"), list, f"Tags not a list in {provider}/{v.get('voice_id')}")

        # Check CapCut Vietnamese voices
        capcut_vi = [v for v in catalog["capcut"] if v.get("lang") == "vi"]
        self.assertGreaterEqual(len(capcut_vi), 20)
        voice_ids = [v["voice_id"] for v in capcut_vi]
        self.assertIn("BV075_streaming", voice_ids)  # Thanh Niên Tự Tin
        self.assertIn("BV074_streaming", voice_ids)  # Cô Gái Hoạt Ngôn
        self.assertIn("BV421_vivn_streaming", voice_ids)  # Nhỏ Ngọt Ngào

        # Check Edge Vietnamese voices
        edge_vi = [v for v in catalog["edge"] if v.get("lang") == "vi"]
        self.assertGreaterEqual(len(edge_vi), 2)

        # Check Gemini voices
        gemini_voices = catalog["gemini"]
        self.assertGreaterEqual(len(gemini_voices), 20)
        gemini_names = [v["voice_id"] for v in gemini_voices]
        self.assertIn("Puck", gemini_names)
        self.assertIn("Kore", gemini_names)

    @staticmethod
    def _request_payload(body: str) -> dict:
        task_payload = json.loads(body)["tasks"][0]["payload"]
        return json.loads(task_payload)

    def test_capcut_tts_client_ssml_and_sign(self) -> None:
        client = CapCutTTSClient()
        url, headers, body = client.build_tts_request(
            text="Xin chào các bạn",
            voice="BV075_streaming",
            rate="1.0",
        )
        self.assertTrue(url.startswith("https://editor-api-sg.capcutapi.com"))
        self.assertIn("sign", headers)
        self.assertIn("x-ss-stub", headers)
        self.assertIn("BV075_streaming", body)
        self.assertIn("sami_text_to_speech", body)

    def test_capcut_ssml_uses_catalog_locale_and_sanitizes_xml(self) -> None:
        client = CapCutTTSClient()
        _, _, body_en = client.build_tts_request(
            text="Café & <friends>\x00\x0b",
            voice="DiT_en_female_jessie",
        )
        ssml_en = self._request_payload(body_en)["ssml"]
        self.assertIn('xml:lang="en-US"', ssml_en)
        self.assertIn("Café &amp; &lt;friends&gt;", ssml_en)
        self.assertNotIn("Café", ssml_en)
        self.assertNotIn("\x00", ssml_en)
        self.assertNotIn("\x0b", ssml_en)

        _, _, body_vi = client.build_tts_request(
            text="Xin chào",
            voice="multi_male_felipe_uranus_bigtts",
        )
        self.assertIn('xml:lang="vi-VN"', self._request_payload(body_vi)["ssml"])

    def test_capcut_ssml_applies_percent_speaking_rate(self) -> None:
        client = CapCutTTSClient()
        _, _, body = client.build_tts_request(
            text="Xin chào các bạn",
            voice="BV075_streaming",
            rate="+30%",
        )
        self.assertIn("prosody rate", body)
        self.assertIn("1.30", body)

    def test_parse_speaking_rate_from_ui_presets(self) -> None:
        from subtitle_localizer.dubbing.tts import parse_speaking_rate

        self.assertAlmostEqual(parse_speaking_rate("+0%"), 1.0)
        self.assertAlmostEqual(parse_speaking_rate("0.9"), 0.9)
        self.assertAlmostEqual(parse_speaking_rate("+15%"), 1.15)
        self.assertAlmostEqual(parse_speaking_rate("+30%"), 1.3)
        self.assertAlmostEqual(parse_speaking_rate("-10%"), 0.9)

    def test_capcut_accepts_numeric_and_string_success_ret(self) -> None:
        for ret in (0, "0"):
            with self.subTest(ret=ret), patch(
                "subtitle_localizer.dubbing.capcut_tts.urllib.request.urlopen"
            ) as mock_urlopen, patch(
                "subtitle_localizer.dubbing.capcut_tts.asyncio.sleep", new_callable=AsyncMock
            ):
                create = MagicMock()
                create.__enter__.return_value.read.return_value = json.dumps(
                    {"ret": ret, "data": {"tasks": [{"id": "task-1", "token": "token-1"}]}}
                ).encode()
                query = MagicMock()
                query.__enter__.return_value.read.return_value = json.dumps(
                    {
                        "ret": ret,
                        "data": {
                            "tasks": [
                                {
                                    "status": "success",
                                    "payload": json.dumps(
                                        {"audio": base64.b64encode(b"mp3-data").decode()}
                                    ),
                                }
                            ]
                        },
                    }
                ).encode()
                mock_urlopen.side_effect = [create, query]

                result = asyncio.run(CapCutTTSClient().synthesize("Xin chào"))
                self.assertEqual(result, b"mp3-data")
                self.assertEqual(mock_urlopen.call_count, 2)

    def test_capcut_task_failure_is_surfaced_without_retry(self) -> None:
        with patch(
            "subtitle_localizer.dubbing.capcut_tts.urllib.request.urlopen"
        ) as mock_urlopen, patch(
            "subtitle_localizer.dubbing.capcut_tts.asyncio.sleep", new_callable=AsyncMock
        ):
            create = MagicMock()
            create.__enter__.return_value.read.return_value = json.dumps(
                {"ret": "0", "data": {"tasks": [{"id": "task-1", "token": "token-1"}]}}
            ).encode()
            query = MagicMock()
            query.__enter__.return_value.read.return_value = json.dumps(
                {
                    "ret": 0,
                    "data": {
                        "tasks": [
                            {"status": "failed", "err_code": 810, "err_msg": "voice unavailable"}
                        ]
                    },
                }
            ).encode()
            mock_urlopen.side_effect = [create, query]

            with self.assertRaisesRegex(CapCutTTSRequestError, "810.*voice unavailable"):
                asyncio.run(CapCutTTSClient().synthesize("Xin chào"))
            self.assertEqual(mock_urlopen.call_count, 2)

    def test_capcut_query_ret_failure_is_surfaced_without_retry(self) -> None:
        with patch(
            "subtitle_localizer.dubbing.capcut_tts.urllib.request.urlopen"
        ) as mock_urlopen, patch(
            "subtitle_localizer.dubbing.capcut_tts.asyncio.sleep", new_callable=AsyncMock
        ):
            create = MagicMock()
            create.__enter__.return_value.read.return_value = json.dumps(
                {"ret": 0, "data": {"tasks": [{"id": "task-1", "token": "token-1"}]}}
            ).encode()
            query = MagicMock()
            query.__enter__.return_value.read.return_value = json.dumps(
                {"ret": "810", "errmsg": "query rejected"}
            ).encode()
            mock_urlopen.side_effect = [create, query]

            with self.assertRaisesRegex(CapCutTTSRequestError, "810.*query rejected"):
                asyncio.run(CapCutTTSClient().synthesize("Xin chào"))
            self.assertEqual(mock_urlopen.call_count, 2)

    def test_capcut_create_error_810_is_not_retried(self) -> None:
        with patch(
            "subtitle_localizer.dubbing.capcut_tts.urllib.request.urlopen"
        ) as mock_urlopen, patch(
            "subtitle_localizer.dubbing.capcut_tts.asyncio.sleep", new_callable=AsyncMock
        ) as mock_sleep:
            response = MagicMock()
            response.__enter__.return_value.read.return_value = json.dumps(
                {"ret": 810, "errmsg": "deterministic provider error"}
            ).encode()
            mock_urlopen.return_value = response

            with self.assertRaisesRegex(CapCutTTSRequestError, "810"):
                asyncio.run(CapCutTTSClient().synthesize("Xin chào"))
            mock_urlopen.assert_called_once()
            mock_sleep.assert_not_awaited()

    def test_capcut_empty_success_payload_is_not_retried(self) -> None:
        with patch.object(
            CapCutTTSClient,
            "_synthesize_once",
            new_callable=AsyncMock,
            side_effect=CapCutTTSRequestError("success response contained no audio"),
        ) as mock_once, patch(
            "subtitle_localizer.dubbing.capcut_tts.asyncio.sleep", new_callable=AsyncMock
        ) as mock_sleep:
            with self.assertRaisesRegex(CapCutTTSRequestError, "no audio"):
                asyncio.run(CapCutTTSClient().synthesize("Xin chào"))
            mock_once.assert_awaited_once()
            mock_sleep.assert_not_awaited()

    def test_capcut_system_busy_retries_as_transient_capacity_error(self) -> None:
        with patch.object(
            CapCutTTSClient,
            "_synthesize_once",
            new_callable=AsyncMock,
            side_effect=[
                CapCutTTSRequestError("CapCut TTS task báo lỗi (1000): system busy"),
                b"capcut-audio",
            ],
        ) as mock_once, patch(
            "subtitle_localizer.dubbing.capcut_tts.asyncio.sleep", new_callable=AsyncMock
        ) as mock_sleep:
            result = asyncio.run(CapCutTTSClient().synthesize("Xin chào"))

        self.assertEqual(result, b"capcut-audio")
        self.assertEqual(mock_once.await_count, 2)
        mock_sleep.assert_awaited_once()

    def test_capcut_transport_error_retries_exactly_once(self) -> None:
        with patch.object(
            CapCutTTSClient,
            "_synthesize_once",
            new_callable=AsyncMock,
            side_effect=[
                urllib.error.URLError("temporary-1"),
                urllib.error.URLError("temporary-2"),
            ],
        ) as mock_once, patch(
            "subtitle_localizer.dubbing.capcut_tts.asyncio.sleep", new_callable=AsyncMock
        ) as mock_sleep:
            with self.assertRaises(urllib.error.URLError):
                asyncio.run(CapCutTTSClient().synthesize("Xin chào"))
            self.assertEqual(mock_once.await_count, 2)
            mock_sleep.assert_awaited_once()

    @patch("subtitle_localizer.dubbing.capcut_tts.CapCutTTSClient.synthesize", new_callable=AsyncMock)
    def test_synthesize_text_routes_to_capcut(self, mock_capcut: AsyncMock) -> None:
        import asyncio
        mock_capcut.return_value = b"fake_capcut_mp3_data"

        result = asyncio.run(synthesize_text(
            text="Hôm nay trời đẹp",
            provider="capcut",
            voice="BV075_streaming",
        ))
        self.assertEqual(result, b"fake_capcut_mp3_data")
        mock_capcut.assert_called_once()

    @patch("subtitle_localizer.dubbing.capcut_tts.CapCutTTSClient.synthesize", new_callable=AsyncMock)
    @patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", new_callable=AsyncMock)
    def test_synthesize_text_explicit_capcut_wins_mismatched_edge_voice(
        self, mock_edge: AsyncMock, mock_capcut: AsyncMock
    ) -> None:
        mock_capcut.return_value = b"capcut-mp3"

        result = asyncio.run(
            synthesize_text(
                text="Provider đã chọn phải thắng",
                provider="capcut",
                voice="vi-VN-HoaiMyNeural",
            )
        )
        self.assertEqual(result, b"capcut-mp3")
        mock_capcut.assert_awaited_once()
        mock_edge.assert_not_awaited()

    @patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", new_callable=AsyncMock)
    @patch("subtitle_localizer.dubbing.capcut_tts.CapCutTTSClient.synthesize", new_callable=AsyncMock)
    def test_synthesize_text_explicit_edge_wins_mismatched_capcut_voice(
        self, mock_capcut: AsyncMock, mock_edge: AsyncMock
    ) -> None:
        mock_edge.return_value = b"edge-mp3"

        result = asyncio.run(
            synthesize_text(
                text="Provider đã chọn phải thắng",
                provider="edge",
                voice="BV075_streaming",
            )
        )
        self.assertEqual(result, b"edge-mp3")
        mock_edge.assert_awaited_once()
        mock_capcut.assert_not_awaited()

    @patch("subtitle_localizer.dubbing.capcut_tts.CapCutTTSClient.synthesize", new_callable=AsyncMock)
    @patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", new_callable=AsyncMock)
    def test_synthesize_text_fallback_on_capcut_failure(
        self, mock_edge: AsyncMock, mock_capcut: AsyncMock
    ) -> None:
        import asyncio
        # Giả lập CapCut bị lỗi timeout hoặc mạng
        mock_capcut.side_effect = RuntimeError("CapCut API timeout")
        mock_edge.return_value = b"fallback_edge_mp3_data"

        result = asyncio.run(synthesize_text(
            text="Câu nói quan trọng",
            provider="capcut",
            voice="BV075_streaming",
        ))
        # Phải tự động fallback sang Edge-TTS mà không sập pipeline
        self.assertEqual(result, b"fallback_edge_mp3_data")
        mock_capcut.assert_called_once()
        mock_edge.assert_called_once()

    @patch("subtitle_localizer.dubbing.capcut_tts.CapCutTTSClient.synthesize", new_callable=AsyncMock)
    @patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", new_callable=AsyncMock)
    def test_synthesize_text_fallback_on_empty_capcut_audio_once(
        self, mock_edge: AsyncMock, mock_capcut: AsyncMock
    ) -> None:
        mock_capcut.return_value = b""
        mock_edge.return_value = b"fallback_edge_mp3_data"

        result = asyncio.run(
            synthesize_text(
                text="Câu nói quan trọng",
                provider="capcut",
                voice="BV075_streaming",
            )
        )
        self.assertEqual(result, b"fallback_edge_mp3_data")
        mock_capcut.assert_awaited_once()
        mock_edge.assert_awaited_once()

    @patch("subtitle_localizer.dubbing.gemini_tts.GeminiTTSClient.synthesize", new_callable=AsyncMock)
    def test_synthesize_text_routes_to_gemini(self, mock_gemini: AsyncMock) -> None:
        mock_gemini.return_value = b"fake_gemini_mp3_data"

        result = asyncio.run(synthesize_text(
            text="Trời xanh ngắt",
            provider="gemini",
            voice="Puck",
            prompt_style="dramatic",
        ))
        self.assertEqual(result, b"fake_gemini_mp3_data")
        mock_gemini.assert_called_once()

    @patch("subtitle_localizer.dubbing.tts.apply_speaking_rate_to_audio")
    @patch("subtitle_localizer.dubbing.gemini_tts.GeminiTTSClient.synthesize", new_callable=AsyncMock)
    def test_gemini_synthesize_applies_ui_speaking_rate(self, mock_gemini: AsyncMock, mock_apply) -> None:
        import asyncio

        mock_gemini.return_value = b"fake_gemini_mp3_data"
        mock_apply.return_value = b"sped_up_mp3"

        result = asyncio.run(
            synthesize_text(
                text="Trời xanh ngắt",
                provider="gemini",
                voice="Puck",
                prompt_style="dramatic",
                rate="+30%",
            )
        )
        self.assertEqual(result, b"sped_up_mp3")
        mock_apply.assert_called_once()
        self.assertEqual(mock_apply.call_args.args[1], "+30%")

    @patch("subtitle_localizer.dubbing.gemini_tts.GeminiTTSClient.synthesize", new_callable=AsyncMock)
    @patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", new_callable=AsyncMock)
    def test_synthesize_text_fallback_on_gemini_failure(
        self, mock_edge: AsyncMock, mock_gemini: AsyncMock
    ) -> None:
        import asyncio
        mock_gemini.side_effect = RuntimeError("Gemini Quota Exceeded")
        mock_edge.return_value = b"fallback_edge_mp3_data"

        result = asyncio.run(synthesize_text(
            text="Thử nghiệm lỗi",
            provider="gemini",
            voice="Puck",
        ))
        self.assertEqual(result, b"fallback_edge_mp3_data")
        mock_gemini.assert_called_once()
        mock_edge.assert_called_once()

    def test_server_tts_catalog_endpoint(self) -> None:
        from fastapi.testclient import TestClient
        from subtitle_localizer.service.server import create_app
        client = TestClient(create_app())
        resp = client.get("/api/v1/settings/tts-catalog")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("edge", data)
        self.assertIn("capcut", data)
        self.assertIn("gemini", data)
        self.assertGreater(len(data["capcut"]), 0)

    def test_gender_speaker_allocation_and_tag_parsing(self) -> None:
        from subtitle_localizer.domain.models import SubtitleCueV1
        from subtitle_localizer.dubbing.tts import detect_cue_speaker
        from subtitle_localizer.translation.real import RealTranslationProvider

        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=1.0, end_pts=2.0, source_text="你好"),
            SubtitleCueV1(cue_id="c2", start_pts=2.5, end_pts=3.5, source_text="你怎么了"),
        ]

        provider = RealTranslationProvider()
        model_output = "[0] [Nam] Xin chào cậu\n[1] [Nữ] Anh sao thế?"
        updated = provider._apply_model_response(cues, [0, 1], model_output)

        self.assertEqual(updated, 2)
        # Check that [Nam] and [Nữ] were parsed into style['speaker']
        self.assertEqual(cues[0].style.get("speaker"), "male")
        self.assertEqual(cues[1].style.get("speaker"), "female")
        # Check that translated_text is clean (tags stripped)
        self.assertEqual(cues[0].translated_text, "Xin chào cậu")
        self.assertEqual(cues[1].translated_text, "Anh sao thế?")
        # Check detect_cue_speaker returns correct gender
        self.assertEqual(detect_cue_speaker(cues[0], cues[0].translated_text), "male")
        self.assertEqual(detect_cue_speaker(cues[1], cues[1].translated_text), "female")

    def test_mix_voiceover_functions_exported(self) -> None:
        from subtitle_localizer.dubbing import mix_voiceover_into_video, mix_voiceover_audio_only
        self.assertTrue(callable(mix_voiceover_into_video))
        self.assertTrue(callable(mix_voiceover_audio_only))

    def test_capcut_catalog_cleaned_of_neural_voices(self) -> None:
        """Kiểm tra capcut_voices.json đã được loại bỏ 3 giọng Edge-TTS gán nhầm."""
        capcut_ids = {v["voice_id"] for v in CAPCUT_VOICE_CATALOG}
        self.assertEqual(len(CAPCUT_VOICE_CATALOG), 124)
        self.assertNotIn("vi-VN-NamMinhNeural", capcut_ids)
        self.assertNotIn("vi-VN-HoaiMyNeural", capcut_ids)
        self.assertNotIn("en-US-JennyMultilingualNeural", capcut_ids)
        for vid in capcut_ids:
            self.assertNotIn("Neural", vid)

    def test_detect_voice_provider_and_resolve_provider(self) -> None:
        """Kiểm tra nhận diện provider chính xác cho toàn bộ các dạng giọng."""
        # CapCut complex voices
        self.assertEqual(detect_voice_provider("multi_female_yangguangnv_uranus_bigtts"), "capcut")
        self.assertEqual(detect_voice_provider("multi_female_richgirl_uranus_bigtts"), "capcut")
        self.assertEqual(detect_voice_provider("multi_male_felipe_uranus_bigtts"), "capcut")
        self.assertEqual(detect_voice_provider("DiT_en_female_jessie"), "capcut")
        self.assertEqual(detect_voice_provider("en_male_deadpool"), "capcut")
        self.assertEqual(detect_voice_provider("BV421_vivn_streaming"), "capcut")
        self.assertEqual(detect_voice_provider("th"), "capcut")
        self.assertEqual(detect_voice_provider("en"), "capcut")

        # Gemini personas
        self.assertEqual(detect_voice_provider("Puck"), "gemini")
        self.assertEqual(detect_voice_provider("Kore"), "gemini")
        self.assertEqual(detect_voice_provider("Zephyr"), "gemini")
        self.assertEqual(detect_voice_provider("Sulafat"), "gemini")
        self.assertEqual(detect_voice_provider("Charon"), "gemini")
        self.assertEqual(detect_voice_provider("Enceladus"), "gemini")
        self.assertEqual(detect_voice_provider("Orus"), "gemini")
        self.assertEqual(detect_voice_provider("Despina"), "gemini")

        # Edge voices
        self.assertEqual(detect_voice_provider("vi-VN-NamMinhNeural"), "edge")
        self.assertEqual(detect_voice_provider("vi-VN-HoaiMyNeural"), "edge")
        self.assertEqual(detect_voice_provider("en-US-JennyNeural"), "edge")
        self.assertEqual(detect_voice_provider("nam"), "edge")
        self.assertEqual(detect_voice_provider(None), "edge")
        self.assertEqual(detect_voice_provider(""), "edge")

        # Resolve with an explicit valid provider: the user's provider wins even
        # when a stale persisted voice belongs to another provider.
        self.assertEqual(resolve_tts_provider("multi_female_yangguangnv_uranus_bigtts", preferred_provider="edge"), "edge")
        self.assertEqual(resolve_tts_provider("vi-VN-NamMinhNeural", preferred_provider="capcut"), "capcut")
        self.assertEqual(resolve_tts_provider("Zephyr", preferred_provider="edge"), "edge")

        # Unknown custom voice also respects the explicit provider.
        self.assertEqual(resolve_tts_provider("custom_cloned_voice_123", preferred_provider="capcut"), "capcut")
        self.assertEqual(resolve_tts_provider("custom_cloned_voice_123", preferred_provider="gemini"), "gemini")

    def test_provider_specific_voice_pools_and_defaults(self) -> None:
        provider_ids = {
            provider: {voice["voice_id"] for voice in voices}
            for provider, voices in TTS_CATALOG.items()
        }
        self.assertTrue(provider_ids["edge"].isdisjoint(provider_ids["capcut"]))
        self.assertTrue(provider_ids["edge"].isdisjoint(provider_ids["gemini"]))
        self.assertTrue(provider_ids["capcut"].isdisjoint(provider_ids["gemini"]))

        self.assertIn(AVAILABLE_VOICES["nam"], provider_ids["edge"])
        self.assertIn(AVAILABLE_VOICES["nu"], provider_ids["edge"])
        self.assertEqual(
            normalize_voice_for_provider("vi-VN-HoaiMyNeural", "capcut"),
            "BV074_streaming",
        )
        self.assertEqual(
            normalize_voice_for_provider("BV075_streaming", "gemini"),
            "Puck",
        )
        self.assertEqual(
            normalize_voice_for_provider("Puck", "edge"),
            "vi-VN-NamMinhNeural",
        )

        for provider, defaults in {
            "edge": {"male": AVAILABLE_VOICES["nam"], "female": AVAILABLE_VOICES["nu"]},
            "capcut": {"male": "BV075_streaming", "female": "BV074_streaming"},
            "gemini": {"male": "Puck", "female": "Kore"},
        }.items():
            pools = default_voice_pools(provider)
            self.assertEqual(set(pools), {"male", "female"})
            for gender, default_voice in defaults.items():
                self.assertIn(default_voice, pools[gender])
                self.assertTrue(set(pools[gender]).issubset(provider_ids[provider]))

    @patch("subtitle_localizer.dubbing.capcut_tts.CapCutTTSClient.synthesize", new_callable=AsyncMock)
    def test_server_test_tts_routes_capcut_without_fallback(self, mock_capcut: AsyncMock) -> None:
        """Kiểm tra endpoint /settings/test-tts không ép giọng CapCut thành Edge."""
        from fastapi.testclient import TestClient
        from subtitle_localizer.service.server import create_app
        mock_capcut.return_value = b"capcut_test_mp3_stream"

        client = TestClient(create_app())
        resp = client.post(
            "/api/v1/settings/test-tts",
            json={
                "text": "Kiểm tra giọng CapCut",
                "voice": "multi_female_yangguangnv_uranus_bigtts",
                "provider": "capcut",
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.content, b"capcut_test_mp3_stream")
        mock_capcut.assert_called_once()


if __name__ == "__main__":
    unittest.main()

