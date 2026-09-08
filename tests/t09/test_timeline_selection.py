import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class TimelineSelectionTest(unittest.TestCase):
    def test_bottom_timeline_multi_select_props_and_marquee(self) -> None:
        timeline_file = REPOSITORY_ROOT / "web" / "src" / "components" / "timeline" / "BottomTimeline.tsx"
        self.assertTrue(timeline_file.exists(), "BottomTimeline.tsx must exist")
        content = timeline_file.read_text(encoding="utf-8")

        # Must support selectedCueIds and multi-select props
        self.assertIn("selectedCueIds", content, "BottomTimeline must accept selectedCueIds prop")
        self.assertIn("onSelectCues", content, "BottomTimeline must accept onSelectCues prop")
        self.assertIn("onDeleteCues", content, "BottomTimeline must accept onDeleteCues prop")

        # Must support marquee selection box
        self.assertIn("marquee", content.lower(), "BottomTimeline must implement marquee selection")

        # Must support Ctrl/Cmd click individual pick
        self.assertIn("ctrlKey", content, "BottomTimeline must handle ctrlKey for individual pick")

    def test_use_timeline_shortcuts_batch_delete(self) -> None:
        shortcuts_file = REPOSITORY_ROOT / "web" / "src" / "hooks" / "useTimelineShortcuts.ts"
        self.assertTrue(shortcuts_file.exists(), "useTimelineShortcuts.ts must exist")
        content = shortcuts_file.read_text(encoding="utf-8")

        self.assertIn("selectedCueIds", content, "useTimelineShortcuts must accept selectedCueIds")
        self.assertTrue('onDeleteCues' in content or 'onDeleteCue' in content)

    def test_app_tsx_passes_multi_select_state(self) -> None:
        app_file = REPOSITORY_ROOT / "web" / "src" / "App.tsx"
        self.assertTrue(app_file.exists(), "App.tsx must exist")
        content = app_file.read_text(encoding="utf-8")

        self.assertIn("selectedCueIds", content, "App.tsx must manage selectedCueIds state")
        self.assertIn("handleDeleteCue", content)


if __name__ == "__main__":
    unittest.main()
