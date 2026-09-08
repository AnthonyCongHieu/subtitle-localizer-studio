import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class CapCutPreviewPlayerTest(unittest.TestCase):
    def test_capcut_preview_player_elements(self) -> None:
        player_file = REPOSITORY_ROOT / "web" / "src" / "components" / "player" / "VideoPlayer.tsx"
        self.assertTrue(player_file.exists(), "VideoPlayer.tsx must exist")
        content = player_file.read_text(encoding="utf-8")

        # 1. CapCut Header
        self.assertTrue(
            "Trình phát" in content and "Dòng thời gian" in content,
            "VideoPlayer must have CapCut header with 'Trình phát - Dòng thời gian 01' or video title",
        )
        self.assertIn("Menu", content, "VideoPlayer header must contain menu hamburger icon")

        # 2. CapCut Bottom Control Bar
        self.assertIn("player-bottom-controls", content, "VideoPlayer must have dedicated bottom control bar")
        self.assertIn("text-cyan-400", content, "VideoPlayer must show SMPTE timecode in cyan")
        self.assertIn("player-play-button", content, "VideoPlayer bottom bar must have play/pause button")
        self.assertIn("Đầy đủ", content, "VideoPlayer bottom bar must have quality button/selector")
        self.assertIn("player-fullscreen-button", content, "VideoPlayer bottom bar must have fullscreen button")

        # 3. Preserve required UI contracts
        self.assertIn("absolute inset-0 overflow-hidden", content)
        self.assertIn("Dedicated Top Toolbar - Tách biệt độc lập, không che hay chạm sát Video", content)
        self.assertIn("interactionMode = 'roi'", content)
        self.assertIn("regions={regions}", content)


if __name__ == "__main__":
    unittest.main()
