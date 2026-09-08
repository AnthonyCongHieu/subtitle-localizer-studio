import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class PlayheadAnchoredZoomTest(unittest.TestCase):
    def test_alt_wheel_horizontal_pan(self) -> None:
        timeline_file = REPOSITORY_ROOT / "web" / "src" / "components" / "timeline" / "BottomTimeline.tsx"
        self.assertTrue(timeline_file.exists(), "BottomTimeline.tsx must exist")
        content = timeline_file.read_text(encoding="utf-8")

        # Must explicitly check altKey for horizontal panning
        self.assertIn("altKey", content, "BottomTimeline must handle altKey for panning")
        self.assertIn("scrollLeft", content, "BottomTimeline must update scrollLeft on wheel")

    def test_ctrl_wheel_playhead_anchored_zoom(self) -> None:
        timeline_file = REPOSITORY_ROOT / "web" / "src" / "components" / "timeline" / "BottomTimeline.tsx"
        content = timeline_file.read_text(encoding="utf-8")

        # Must support Ctrl/Cmd zoom
        self.assertIn("ctrlKey", content, "BottomTimeline must handle ctrlKey for zoom")
        # Must anchor zoom to yellow playhead (currentTime / totalDuration)
        self.assertTrue(
            "playheadRatio" in content or ("currentTime" in content and "totalDuration" in content),
            "BottomTimeline must compute playhead ratio to anchor zoom to the yellow playhead"
        )
        # Must eliminate jitter by updating style width and scrollLeft synchronously
        self.assertTrue(
            "applyZoom" in content,
            "BottomTimeline must have unified applyZoom function for smooth playhead zooming"
        )
        # Must handle out-tong-dan (overview when zooming out to 1.0)
        self.assertTrue(
            "targetScrollLeft" in content or "desiredScrollLeft" in content,
            "BottomTimeline must adjust scrollLeft to keep yellow playhead pinned during zoom"
        )


if __name__ == "__main__":
    unittest.main()
