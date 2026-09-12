import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, call, patch

import numpy as np

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.dubbing.tts import (
    AVAILABLE_VOICES,
    _decode_mp3_to_pcm,
    _encode_pcm_to_mp3,
    _synthesize_edge_tts,
    assign_voice_for_cue,
    calculate_slot_stretch,
    calculate_uniform_slot_stretch,
    clean_subtitle_text,
    decode_and_validate_audio,
    generate_timed_voiceover,
    generate_voiceover_sync,
    is_valid_speech_audio,
    splice_cue_voiceover,
    synthesize_text,
    time_stretch_pcm,
    validate_non_silent_pcm,
)
from subtitle_localizer.media.waveform import extract_waveform_peaks


class DubbingAndWaveformTest(unittest.TestCase):
    def test_available_voices(self) -> None:
        self.assertIn("nam", AVAILABLE_VOICES)
        self.assertIn("nu", AVAILABLE_VOICES)
        self.assertEqual(AVAILABLE_VOICES["nam"], "vi-VN-NamMinhNeural")
        self.assertEqual(AVAILABLE_VOICES["nu"], "vi-VN-HoaiMyNeural")

    def test_pcm_encode_and_decode(self) -> None:
        # Tạo sóng sin 440Hz dài 0.5s ở 44100Hz
        sample_rate = 44100
        duration = 0.5
        t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False, dtype=np.float32)
        sine_wave = 0.5 * np.sin(2 * np.pi * 440 * t)

        out_mp3 = Path("test_pcm_roundtrip.mp3")
        try:
            encoded_path = _encode_pcm_to_mp3(sine_wave, out_mp3, sample_rate=sample_rate)
            self.assertTrue(encoded_path.exists())
            self.assertGreater(encoded_path.stat().st_size, 0)

            # Đọc lại giải mã thành PCM
            mp3_bytes = encoded_path.read_bytes()
            decoded_pcm = _decode_mp3_to_pcm(mp3_bytes, sample_rate=sample_rate)
            self.assertGreater(len(decoded_pcm), 0)
            self.assertAlmostEqual(len(decoded_pcm) / sample_rate, duration, delta=0.1)
        finally:
            if out_mp3.exists():
                out_mp3.unlink()

    def test_real_waveform_extraction_empty_or_fallback(self) -> None:
        peaks = extract_waveform_peaks(video_path=None, duration=2.0, sample_rate=10)
        self.assertEqual(len(peaks), 20)
        self.assertTrue(all(p == 0.0 for p in peaks))

    def test_real_waveform_extraction_real_video(self) -> None:
        test_video = REPOSITORY_ROOT / "uploads" / "Bilibili_Ngang_03_TruongAnDiVanLuc.mp4"
        if test_video.exists():
            peaks = extract_waveform_peaks(video_path=test_video, duration=10.0, sample_rate=5)
            self.assertEqual(len(peaks), 50)
            self.assertTrue(all(0.0 <= p <= 1.0 for p in peaks))
            self.assertTrue(any(p > 0.0 for p in peaks))

    def test_clean_subtitle_text(self) -> None:
        # 1. Âm thanh trong ngoặc đơn / ngoặc vuông
        self.assertEqual(clean_subtitle_text("(Nhạc) Hôm nay trời đẹp quá! ♪"), "Hôm nay trời đẹp quá!")
        self.assertEqual(clean_subtitle_text("[Tiếng súng nổ] *cười lớn* Đứng lại!"), "Đứng lại!")
        self.assertEqual(clean_subtitle_text("（Nhạc nền）Thật là số hưởng mà！"), "Thật là số hưởng mà！")
        self.assertEqual(clean_subtitle_text("【Âm nhạc nổi lên】 Chào buổi sáng!"), "Chào buổi sáng!")

        # 2. Câu chỉ toàn rác hoặc chú thích
        self.assertEqual(clean_subtitle_text("♪ ♪ ♪"), "")
        self.assertEqual(clean_subtitle_text("..."), "")
        self.assertEqual(clean_subtitle_text("——"), "")
        self.assertEqual(clean_subtitle_text("*(tiếng khóc)*"), "")
        self.assertEqual(clean_subtitle_text(""), "")

        # 3. Bảo toàn số học, tiếng Việt, tiếng Trung CJK
        self.assertEqual(clean_subtitle_text("1.500.000"), "1.500.000")
        self.assertEqual(clean_subtitle_text("王东家 (Nhạc)"), "王东家")
        self.assertEqual(clean_subtitle_text("Đông gia Vương!"), "Đông gia Vương!")

    def test_calculate_slot_stretch(self) -> None:
        # Nếu audio ngắn hơn slot: giữ nguyên 1.0x
        self.assertEqual(calculate_slot_stretch(1.0, 2.0), 1.0)
        self.assertEqual(calculate_slot_stretch(1.5, 1.5), 1.0)

        # Nếu audio dài hơn slot: tăng tốc theo tỷ lệ
        self.assertAlmostEqual(calculate_slot_stretch(1.2, 1.0), 1.2, places=2)
        self.assertAlmostEqual(calculate_slot_stretch(1.35, 1.0), 1.35, places=2)

        # Nếu audio vượt quá ngưỡng max: kẹp tối đa 1.45x
        self.assertEqual(calculate_slot_stretch(2.0, 1.0), 1.45)
        self.assertEqual(calculate_slot_stretch(3.0, 1.0), 1.45)

        # Trường hợp biên thời lượng cực ngắn
        self.assertEqual(calculate_slot_stretch(0.0, 1.0), 1.0)
        self.assertEqual(calculate_slot_stretch(1.0, 0.0), 1.0)

    def test_uniform_auto_stretch_uses_longest_required_ratio(self) -> None:
        self.assertAlmostEqual(
            calculate_uniform_slot_stretch([(1.0, 1.0), (2.4, 1.2), (1.2, 1.5)]),
            2.0,
        )
        self.assertEqual(calculate_uniform_slot_stretch([(4.0, 1.0)], max_rate=2.5), 2.5)

    def test_time_stretch_pcm(self) -> None:
        sample_rate = 44100
        duration = 1.0
        t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False, dtype=np.float32)
        sine_wave = 0.5 * np.sin(2 * np.pi * 440 * t)

        # Stretch 1.25x -> thời lượng phải giảm về xấp xỉ 0.8s
        stretched = time_stretch_pcm(sine_wave, speed_factor=1.25, sample_rate=sample_rate)
        self.assertGreater(len(stretched), 0)
        stretched_duration = len(stretched) / sample_rate
        self.assertAlmostEqual(stretched_duration, duration / 1.25, delta=0.08)

        # speed_factor = 1.0 -> giữ nguyên
        identity = time_stretch_pcm(sine_wave, speed_factor=1.0, sample_rate=sample_rate)
        self.assertEqual(len(identity), len(sine_wave))

    def test_generate_timed_voiceover_with_noise_filtering_and_slot_stretching(self) -> None:
        from unittest.mock import AsyncMock, patch

        # Tạo dummy MP3 audio tương đương 1.35s để kiểm tra stretch
        sample_rate = 44100
        synth_duration = 1.35
        t = np.linspace(0, synth_duration, int(sample_rate * synth_duration), endpoint=False, dtype=np.float32)
        dummy_pcm = 0.3 * np.sin(2 * np.pi * 440 * t)
        temp_mp3 = Path("temp_dummy_synth.mp3")
        _encode_pcm_to_mp3(dummy_pcm, temp_mp3, sample_rate=sample_rate)
        dummy_mp3_bytes = temp_mp3.read_bytes()
        temp_mp3.unlink(missing_ok=True)

        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, translated_text="(Nhạc)"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, translated_text="(Nhạc) Xin chào thế giới! ♪"),
            SubtitleCueV1(cue_id="c3", start_pts=2.5, end_pts=3.5, translated_text="..."),
        ]

        out_voiceover = Path("test_timed_voiceover_out.mp3")
        cues_dir = Path("test_cues_individual")

        try:
            with patch("subtitle_localizer.dubbing.tts.asyncio.sleep", new_callable=AsyncMock), patch(
                "subtitle_localizer.dubbing.tts.random.uniform", return_value=0.0
            ), patch("subtitle_localizer.dubbing.tts.synthesize_text", new_callable=AsyncMock) as mock_synth:
                mock_synth.return_value = dummy_mp3_bytes

                out_path = generate_voiceover_sync(
                    cues=cues,
                    output_path=out_voiceover,
                    total_duration=4.0,
                    max_stretch_rate=1.45,
                    export_cues_dir=cues_dir,
                )

                self.assertTrue(out_path.exists())
                self.assertGreater(out_path.stat().st_size, 0)

                # mock_synth chỉ được gọi 1 lần cho câu hợp lệ duy nhất (c2)
                self.assertEqual(mock_synth.call_count, 1)
                # Câu gọi đến đã được lọc rác sạch sẽ
                called_text = mock_synth.call_args[0][0]
                self.assertEqual(called_text, "Xin chào thế giới!")

                # Thư mục individual cues chứa file của câu hợp lệ (c2.mp3)
                self.assertTrue((cues_dir / "c2.mp3").exists())
                exported_files = list(cues_dir.glob("*.mp3"))
                self.assertGreaterEqual(len(exported_files), 1)
        finally:
            if out_voiceover.exists():
                out_voiceover.unlink(missing_ok=True)
            if cues_dir.exists():
                import shutil
                shutil.rmtree(cues_dir, ignore_errors=True)
    def test_audio_validators_reject_empty_silent_and_non_finite(self) -> None:
        tone = np.array([0.0, 0.2, -0.1], dtype=np.float32)
        np.testing.assert_array_equal(validate_non_silent_pcm(tone), tone)

        for invalid in (
            np.array([], dtype=np.float32),
            np.zeros(32, dtype=np.float32),
            np.array([0.0, np.nan], dtype=np.float32),
            np.array([0.0, np.inf], dtype=np.float32),
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    validate_non_silent_pcm(invalid)

        with patch("subtitle_localizer.dubbing.tts._decode_mp3_to_pcm", return_value=tone):
            np.testing.assert_array_equal(decode_and_validate_audio(b"mp3"), tone)
            self.assertTrue(is_valid_speech_audio(b"mp3"))
        with patch(
            "subtitle_localizer.dubbing.tts._decode_mp3_to_pcm",
            return_value=np.zeros(32, dtype=np.float32),
        ):
            with self.assertRaisesRegex(ValueError, "im lặng"):
                decode_and_validate_audio(b"silent-mp3")
            self.assertFalse(is_valid_speech_audio(b"silent-mp3"))

    def test_edge_retries_transient_errors_with_patched_backoff(self) -> None:
        class FakeCommunicate:
            attempts = 0

            def __init__(self, *args, **kwargs):
                type(self).attempts += 1

            async def stream(self):
                if self.attempts < 3:
                    raise RuntimeError("temporary")
                yield {"type": "audio", "data": b"edge-mp3"}

        with patch("edge_tts.Communicate", FakeCommunicate), patch(
            "subtitle_localizer.dubbing.tts.asyncio.sleep", new_callable=AsyncMock
        ) as mock_sleep, patch(
            "subtitle_localizer.dubbing.tts.random.uniform", return_value=0.0
        ):
            result = asyncio.run(_synthesize_edge_tts("Xin chào", max_retries=3))

        self.assertEqual(result, b"edge-mp3")
        self.assertEqual(FakeCommunicate.attempts, 3)
        self.assertEqual(mock_sleep.await_args_list, [call(0.75), call(1.5)])

    def test_edge_zero_retries_still_makes_initial_attempt(self) -> None:
        class FakeCommunicate:
            attempts = 0

            def __init__(self, *args, **kwargs):
                type(self).attempts += 1

            async def stream(self):
                yield {"type": "audio", "data": b"edge-mp3"}

        with patch("edge_tts.Communicate", FakeCommunicate):
            result = asyncio.run(_synthesize_edge_tts("Xin chào", max_retries=0))

        self.assertEqual(result, b"edge-mp3")
        self.assertEqual(FakeCommunicate.attempts, 1)

    def test_custom_voice_pools_are_filtered_by_provider(self) -> None:
        cue = SubtitleCueV1(
            cue_id="male",
            start_pts=0.0,
            end_pts=1.0,
            translated_text="Xin chào",
            style={"speaker": "male", "speaker_id": "hero"},
        )
        selected = assign_voice_for_cue(
            cue,
            mode="multi",
            provider="gemini",
            voice="Puck",
            voice_male="Puck",
            voice_female="Kore",
            male_pool=["vi-VN-NamMinhNeural", "Puck"],
            female_pool=["BV074_streaming", "Kore"],
        )
        self.assertEqual(selected, "Puck")

        edge_selected = assign_voice_for_cue(
            cue,
            mode="multi",
            provider="edge",
            voice="vi-VN-NamMinhNeural",
            voice_male="vi-VN-NamMinhNeural",
            voice_female="vi-VN-HoaiMyNeural",
            male_pool=["BV075_streaming", "en-US-GuyNeural"],
        )
        self.assertEqual(edge_selected, "vi-VN-NamMinhNeural")

    def test_synthesize_text_uses_only_one_edge_fallback(self) -> None:
        with patch(
            "subtitle_localizer.dubbing.tts.CapCutTTSClient.synthesize",
            new_callable=AsyncMock,
            return_value=b"",
        ) as mock_capcut, patch(
            "subtitle_localizer.dubbing.tts._synthesize_edge_tts",
            new_callable=AsyncMock,
            return_value=b"fallback",
        ) as mock_edge, patch(
            "subtitle_localizer.dubbing.tts.asyncio.sleep", new_callable=AsyncMock
        ):
            result = asyncio.run(
                synthesize_text("Xin chào", provider="capcut", voice="BV075_streaming")
            )

        self.assertEqual(result, b"fallback")
        mock_capcut.assert_awaited_once()
        self.assertEqual(mock_capcut.await_args.kwargs["voice"], "BV075_streaming")
        mock_edge.assert_awaited_once()

    def test_synthesize_text_normalizes_mismatched_voice_before_dispatch(self) -> None:
        with patch(
            "subtitle_localizer.dubbing.tts.CapCutTTSClient.synthesize",
            new_callable=AsyncMock,
            return_value=b"capcut",
        ) as mock_capcut, patch(
            "subtitle_localizer.dubbing.tts.asyncio.sleep", new_callable=AsyncMock
        ):
            result = asyncio.run(
                synthesize_text(
                    "Xin chào", provider="capcut", voice="vi-VN-HoaiMyNeural"
                )
            )

        self.assertEqual(result, b"capcut")
        self.assertEqual(mock_capcut.await_args.kwargs["voice"], "BV074_streaming")

    def test_generate_rejects_zero_success_without_encoding(self) -> None:
        cue = SubtitleCueV1(
            cue_id="silent", start_pts=0.0, end_pts=1.0, translated_text="Xin chào"
        )
        with patch(
            "subtitle_localizer.dubbing.tts.synthesize_text",
            new_callable=AsyncMock,
            return_value=b"silent-mp3",
        ), patch(
            "subtitle_localizer.dubbing.tts._decode_mp3_to_pcm",
            return_value=np.zeros(100, dtype=np.float32),
        ), patch(
            "subtitle_localizer.dubbing.tts._encode_pcm_to_mp3"
        ) as mock_encode:
            with self.assertRaisesRegex(ValueError, "Không có câu TTS nào"):
                asyncio.run(generate_timed_voiceover([cue]))

        mock_encode.assert_not_called()

    def test_splice_passes_provider_and_rejects_silent_cue(self) -> None:
        cue = SubtitleCueV1(
            cue_id="c1", start_pts=0.0, end_pts=1.0, translated_text="Xin chào"
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            master = Path(temp_dir) / "master.mp3"
            cue_file = Path(temp_dir) / "cue.mp3"
            with patch(
                "subtitle_localizer.dubbing.tts.resolve_cue_voice",
                return_value="Puck",
            ) as mock_resolve, patch(
                "subtitle_localizer.dubbing.tts.synthesize_text",
                new_callable=AsyncMock,
                return_value=b"silent-mp3",
            ), patch(
                "subtitle_localizer.dubbing.tts._decode_mp3_to_pcm",
                return_value=np.zeros(100, dtype=np.float32),
            ), patch(
                "subtitle_localizer.dubbing.tts._encode_pcm_to_mp3"
            ) as mock_encode:
                with self.assertRaisesRegex(ValueError, "im lặng"):
                    asyncio.run(
                        splice_cue_voiceover(
                            [cue],
                            cue,
                            provider="gemini",
                            voice="Puck",
                            output_path=master,
                            cue_output_path=cue_file,
                        )
                    )

            self.assertEqual(mock_resolve.call_args.kwargs["provider"], "gemini")
            self.assertFalse(cue_file.exists())
            mock_encode.assert_not_called()

    def test_splice_rejects_existing_silent_master(self) -> None:
        cue = SubtitleCueV1(
            cue_id="c1", start_pts=0.0, end_pts=1.0, translated_text="Xin chào"
        )
        cue_pcm = np.full(100, 0.2, dtype=np.float32)
        silent_master = np.zeros(100, dtype=np.float32)
        with tempfile.TemporaryDirectory() as temp_dir:
            master = Path(temp_dir) / "master.mp3"
            master.write_bytes(b"existing-master")
            with patch(
                "subtitle_localizer.dubbing.tts.synthesize_text",
                new_callable=AsyncMock,
                return_value=b"cue-mp3",
            ), patch(
                "subtitle_localizer.dubbing.tts._decode_mp3_to_pcm",
                side_effect=[cue_pcm, silent_master],
            ), patch(
                "subtitle_localizer.dubbing.tts._encode_pcm_to_mp3"
            ) as mock_encode:
                with self.assertRaisesRegex(ValueError, "Master voiceover hiện có"):
                    asyncio.run(
                        splice_cue_voiceover([cue], cue, output_path=master)
                    )

            mock_encode.assert_not_called()

    def test_generate_enforces_provider_concurrency_limits(self) -> None:
        limits = {"edge": 1, "capcut": 1, "gemini": 4}
        real_sleep = asyncio.sleep

        for provider, limit in limits.items():
            from subtitle_localizer.dubbing.tts import set_provider_concurrency
            set_provider_concurrency(provider, limit)
            active = 0
            peak = 0

            async def fake_edge(*args, **kwargs):
                nonlocal active, peak
                active += 1
                peak = max(peak, active)
                await real_sleep(0)
                active -= 1
                return b"audio"

            async def fake_capcut(*args, **kwargs):
                return await fake_edge()

            async def fake_gemini(*args, **kwargs):
                return await fake_edge()

            voice = {
                "edge": "vi-VN-NamMinhNeural",
                "capcut": "BV075_streaming",
                "gemini": "Puck",
            }[provider]
            async def run_all():
                return await asyncio.gather(
                    *(
                        synthesize_text(f"Câu {index}", provider=provider, voice=voice)
                        for index in range(8)
                    )
                )

            with patch(
                "subtitle_localizer.dubbing.tts._synthesize_edge_tts",
                new=fake_edge,
            ), patch(
                "subtitle_localizer.dubbing.tts.CapCutTTSClient.synthesize",
                new=fake_capcut,
            ), patch(
                "subtitle_localizer.dubbing.tts.GeminiTTSClient.synthesize",
                new=fake_gemini,
            ), patch(
                "subtitle_localizer.dubbing.tts.apply_speaking_rate_to_audio",
                side_effect=lambda data, rate: data,
            ), patch(
                "subtitle_localizer.dubbing.tts.asyncio.sleep", new_callable=AsyncMock
            ):
                asyncio.run(run_all())

            self.assertLessEqual(peak, limit, provider)
            self.assertEqual(peak, limit, provider)

        from subtitle_localizer.dubbing.tts import set_provider_concurrency
        set_provider_concurrency("edge", 4)
        set_provider_concurrency("capcut", 2)
        set_provider_concurrency("gemini", 4)


if __name__ == "__main__":
    unittest.main()
