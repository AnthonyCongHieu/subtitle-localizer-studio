import sys
import unittest
from pathlib import Path

import numpy as np

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.dubbing.tts import (
    AVAILABLE_VOICES,
    _decode_mp3_to_pcm,
    _encode_pcm_to_mp3,
    calculate_slot_stretch,
    clean_subtitle_text,
    generate_voiceover_sync,
    time_stretch_pcm,
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
            with patch("subtitle_localizer.dubbing.tts.synthesize_text", new_callable=AsyncMock) as mock_synth:
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

                # Thư mục individual cues chỉ chứa 1 file duy nhất cho câu hợp lệ
                exported_files = list(cues_dir.glob("*.mp3"))
                self.assertEqual(len(exported_files), 1)
        finally:
            if out_voiceover.exists():
                out_voiceover.unlink(missing_ok=True)
            if cues_dir.exists():
                import shutil
                shutil.rmtree(cues_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
