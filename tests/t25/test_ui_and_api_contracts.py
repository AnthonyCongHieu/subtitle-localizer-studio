# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from fastapi.testclient import TestClient
from subtitle_localizer.service.server import create_app


class T25UiSourceContractsTest(unittest.TestCase):
    def test_rate_slider_exists_in_global_settings(self) -> None:
        text = (REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "GlobalSettingsView.tsx").read_text(encoding="utf-8")
        self.assertIn("Tốc Độ Đọc (Speech Rate)", text)
        self.assertIn('type="range"', text)
        self.assertIn("min={-30}", text)
        self.assertIn("max={40}", text)

    def test_volume_helpers_shared(self) -> None:
        util = (REPOSITORY_ROOT / "web" / "src" / "utils" / "audioVolume.ts").read_text(encoding="utf-8")
        app = (REPOSITORY_ROOT / "web" / "src" / "App.tsx").read_text(encoding="utf-8")
        timeline = (REPOSITORY_ROOT / "web" / "src" / "components" / "timeline" / "BottomTimeline.tsx").read_text(encoding="utf-8")
        self.assertIn("VOICEOVER_VOLUME_KEY", util)
        self.assertIn("ORIGINAL_AUDIO_VOLUME_KEY", util)
        self.assertIn("toAudioGain", util)
        self.assertIn("utils/audioVolume", app)
        self.assertIn("utils/audioVolume", timeline)
        self.assertNotIn("sls_voiceover_volume", app)


class T25ApiGenderMultiAliasTest(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app()
        self.client = TestClient(self.app)

    @patch("subtitle_localizer.dubbing.tts.generate_timed_voiceover")
    def test_gender_multi_alias_normalized_to_multi(self, mock_tts) -> None:
        def fake_synth(*args, **kwargs):
            out = Path(kwargs["output_path"])
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(b"ID3dummy")
            # mode reaching TTS must be multi
            self.assertEqual(kwargs.get("mode"), "multi")
            return out

        mock_tts.side_effect = fake_synth
        create_res = self.client.post("/api/v1/projects", json={
            "title": "T25 Gender Multi Alias",
            "source_video_path": "test_video.mp4",
        })
        self.assertEqual(create_res.status_code, 200)
        project_id = create_res.json()["project_id"]
        self.client.put(f"/api/v1/projects/{project_id}/cues", json=[
            {
                "cue_id": "c1",
                "start_pts": 0.0,
                "end_pts": 1.2,
                "source_text": "你好",
                "translated_text": "Xin chào",
                "style": {"speaker": "female", "speaker_id": "nu_chinh"},
                "confidence": 1.0,
                "revision": 1,
                "status": "auto",
            }
        ])
        with patch("subtitle_localizer.dubbing.tts.is_valid_speech_audio", return_value=True):
            dub_res = self.client.post(f"/api/v1/projects/{project_id}/dubbing/run", json={
                "mode": "gender_multi",
                "voice_male": "vi-VN-NamMinhNeural",
                "voice_female": "vi-VN-HoaiMyNeural",
                "provider": "edge",
            })
        self.assertEqual(dub_res.status_code, 200, dub_res.text)
        body = dub_res.json()
        self.assertEqual(body["mode"], "multi")
        self.assertGreaterEqual(body.get("required_voices", 0), 1)
        get_res = self.client.get(f"/api/v1/projects/{project_id}")
        saved_mode = get_res.json()["custom_pipeline_settings"]["dubbing"]["mode"]
        self.assertEqual(saved_mode, "multi")


if __name__ == "__main__":
    unittest.main()
