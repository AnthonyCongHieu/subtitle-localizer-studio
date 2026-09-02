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
        self.assertTrue((web_dir / "src" / "api" / "client.ts").exists())
        self.assertTrue((web_dir / "src" / "components" / "layout" / "AppLayout.tsx").exists())

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


if __name__ == "__main__":
    unittest.main()
