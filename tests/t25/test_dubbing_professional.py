# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import numpy as np

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.dubbing.tts import (
    assign_voice_for_cue,
    cues_truly_overlap,
    detect_cue_speaker,
    detect_speaker_identity,
    estimate_speech_seconds,
    is_skip_tts_role,
    mix_voice_pcm,
    normalize_dubbing_mode,
    required_voices_count,
    resolve_cue_voice,
)


class T25DubbingProfessionalTest(unittest.TestCase):
    def test_normalize_dubbing_mode_aliases(self) -> None:
        self.assertEqual(normalize_dubbing_mode("single"), "single")
        self.assertEqual(normalize_dubbing_mode("multi"), "multi")
        self.assertEqual(normalize_dubbing_mode("gender_multi"), "multi")
        self.assertEqual(normalize_dubbing_mode("MULTI"), "multi")
        self.assertEqual(normalize_dubbing_mode(None), "single")

    def test_crowd_role_is_skipped(self) -> None:
        cue = SubtitleCueV1(
            cue_id="c1",
            start_pts=0.0,
            end_pts=1.0,
            translated_text="Hoan hô!",
            style={"speaker_role": "crowd"},
        )
        identity = detect_speaker_identity(cue, cue.translated_text)
        self.assertEqual(identity["speaker_role"], "crowd")
        self.assertTrue(is_skip_tts_role(identity["speaker_role"]))

    def test_crowd_keywords_detected_from_text(self) -> None:
        cue = SubtitleCueV1(cue_id="c2", start_pts=0.0, end_pts=1.0, source_text="[Quần chúng] Giết hắn!")
        identity = detect_speaker_identity(cue, "Giết hắn!")
        self.assertEqual(identity["speaker_role"], "crowd")
        self.assertTrue(is_skip_tts_role(identity["speaker_role"]))

    def test_same_gender_characters_get_different_voices(self) -> None:
        female_pool = ["vi-VN-HoaiMyNeural", "en-US-JennyNeural", "en-US-AriaNeural"]
        cue_a = SubtitleCueV1(
            cue_id="a",
            start_pts=0.0,
            end_pts=1.0,
            translated_text="Em đây",
            style={"speaker": "female", "speaker_id": "nu_chinh"},
        )
        cue_b = SubtitleCueV1(
            cue_id="b",
            start_pts=1.0,
            end_pts=2.0,
            translated_text="Mẹ bảo",
            style={"speaker": "female", "speaker_id": "me"},
        )
        voice_a = assign_voice_for_cue(
            cue_a,
            mode="multi",
            voice="vi-VN-NamMinhNeural",
            voice_male="vi-VN-NamMinhNeural",
            voice_female="vi-VN-HoaiMyNeural",
            female_pool=female_pool,
            male_pool=["vi-VN-NamMinhNeural"],
        )
        voice_b = assign_voice_for_cue(
            cue_b,
            mode="multi",
            voice="vi-VN-NamMinhNeural",
            voice_male="vi-VN-NamMinhNeural",
            voice_female="vi-VN-HoaiMyNeural",
            female_pool=female_pool,
            male_pool=["vi-VN-NamMinhNeural"],
        )
        self.assertNotEqual(voice_a, voice_b)
        self.assertIn(voice_a, female_pool)
        self.assertIn(voice_b, female_pool)

    def test_required_voices_ignores_crowd(self) -> None:
        cues = [
            SubtitleCueV1(cue_id="1", start_pts=0, end_pts=1, style={"speaker_id": "nam_chinh", "speaker": "male"}),
            SubtitleCueV1(cue_id="2", start_pts=1, end_pts=2, style={"speaker_id": "nu_chinh", "speaker": "female"}),
            SubtitleCueV1(cue_id="3", start_pts=2, end_pts=3, style={"speaker_id": "crowd_1", "speaker_role": "crowd"}),
            SubtitleCueV1(cue_id="4", start_pts=3, end_pts=4, style={"speaker_id": "nam_chinh", "speaker": "male"}),
        ]
        self.assertEqual(required_voices_count(cues, mode="multi"), 2)
        self.assertEqual(required_voices_count(cues, mode="single"), 1)

    def test_unknown_speaker_does_not_force_male_when_style_unknown(self) -> None:
        cue = SubtitleCueV1(cue_id="u", start_pts=0, end_pts=1, translated_text="Được thôi", style={"speaker": "unknown"})
        self.assertEqual(detect_cue_speaker(cue, "Được thôi", default="unknown"), "unknown")

    def test_true_overlap_detection(self) -> None:
        a = SubtitleCueV1(cue_id="a", start_pts=0.0, end_pts=2.0, style={"speaker_id": "a"})
        b = SubtitleCueV1(cue_id="b", start_pts=1.0, end_pts=3.0, style={"speaker_id": "b"})
        c = SubtitleCueV1(cue_id="c", start_pts=2.0, end_pts=3.0, style={"speaker_id": "c"})
        self.assertTrue(cues_truly_overlap(a, b))
        self.assertFalse(cues_truly_overlap(a, c))

    def test_multi_no_spill_when_not_true_overlap(self) -> None:
        master = np.zeros(44100 * 4, dtype=np.float32)
        pcm = np.ones(44100 * 2, dtype=np.float32) * 0.5  # 2s audio
        # Sequential cues: next starts at 1.0s, not true overlap placement path
        master = mix_voice_pcm(
            master,
            pcm,
            start_sample=0,
            mode="multi",
            next_start_sample=44100,
            allow_overlap=False,
        )
        # Must be trimmed near 1s, not fully 2s additive into next slot
        self.assertLess(float(np.max(np.abs(master[44100 + 1000:]))), 0.01)
        self.assertGreater(float(np.max(np.abs(master[:40000]))), 0.4)

    def test_estimate_speech_seconds_scales_with_text(self) -> None:
        short = estimate_speech_seconds("Xin chào")
        long = estimate_speech_seconds("Xin chào các bạn, hôm nay chúng ta sẽ nói về một câu chuyện rất dài và chi tiết")
        self.assertGreater(long, short)
        self.assertGreater(short, 0.2)

    def test_resolve_cue_voice_single_mode(self) -> None:
        cue = SubtitleCueV1(cue_id="s", start_pts=0, end_pts=1, style={"speaker": "female", "speaker_id": "nu"})
        voice = resolve_cue_voice(
            cue,
            text="Em đây",
            mode="single",
            voice="vi-VN-NamMinhNeural",
            voice_male="vi-VN-NamMinhNeural",
            voice_female="vi-VN-HoaiMyNeural",
        )
        self.assertEqual(voice, "vi-VN-NamMinhNeural")


