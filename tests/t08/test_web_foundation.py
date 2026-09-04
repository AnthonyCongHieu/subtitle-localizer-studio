import json
import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class WebFoundationTest(unittest.TestCase):
    def test_web_directory_structure_exists(self) -> None:
        web_dir = REPOSITORY_ROOT / "web"
        self.assertTrue((web_dir / "package.json").exists())
        self.assertTrue((web_dir / "tsconfig.json").exists())
        self.assertTrue((web_dir / "vite.config.ts").exists())
        self.assertTrue((web_dir / "src" / "types" / "api.ts").exists())
        self.assertTrue((web_dir / "src" / "types" / "presets.ts").exists())
        self.assertTrue((web_dir / "src" / "api" / "client.ts").exists())
        self.assertTrue((web_dir / "src" / "components" / "layout" / "AppLayout.tsx").exists())
        self.assertTrue((web_dir / "src" / "components" / "project" / "DashboardBatchHub.tsx").exists())
        self.assertTrue((web_dir / "src" / "components" / "project" / "PresetManagerModal.tsx").exists())
        self.assertTrue((web_dir / "src" / "components" / "project" / "NewProjectModal.tsx").exists())
        self.assertTrue((web_dir / "src" / "components" / "player" / "VideoPlayer.tsx").exists())
        self.assertTrue((web_dir / "src" / "components" / "player" / "ViewerToolbar.tsx").exists())
        self.assertTrue((web_dir / "src" / "components" / "timeline" / "BottomTimeline.tsx").exists())

    def test_package_json_validity(self) -> None:
        pkg_file = REPOSITORY_ROOT / "web" / "package.json"
        data = json.loads(pkg_file.read_text(encoding="utf-8"))
        self.assertEqual(data["name"], "subtitle-localizer-web")
        self.assertIn("react", data["dependencies"])
        self.assertIn("vite", data["devDependencies"])

    def test_typescript_contracts_include_v1_models(self) -> None:
        ts_file = REPOSITORY_ROOT / "web" / "src" / "types" / "api.ts"
        content = ts_file.read_text(encoding="utf-8")
        self.assertIn("export interface SubtitleCueV1", content)
        self.assertIn("export interface ProjectManifestV1", content)
        self.assertIn("export interface RegionTrackV1", content)
        self.assertIn("export interface BridgeEventV1", content)

    def test_preset_profiles_contract_and_defaults(self) -> None:
        presets_file = REPOSITORY_ROOT / "web" / "src" / "types" / "presets.ts"
        content = presets_file.read_text(encoding="utf-8")
        self.assertIn("export interface PresetProfile", content)
        self.assertIn("export type AspectRatioType", content)
        self.assertIn("export const BUILTIN_PRESETS", content)
        self.assertIn("16:9", content)
        self.assertIn("9:16", content)
        self.assertIn("1:1", content)

    def test_batch_video_card_interactive_roi_and_realtime_subtitles(self) -> None:
        hub_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DashboardBatchHub.tsx"
        content = hub_file.read_text(encoding="utf-8")
        # 1. ROI bounding box removed (R4) — replaced with clean subtitle banner
        #    Verify old ROI handles are NOT present
        self.assertNotIn("cursor-nwse-resize", content)
        self.assertNotIn("cursor-nesw-resize", content)

        # 2. Đồng bộ phụ đề thật thời gian thực
        self.assertIn("getCues", content)
        self.assertIn("activeCue", content)
        self.assertIn("renderSubtitleText", content)

        # 3. Mini scrubber tua video
        self.assertIn("group/scrubber", content)

    def test_batch_delete_and_url_download_ui_contracts(self) -> None:
        # Check UrlDownloadModal exists
        modal_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "UrlDownloadModal.tsx"
        self.assertTrue(modal_file.exists())
        modal_content = modal_file.read_text(encoding="utf-8")
        self.assertIn("parseDownloadTarget", modal_content)
        self.assertIn("startDownload", modal_content)
        self.assertIn("getDownloadStatus", modal_content)
        self.assertIn("Hồng Quả", modal_content)

        # Check DashboardBatchHub has batch delete and download from link
        hub_file = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DashboardBatchHub.tsx"
        hub_content = hub_file.read_text(encoding="utf-8")
        self.assertIn("batchDeleteProjects", hub_content)
        self.assertIn("Xóa tất cả", hub_content)
        self.assertIn("Xóa đã chọn", hub_content)
        self.assertIn("Tải từ Link", hub_content)
        self.assertIn("UrlDownloadModal", hub_content)


if __name__ == "__main__":
    unittest.main()
