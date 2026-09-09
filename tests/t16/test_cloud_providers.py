import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.cloud.capcut_bridge import CapCutBridgeExtractor
from subtitle_localizer.cloud.gemini_vlm import GeminiVideoVlmExtractor
from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.pipeline_settings import (
    GlobalPipelineSettings,
    OcrSettings,
    get_global_pipeline_settings,
    set_global_pipeline_settings,
)
from subtitle_localizer.service.worker import BackgroundWorker


class CloudProvidersTest(unittest.TestCase):
    def setUp(self) -> None:
        self.old_settings = get_global_pipeline_settings()
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.temp_dir.name) / "test_cloud.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)

    def tearDown(self) -> None:
        set_global_pipeline_settings(self.old_settings)
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    # ================= 1. GEMINI VIDEO VLM TESTS =================
    def test_gemini_parse_subtitles_json(self) -> None:
        extractor = GeminiVideoVlmExtractor()
        raw_json = """```json
[
  {"start": 1.25, "end": 3.40, "text": "你好，好雨知时节"},
  {"start": 4.10, "end": 6.80, "text": "当春乃发生"}
]
```"""
        parsed = extractor._parse_subtitles_from_text(raw_json)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["start"], 1.25)
        self.assertEqual(parsed[0]["end"], 3.4)
        self.assertEqual(parsed[0]["text"], "你好，好雨知时节")
        self.assertEqual(parsed[1]["text"], "当春乃发生")

    def test_gemini_parse_subtitles_srt(self) -> None:
        extractor = GeminiVideoVlmExtractor()
        raw_srt = """1
00:00:01,250 --> 00:00:03,400
随风潜入夜

2
00:00:04,100 --> 00:00:06,800
润物细无声
"""
        parsed = extractor._parse_subtitles_from_text(raw_srt)
        self.assertEqual(len(parsed), 2)
        self.assertAlmostEqual(parsed[0]["start"], 1.25, places=2)
        self.assertAlmostEqual(parsed[0]["end"], 3.4, places=2)
        self.assertEqual(parsed[0]["text"], "随风潜入夜")
        self.assertEqual(parsed[1]["text"], "润物细无声")

    def test_gemini_missing_video_raises_file_not_found(self) -> None:
        extractor = GeminiVideoVlmExtractor()
        with self.assertRaises(FileNotFoundError):
            extractor.extract_cues(Path("non_existent_video_path_123.mp4"))

    # ================= 2. CAPCUT BRIDGE TESTS =================
    def test_capcut_parse_draft_json(self) -> None:
        extractor = CapCutBridgeExtractor()
        mock_draft = {
            "materials": {
                "texts": [
                    {"id": "text_1", "content": "<size=15><color=#ffffff>今天的天气真好</color></size>"},
                    {"id": "text_2", "content": '{"text": "我们一起去公园吧"}'},
                ]
            },
            "tracks": [
                {
                    "type": "text",
                    "name": "subtitle_track",
                    "segments": [
                        {
                            "material_id": "text_1",
                            "target_timerange": {"start": 1000000, "duration": 2500000},
                        },
                        {
                            "material_id": "text_2",
                            "target_timerange": {"start": 4000000, "duration": 2000000},
                        },
                    ],
                }
            ],
        }
        draft_file = Path(self.temp_dir.name) / "draft_content.json"
        draft_file.write_text(json.dumps(mock_draft, ensure_ascii=False), encoding="utf-8")

        parsed = extractor.parse_draft_json(draft_file)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["start"], 1.0)
        self.assertEqual(parsed[0]["end"], 3.5)
        self.assertEqual(parsed[0]["text"], "今天的天气真好")
        self.assertEqual(parsed[1]["start"], 4.0)
        self.assertEqual(parsed[1]["end"], 6.0)
        self.assertEqual(parsed[1]["text"], "我们一起去公园吧")

    def test_capcut_nonexistent_draft_returns_empty(self) -> None:
        extractor = CapCutBridgeExtractor()
        parsed = extractor.parse_draft_json(Path("non_existent_draft_999.json"))
        self.assertEqual(parsed, [])

    # ================= 4. WORKER CLOUD INTEGRATION TESTS =================
    def test_worker_dispatches_gemini_in_mode_api(self) -> None:
        video_path = Path(self.temp_dir.name) / "worker_video.mp4"
        video_path.write_bytes(b"dummy_video_bytes")

        manifest = ProjectManifestV1(
            project_id="test_cloud_gemini",
            title="Gemini Test Project",
            source_video_path=str(video_path),
            video_fingerprint="fp_gemini",
            source_language="auto",
            target_language="none",
        )
        self.repo.save_project(manifest)

        mock_cues = [
            SubtitleCueV1(
                cue_id="gemini_cue_1",
                start_pts=1.0,
                end_pts=3.5,
                source_text="好雨知时节",
                quality_flags=["cloud_vlm_extracted"],
            )
        ]

        # Set pipeline settings to Mode API with Gemini
        settings = GlobalPipelineSettings(
            ocr=OcrSettings(mode="api", api_provider="gemini")
        )
        set_global_pipeline_settings(settings)

        worker = BackgroundWorker(self.repo)
        with patch("subtitle_localizer.cloud.gemini_vlm.GeminiVideoVlmExtractor.extract_cues", return_value=mock_cues):
            success = worker.run_pipeline_synchronous("test_cloud_gemini")
            self.assertTrue(success)

            saved_cues = self.repo.get_cues("test_cloud_gemini")
            self.assertEqual(len(saved_cues), 1)
            self.assertEqual(saved_cues[0].source_text, "好雨知时节")

            # Check language auto-detection
            updated_manifest = self.repo.get_project("test_cloud_gemini")
            self.assertEqual(updated_manifest.source_language, "zh")


if __name__ == "__main__":
    unittest.main()