class T25VolumeKeyContractTest(unittest.TestCase):
    def test_volume_storage_keys_are_unified_in_web_sources(self) -> None:
        app = (REPOSITORY_ROOT / "web" / "src" / "App.tsx").read_text(encoding="utf-8")
        timeline = (REPOSITORY_ROOT / "web" / "src" / "BottomTimeline.tsx")
        # BottomTimeline lives under components/timeline
        timeline = (REPOSITORY_ROOT / "web" / "src" / "components" / "timeline" / "BottomTimeline.tsx").read_text(encoding="utf-8")
        util = REPOSITORY_ROOT / "web" / "src" / "utils" / "audioVolume.ts"
        self.assertTrue(util.exists(), "web/src/utils/audioVolume.ts must exist")
        util_text = util.read_text(encoding="utf-8")
        self.assertIn("studio_voiceover_volume", util_text)
        self.assertIn("studio_original_audio_volume", util_text)
        self.assertNotIn("sls_voiceover_volume", app)
        self.assertTrue(("VOICEOVER_VOLUME_KEY" in app) or ("studio_voiceover_volume" in app))
        self.assertTrue(("VOICEOVER_VOLUME_KEY" in timeline) or ("studio_voiceover_volume" in timeline))
        self.assertIn("utils/audioVolume", timeline)


if __name__ == "__main__":
    unittest.main()
