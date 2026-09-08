import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class BottomTimelineScrollbarTest(unittest.TestCase):
    def test_bottom_timeline_has_scrollbar_and_thumb(self) -> None:
        timeline_file = REPOSITORY_ROOT / "web" / "src" / "components" / "timeline" / "BottomTimeline.tsx"
        self.assertTrue(timeline_file.exists(), "BottomTimeline.tsx must exist")
        content = timeline_file.read_text(encoding="utf-8")

        # Must have bottom scrollbar test id
        self.assertIn('data-testid="timeline-bottom-scrollbar"', content, "BottomTimeline must have bottom scrollbar container")
        self.assertIn('data-testid="timeline-scrollbar-thumb"', content, "BottomTimeline must have scrollbar thumb")
        self.assertIn('data-testid="timeline-scrollbar-track"', content, "BottomTimeline must have scrollbar track")

    def test_mouse_wheel_horizontal_pan_logic(self) -> None:
        timeline_file = REPOSITORY_ROOT / "web" / "src" / "components" / "timeline" / "BottomTimeline.tsx"
        content = timeline_file.read_text(encoding="utf-8")

        # Must support normal mouse wheel horizontal scrolling (lăn qua lăn lại giống CapCut)
        self.assertIn("scrollLeft", content, "BottomTimeline must adjust scrollLeft on wheel")
        # Must distinguish between normal wheel scroll and Ctrl/Alt zoom
        self.assertTrue(
            ("ctrlKey" in content or "altKey" in content) and ("deltaY" in content or "deltaX" in content),
            "BottomTimeline must handle ctrlKey/altKey for zoom while rolling wheel pans horizontally"
        )
        # Must prevent duplicate wheel bubbling
        self.assertIn("addEventListener('wheel'", content, "Must use single native non-passive wheel listener")

    def test_scrollbar_thumb_drag_and_jump(self) -> None:
        timeline_file = REPOSITORY_ROOT / "web" / "src" / "components" / "timeline" / "BottomTimeline.tsx"
        content = timeline_file.read_text(encoding="utf-8")

        # Must track scroll metrics (scrollWidth, clientWidth, scrollLeft)
        self.assertIn("scrollWidth", content)
        self.assertIn("clientWidth", content)
        self.assertIn("syncScrollMetrics", content, "Must synchronize scroll metrics")
        # Must have drag handler for the thumb
        self.assertIn("handleThumbMouseDown", content, "Must handle dragging scrollbar thumb")
        # Must have click handler to jump position
        self.assertIn("handleTrackClick", content, "Must handle click to jump on scrollbar track")
        # Must enforce minimum thumb width
        self.assertIn("minWidth", content, "Must enforce minimum thumb width in CSS")
        # Must have mini playhead indicator
        self.assertIn("playheadPct", content, "Must display playhead position on scrollbar")


if __name__ == "__main__":
    unittest.main()
