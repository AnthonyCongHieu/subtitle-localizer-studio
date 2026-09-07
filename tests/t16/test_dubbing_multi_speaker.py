import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.dubbing.tts import detect_cue_speaker
from subtitle_localizer.service.pipeline_settings import DubbingSettings, GlobalPipelineSettings


class MultiSpeakerDubbingTest(unittest.TestCase):
    def test_dubbing_settings_defaults(self) -> None:
        dub = DubbingSettings()
        self.assertEqual(dub.mode, "single")
        self.assertEqual(dub.voice, "vi-VN-NamMinhNeural")
        self.assertEqual(dub.voice_male, "vi-VN-NamMinhNeural")
        self.assertEqual(dub.voice_female, "vi-VN-HoaiMyNeural")
        self.assertTrue(dub.auto_detect_speakers)

    def test_dubbing_settings_multi_mode(self) -> None:
        dub = DubbingSettings(mode="multi", voice_male="vi-VN-NamMinhNeural", voice_female="vi-VN-HoaiMyNeural")
        self.assertEqual(dub.mode, "multi")
        self.assertEqual(dub.voice_male, "vi-VN-NamMinhNeural")
        self.assertEqual(dub.voice_female, "vi-VN-HoaiMyNeural")

    def test_detect_cue_speaker_from_style(self) -> None:
        cue_f = SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, style={"speaker": "female"})
        self.assertEqual(detect_cue_speaker(cue_f, "Xin chào"), "female")

        cue_m = SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, style={"speaker": "male"})
        self.assertEqual(detect_cue_speaker(cue_m, "Chào em"), "male")

    def test_detect_cue_speaker_from_character_tags(self) -> None:
        cue_female_tag = SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="[Nữ] Em không muốn đi đâu")
        self.assertEqual(detect_cue_speaker(cue_female_tag, "Em không muốn đi đâu"), "female")

        cue_male_tag = SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="[Nam] Để anh chở em đi")
        self.assertEqual(detect_cue_speaker(cue_male_tag, "Để anh chở em đi"), "male")

    def test_detect_cue_speaker_from_dialogue_pronouns(self) -> None:
        cue_f = SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0)
        speaker_f = detect_cue_speaker(cue_f, "Anh ơi em về rồi nè")
        self.assertEqual(speaker_f, "female")

        cue_m = SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0)
        speaker_m = detect_cue_speaker(cue_m, "Em ơi anh đây rồi")
        self.assertEqual(speaker_m, "male")


if __name__ == "__main__":
    unittest.main()
