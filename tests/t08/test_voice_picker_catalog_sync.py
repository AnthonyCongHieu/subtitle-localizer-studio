import re
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CATALOG_FILE = REPOSITORY_ROOT / "web" / "src" / "constants" / "voiceCatalog.ts"
PICKER_FILE = REPOSITORY_ROOT / "web" / "src" / "components" / "common" / "VoiceCatalogPicker.tsx"
SIDEBAR_FILE = REPOSITORY_ROOT / "web" / "src" / "components" / "sidebar" / "LeftMediaSidebar.tsx"
HUB_FILE = REPOSITORY_ROOT / "web" / "src" / "components" / "project" / "DashboardBatchHub.tsx"

CATALOG_ITEM_RE = re.compile(
    r"\{\s*id:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'\s*,\s*gender:\s*'(Nam|Nữ)'\s*,\s*provider:\s*'(capcut|edge|gemini)'",
    re.MULTILINE,
)


def parse_catalog_items(content: str) -> list[tuple[str, str, str, str]]:
    catalog_start = content.find("export const VOICE_CATALOG")
    catalog_end = content.find("export const VOICE_CATEGORIES")
    catalog_block = content[catalog_start:catalog_end]
    return CATALOG_ITEM_RE.findall(catalog_block)


class VoicePickerCatalogSyncTest(unittest.TestCase):
    def test_catalog_helpers_are_single_source_of_truth(self) -> None:
        content = CATALOG_FILE.read_text(encoding="utf-8")
        items = parse_catalog_items(content)
        self.assertGreaterEqual(len(items), 16)

        male_ids = {item_id for item_id, _name, gender, _provider in items if gender == "Nam"}
        female_ids = {item_id for item_id, _name, gender, _provider in items if gender == "Nữ"}
        self.assertIn("BV075_streaming", male_ids)
        self.assertIn("en-US-GuyNeural", male_ids)
        self.assertIn("en-GB-RyanNeural", male_ids)
        self.assertIn("BV074_streaming", female_ids)
        self.assertIn("en-US-JennyNeural", female_ids)
        self.assertEqual(len(male_ids) + len(female_ids), len(items))

        self.assertIn("export function filterVoiceCatalog", content)
        self.assertIn("export function getVoiceDropdownGroups", content)
        self.assertIn("filterVoiceCatalog({ gender: 'Nam' })", content)
        self.assertIn("filterVoiceCatalog({ gender: 'Nữ' })", content)
        self.assertNotIn("Thanh Niên Tự Tin (CapCut Review Phim)", content)
        self.assertNotIn("Hoài My (Nữ truyền cảm, dịu dàng, chuẩn phim)", content)

    def test_shared_picker_matches_single_voice_card_ui(self) -> None:
        self.assertTrue(PICKER_FILE.exists(), "VoiceCatalogPicker.tsx must exist")
        content = PICKER_FILE.read_text(encoding="utf-8")
        for token in (
            "VOICE_CATEGORIES",
            "filterVoiceCatalog",
            "getVoiceDropdownGroups",
            "grid grid-cols-2",
            "HOT",
            "Hoặc chọn nhanh từ danh mục",
            "appearance-none",
            'data-testid="voice-catalog-picker"',
        ):
            self.assertIn(token, content)
        self.assertIn("gender?:", content)

    def test_picker_exposes_per_voice_preview_button(self) -> None:
        content = PICKER_FILE.read_text(encoding="utf-8")
        self.assertIn("onPreview", content)
        self.assertIn('data-testid="voice-preview-button"', content)
        self.assertIn("Nghe thử", content)
        sidebar = (REPOSITORY_ROOT / "web" / "src" / "components" / "sidebar" / "LeftMediaSidebar.tsx").read_text(encoding="utf-8")
        self.assertGreaterEqual(sidebar.count("onPreview="), 3)
        self.assertIn("handleTestVoice", sidebar)
        self.assertIn("rate: rateStr", sidebar)

    def test_sidebar_multi_voice_reuses_single_voice_picker(self) -> None:
        content = SIDEBAR_FILE.read_text(encoding="utf-8")
        self.assertIn("VoiceCatalogPicker", content)
        self.assertIn('gender="Nam"', content)
        self.assertIn('gender="Nữ"', content)
        self.assertGreaterEqual(content.count("<VoiceCatalogPicker"), 3)
        self.assertNotIn("MALE_VOICE_GROUPS", content)
        self.assertNotIn("FEMALE_VOICE_GROUPS", content)
        self.assertNotIn("setSelectedVoiceCategory", content)

    def test_dashboard_multi_voice_reuses_same_picker_and_catalog(self) -> None:
        content = HUB_FILE.read_text(encoding="utf-8")
        self.assertIn("VoiceCatalogPicker", content)
        self.assertIn('gender="Nam"', content)
        self.assertIn('gender="Nữ"', content)
        self.assertNotIn("Fenrir (Gemini Trầm)", content)
        self.assertNotIn("Nam Minh (Edge-TTS trầm ấm)", content)
        self.assertNotIn('<option value="BV074_streaming">Cô Gái Hoạt Ngôn (CapCut)</option>', content)
        self.assertIn("getVoiceDropdownGroups", content)


if __name__ == "__main__":
    unittest.main()
