import re
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class TimelineProgressAndHeaderUiTest(unittest.TestCase):
    def test_bottom_timeline_renders_live_progress_pill(self) -> None:
        timeline_file = REPOSITORY_ROOT / "web" / "src" / "components" / "timeline" / "BottomTimeline.tsx"
        self.assertTrue(timeline_file.exists())
        content = timeline_file.read_text(encoding="utf-8")

        # Must import Loader2 and Square
        self.assertIn("Loader2", content)
        self.assertIn("Square", content)

        # Props must include scanning and status info
        self.assertIn("isScanning?: boolean", content)
        self.assertIn("statusMessage?: string | null", content)
        self.assertIn("onStopScan?: () => void", content)

        # Markup must contain timeline-progress-pill test ID and stop button
        self.assertIn('data-testid="timeline-progress-pill"', content)
        self.assertIn('data-testid="timeline-stop-scan-button"', content)

    def test_studio_header_buttons_nowrap_and_no_cramping(self) -> None:
        header_file = REPOSITORY_ROOT / "web" / "src" / "components" / "layout" / "StudioHeader.tsx"
        self.assertTrue(header_file.exists())
        content = header_file.read_text(encoding="utf-8")

        # Right-side container must not be choked by max-w-[calc(50%-140px)]
        right_container_match = re.search(r'Bên Phải:[\s\S]*?<div className="([^"]+)"', content)
        self.assertIsNotNone(right_container_match)
        self.assertNotIn("max-w-[calc(50%-140px)]", right_container_match.group(1))
        self.assertIn("shrink-0", right_container_match.group(1))

        # Pipeline buttons must have whitespace-nowrap and shrink-0 to prevent text squishing
        self.assertIn("1. Quét", content)
        self.assertIn("2. Dịch", content)
        self.assertIn("3. Lồng Tiếng", content)

        # Button 1 scanning state should not hold the wide max-w-[200px] pill
        self.assertNotIn('max-w-[200px]"', content)

    def test_video_player_toolbar_no_clip(self) -> None:
        player_file = REPOSITORY_ROOT / "web" / "src" / "components" / "player" / "VideoPlayer.tsx"
        self.assertTrue(player_file.exists())
        content = player_file.read_text(encoding="utf-8")

        # Tools group should have shrink-0 so it doesn't get clipped on narrow viewports
        self.assertRegex(content, r'<div className="flex items-center gap-2 shrink-0">')

    def test_app_passes_progress_props_to_timeline(self) -> None:
        app_file = REPOSITORY_ROOT / "web" / "src" / "App.tsx"
        self.assertTrue(app_file.exists())
        content = app_file.read_text(encoding="utf-8")

        # BottomTimeline should receive isScanning, statusMessage, onStopScan
        timeline_block_match = re.search(r'<BottomTimeline\b([\s\S]*?)/>', content)
        self.assertIsNotNone(timeline_block_match, "<BottomTimeline /> must be present in App.tsx")
        timeline_props = timeline_block_match.group(1)

        self.assertIn("isScanning={isScanning}", timeline_props)
        self.assertIn("statusMessage={statusMessage}", timeline_props)
        self.assertIn("onStopScan={handleStopScan}", timeline_props)


if __name__ == "__main__":
    unittest.main()
