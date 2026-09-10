import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PLAYER_FILE = REPOSITORY_ROOT / "web" / "src" / "components" / "player" / "VideoPlayer.tsx"


class OverlayRoiLockTest(unittest.TestCase):
    def test_mask_and_subtitle_lock_to_roi_instead_of_jumping_with_cue_boxes(self) -> None:
        content = PLAYER_FILE.read_text(encoding="utf-8")
        self.assertNotIn("isJumpedCue", content)
        self.assertNotIn("activeCue?.style?.box", content)
        self.assertNotIn("shouldExpandForSub", content)
        self.assertNotIn("jumped-${activeCue", content)
        self.assertIn("reg.y * effectiveBoxHeight", content)
        self.assertIn("reg.height * effectiveBoxHeight", content)
        self.assertIn("reg.x * effectiveBoxWidth", content)
        self.assertIn("reg.width * effectiveBoxWidth", content)
        self.assertIn("key={reg.region_id}", content)


if __name__ == "__main__":
    unittest.main()
