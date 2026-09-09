import sys
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1
from subtitle_localizer.service.server import create_app


class DubbingModesEndpointTest(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = TestClient(self.app)

    @patch("subtitle_localizer.dubbing.tts.generate_timed_voiceover")
    def test_run_dubbing_single_mode_saves_settings(self, mock_tts):
        def fake_synth(*args, **kwargs):
            out = kwargs.get("output_path")
            if out:
                Path(out).write_bytes(b"dummy_mp3_data")
            return Path(out) if out else Path("dummy_voiceover.mp3")

        mock_tts.side_effect = fake_synth

        # Tạo dự án mẫu
        create_res = self.client.post("/api/v1/projects", json={
            "title": "Test Single Voice Video",
            "source_video_path": "test_video.mp4",
        })
        self.assertEqual(create_res.status_code, 200)
        project_id = create_res.json()["project_id"]

        # Thêm câu phụ đề mẫu
        self.client.put(f"/api/v1/projects/{project_id}/cues", json=[
            {"cue_id": "c1", "start_pts": 0.0, "end_pts": 1.5, "source_text": "Hello", "translated_text": "Xin chào bạn", "confidence": 1.0, "revision": 1, "status": "auto"}
        ])

        # Gọi run dubbing với mode single và giọng cụ thể
        dub_res = self.client.post(f"/api/v1/projects/{project_id}/dubbing/run", json={
            "mode": "single",
            "voice": "vi-VN-NamMinhNeural",
            "provider": "edge",
            "rate": "+10%",
        })
        self.assertEqual(dub_res.status_code, 200)
        data = dub_res.json()
        self.assertEqual(data["status"], "completed")

        # Kiểm tra manifest của dự án đã được lưu cấu hình riêng cho tập
        get_res = self.client.get(f"/api/v1/projects/{project_id}")
        self.assertEqual(get_res.status_code, 200)
        manifest = get_res.json()
        self.assertTrue(manifest["has_voiceover"])
        self.assertIn("custom_pipeline_settings", manifest)
        dub_settings = manifest["custom_pipeline_settings"].get("dubbing", {})
        self.assertEqual(dub_settings.get("mode"), "single")
        self.assertEqual(dub_settings.get("voice"), "vi-VN-NamMinhNeural")
        self.assertEqual(dub_settings.get("rate"), "+10%")

    @patch("subtitle_localizer.dubbing.tts.generate_timed_voiceover")
    def test_run_dubbing_multi_mode_saves_settings(self, mock_tts):
        dummy = Path(tempfile.gettempdir()) / "subtitle_localizer_dummy_voiceover.mp3"
        dummy.write_bytes(b"ID3\x04\x00\x00\x00\x00\x00\x00")
        mock_tts.return_value = dummy

        # Tạo dự án mẫu thứ 2
        create_res = self.client.post("/api/v1/projects", json={
            "title": "Test Multi Voice Drama",
            "source_video_path": "test_drama.mp4",
        })
        self.assertEqual(create_res.status_code, 200)
        project_id = create_res.json()["project_id"]

        # Thêm câu phụ đề mẫu
        self.client.put(f"/api/v1/projects/{project_id}/cues", json=[
            {"cue_id": "c1", "start_pts": 0.0, "end_pts": 1.5, "source_text": "Hi", "translated_text": "Chào anh", "confidence": 1.0, "revision": 1, "status": "auto"}
        ])

        # Gọi run dubbing với mode multi và phân vai Nam/Nữ
        dub_res = self.client.post(f"/api/v1/projects/{project_id}/dubbing/run", json={
            "mode": "multi",
            "voice_male": "vi-VN-NamMinhNeural",
            "voice_female": "vi-VN-HoaiMyNeural",
            "provider": "edge",
        })
        self.assertEqual(dub_res.status_code, 200)

        # Kiểm tra cấu hình riêng của tập thứ 2 độc lập hoàn toàn
        get_res = self.client.get(f"/api/v1/projects/{project_id}")
        self.assertEqual(get_res.status_code, 200)
        manifest = get_res.json()
        dub_settings = manifest["custom_pipeline_settings"].get("dubbing", {})
        self.assertEqual(dub_settings.get("mode"), "multi")
        self.assertEqual(dub_settings.get("voice_male"), "vi-VN-NamMinhNeural")
        self.assertEqual(dub_settings.get("voice_female"), "vi-VN-HoaiMyNeural")


if __name__ == "__main__":
    unittest.main()
