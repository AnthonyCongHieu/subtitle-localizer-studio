import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PLAYER_FILE = REPOSITORY_ROOT / "web" / "src" / "components" / "player" / "VideoPlayer.tsx"


class FullscreenOverlayAlignmentTest(unittest.TestCase):
    def test_fullscreen_targets_viewport_wrapper_not_sized_canvas(self) -> None:
        content = PLAYER_FILE.read_text(encoding="utf-8")
        self.assertIn("viewportRef.current.requestFullscreen", content)
        self.assertNotIn("videoBoxRef.current.requestFullscreen", content)
        self.assertIn("document.fullscreenElement === viewportRef.current", content)
        self.assertIn('data-testid="player-fullscreen-root"', content)
        self.assertIn('data-testid="player-canvas-box"', content)

    def test_overlays_lock_to_measured_canvas_instead_of_window_guess(self) -> None:
        content = PLAYER_FILE.read_text(encoding="utf-8")
        self.assertNotIn("? fullscreenCanvasSize.width", content)
        self.assertNotIn("? fullscreenCanvasSize.height", content)
        self.assertIn("containerWidth={effectiveBoxWidth}", content)
        self.assertIn("containerHeight={effectiveBoxHeight}", content)
        self.assertIn("width: `${canvasFitSize.width}px`", content)
        self.assertIn("height: `${canvasFitSize.height}px`", content)
        self.assertIn("[canvasRatio.ratioNum, videoUrl, isFullscreen]", content)

    def test_fullscreen_subtitle_font_keeps_windowed_proportion(self) -> None:
        content = PLAYER_FILE.read_text(encoding="utf-8")
        self.assertIn("windowedBoxSize", content)
        self.assertIn("subtitleFontScale", content)
        self.assertIn("isFullscreen ? effectiveBoxWidth / Math.max(1, windowedBoxSize.width)", content)
        self.assertIn("data-testid=\"rendered-subtitle-text\"", content)
        self.assertIn("subtitleFontSize * subtitleFontScale", content)
        self.assertNotIn("responsiveFontScale ? effectiveBoxWidth / 360 : 1)}px", content)


if __name__ == "__main__":
    unittest.main()
