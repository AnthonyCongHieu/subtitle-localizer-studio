import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.cloud.capcut_bridge import CapCutBridgeExtractor
from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.server import create_app
from fastapi.testclient import TestClient


class CapCutDraftSyncTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.temp_root = Path(self.temp_dir.name)
        self.db_path = self.temp_root / "test_capcut.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.app = create_app(database=self.db, repo=self.repo, output_root=self.temp_root / "outputs")
        self.client = TestClient(self.app)

    def tearDown(self) -> None:
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def _create_mock_draft(self, project_dir: Path, name: str, cues: list, duration_us: int = 15000000) -> Path:
        project_dir.mkdir(parents=True, exist_ok=True)
        meta_file = project_dir / "draft_meta_info.json"
        content_file = project_dir / "draft_content.json"

        meta_data = {
            "draft_name": name,
            "tm_draft_modified": 1773734400000000,
            "tm_duration": duration_us,
        }
        meta_file.write_text(json.dumps(meta_data, ensure_ascii=False), encoding="utf-8")

        texts = []
        segments = []
        for idx, c in enumerate(cues):
            tid = f"text_{idx}"
            texts.append({"id": tid, "content": c["text"]})
            segments.append({
                "material_id": tid,
                "target_timerange": {
                    "start": int(c["start"] * 1000000),
                    "duration": int((c["end"] - c["start"]) * 1000000),
                }
            })

        content_data = {
            "materials": {"texts": texts},
            "tracks": [{"type": "text", "segments": segments}],
        }
        content_file.write_text(json.dumps(content_data, ensure_ascii=False), encoding="utf-8")
        return content_file

    def test_list_recent_drafts(self) -> None:
        extractor = CapCutBridgeExtractor()
        capcut_dir = self.temp_root / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
        
        # Tạo 2 dự án mock
        p1 = capcut_dir / "Project_01"
        self._create_mock_draft(p1, "Tập 01 Phim Ngắn", [
            {"start": 1.0, "end": 2.5, "text": "Xin chào các bạn"},
            {"start": 3.0, "end": 5.0, "text": "Hôm nay trời rất đẹp"},
        ])
        p2 = capcut_dir / "Project_02_Empty"
        self._create_mock_draft(p2, "Dự Án Chưa Có Sub", [])

        with patch.object(extractor, "_get_capcut_draft_base_dir", return_value=capcut_dir):
            drafts = extractor.list_recent_drafts(limit=10)
            self.assertGreaterEqual(len(drafts), 2)
            
            # Tìm draft Tập 01
            d1 = next((d for d in drafts if d["id"] == "Project_01"), None)
            self.assertIsNotNone(d1)
            self.assertEqual(d1["name"], "Tập 01 Phim Ngắn")
            self.assertEqual(d1["cue_count"], 2)
            self.assertEqual(len(d1["preview_cues"]), 2)
            self.assertEqual(d1["preview_cues"][0], "Xin chào các bạn")

    def test_parse_draft_json_strips_xml_and_unescapes(self) -> None:
        extractor = CapCutBridgeExtractor()
        draft_dir = self.temp_root / "test_xml_draft"
        content_file = self._create_mock_draft(draft_dir, "XML Test", [
            {"start": 0.5, "end": 2.0, "text": '<font size="16" color="#FF0000">T.H.I T.H.Ể &quot;HIỆN TRƯỜNG&quot;</font>'},
            {"start": 2.5, "end": 4.0, "text": '<color=#ffffff><size=20>19 GIỜ TỐI\nNGÀY 10 THÁNG 3</size></color>'},
        ])

        parsed = extractor.parse_draft_json(content_file)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["text"], 'T.H.I T.H.Ể "HIỆN TRƯỜNG"')
        self.assertEqual(parsed[1]["text"], '19 GIỜ TỐI\nNGÀY 10 THÁNG 3')

    def test_extract_cues_with_explicit_draft(self) -> None:
        extractor = CapCutBridgeExtractor()
        draft_dir = self.temp_root / "explicit_draft"
        content_file = self._create_mock_draft(draft_dir, "Explicit Test", [
            {"start": 1.1, "end": 3.3, "text": "Phụ đề test explicit"},
        ])

        fake_video = self.temp_root / "fake_vid.mp4"
        fake_video.write_bytes(b"dummy")

        cues = extractor.extract_cues(fake_video, draft_path=content_file)
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].source_text, "Phụ đề test explicit")
        self.assertAlmostEqual(cues[0].start_pts, 1.1, places=2)
        self.assertIn("capcut_draft_extracted", cues[0].quality_flags)

    def test_get_capcut_drafts_api_endpoint(self) -> None:
        capcut_dir = self.temp_root / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
        p = capcut_dir / "API_Draft"
        self._create_mock_draft(p, "Dự Án API Test", [
            {"start": 0.0, "end": 1.5, "text": "Câu test API 1"},
        ])

        with patch("subtitle_localizer.cloud.capcut_bridge.CapCutBridgeExtractor._get_capcut_draft_base_dir", return_value=capcut_dir):
            resp = self.client.get("/api/v1/settings/capcut-drafts")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data.get("installed"))
            drafts = data.get("drafts", [])
            self.assertGreaterEqual(len(drafts), 1)
            self.assertEqual(drafts[0]["name"], "Dự Án API Test")
            self.assertEqual(drafts[0]["cue_count"], 1)

    def test_import_capcut_draft_into_project_api(self) -> None:
        capcut_dir = self.temp_root / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
        p = capcut_dir / "Import_Draft_123"
        content_path = self._create_mock_draft(p, "Import Project", [
            {"start": 2.0, "end": 4.5, "text": "Dòng phụ đề nhập vào"},
        ])

        # Tạo project manifest
        manifest = ProjectManifestV1(
            project_id="prj_import_test",
            title="Import Test",
            source_video_path=str(self.temp_root / "dummy.mp4"),
            video_fingerprint="fp_test",
            source_language="auto",
            target_language="vi",
        )
        self.repo.save_project(manifest)

        with patch("subtitle_localizer.cloud.capcut_bridge.CapCutBridgeExtractor._get_capcut_draft_base_dir", return_value=capcut_dir):
            resp = self.client.post(
                "/api/v1/projects/prj_import_test/import-capcut-draft",
                json={"draft_id": "Import_Draft_123"},
            )
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data.get("status") == "success")
            self.assertEqual(data.get("imported_count"), 1)

            # Kiểm tra trong repository
            saved_cues = self.repo.get_cues("prj_import_test")
            self.assertEqual(len(saved_cues), 1)
            self.assertEqual(saved_cues[0].source_text, "Dòng phụ đề nhập vào")
            self.assertEqual(saved_cues[0].start_pts, 2.0)
            self.assertEqual(saved_cues[0].end_pts, 4.5)


if __name__ == "__main__":
    unittest.main()
