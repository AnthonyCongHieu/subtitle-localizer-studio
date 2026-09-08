import re
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class UiUxHarmonizationSlateIndigoTest(unittest.TestCase):
    def test_all_selects_in_left_sidebar_standardized(self) -> None:
        sidebar_file = REPOSITORY_ROOT / "web" / "src" / "components" / "sidebar" / "LeftMediaSidebar.tsx"
        self.assertTrue(sidebar_file.exists())
        content = sidebar_file.read_text(encoding="utf-8")

        # Find all <select ...> tags up to first option/optgroup
        select_matches = list(re.finditer(r'<select\b(.*?)(?=<option|<optgroup)', content, re.DOTALL))
        self.assertGreater(len(select_matches), 0, "Should contain select elements")

        for idx, match in enumerate(select_matches):
            attrs = match.group(1)
            self.assertIn("appearance-none", attrs, f"Select #{idx} in LeftMediaSidebar must have appearance-none")

        # Check per-cue voice selector has ChevronDown in container
        self.assertIn("perCueVoices", content)
        self.assertIn("ChevronDown", content)

    def test_all_selects_in_right_inspector_standardized(self) -> None:
        inspector_file = REPOSITORY_ROOT / "web" / "src" / "components" / "inspector" / "RightInspectorPanel.tsx"
        self.assertTrue(inspector_file.exists())
        content = inspector_file.read_text(encoding="utf-8")

        select_matches = list(re.finditer(r'<select\b(.*?)(?=<option|<optgroup)', content, re.DOTALL))
        self.assertGreater(len(select_matches), 0)

        for idx, match in enumerate(select_matches):
            attrs = match.group(1)
            self.assertIn("appearance-none", attrs, f"Select #{idx} in RightInspectorPanel must have appearance-none")

    def test_all_selects_in_studio_header_standardized(self) -> None:
        header_file = REPOSITORY_ROOT / "web" / "src" / "components" / "layout" / "StudioHeader.tsx"
        self.assertTrue(header_file.exists())
        content = header_file.read_text(encoding="utf-8")

        select_matches = list(re.finditer(r'<select\b(.*?)(?=<option|<optgroup)', content, re.DOTALL))
        self.assertGreater(len(select_matches), 0)

        for idx, match in enumerate(select_matches):
            attrs = match.group(1)
            self.assertIn("appearance-none", attrs, f"Select #{idx} in StudioHeader must have appearance-none")

        # Ensure ChevronDown is used inside header pills
        self.assertIn("ChevronDown", content)

    def test_studio_header_pipeline_completion_badges(self) -> None:
        header_file = REPOSITORY_ROOT / "web" / "src" / "components" / "layout" / "StudioHeader.tsx"
        self.assertTrue(header_file.exists())
        content = header_file.read_text(encoding="utf-8")

        # Pipeline completion badges
        self.assertIn("emerald", content, "StudioHeader should include emerald indicators for completed stages")
        self.assertIn("cues.length > 0", content)

    def test_compact_pro_button_styling_consistency(self) -> None:
        sidebar_file = REPOSITORY_ROOT / "web" / "src" / "components" / "sidebar" / "LeftMediaSidebar.tsx"
        inspector_file = REPOSITORY_ROOT / "web" / "src" / "components" / "inspector" / "RightInspectorPanel.tsx"
        sidebar_content = sidebar_file.read_text(encoding="utf-8")
        inspector_content = inspector_file.read_text(encoding="utf-8")

        # Check compact pro standard active scale
        self.assertIn("active:scale-", sidebar_content)
        self.assertIn("active:scale-", inspector_content)
        self.assertIn("rounded-lg", sidebar_content)
        self.assertIn("rounded-lg", inspector_content)


if __name__ == "__main__":
    unittest.main()
