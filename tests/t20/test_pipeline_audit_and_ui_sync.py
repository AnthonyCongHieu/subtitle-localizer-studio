import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class PipelineAuditAndUiSyncTest(unittest.TestCase):
    def test_audio_silencing_on_delete_and_empty_cues(self) -> None:
        # 1. Check server.py resets voiceover when cues are empty
        server_file = REPOSITORY_ROOT / "src" / "subtitle_localizer" / "service" / "server.py"
        self.assertTrue(server_file.exists())
        server_content = server_file.read_text(encoding="utf-8")
        self.assertIn("manifest.has_voiceover = False", server_content)
        self.assertIn("manifest.voiceover_path = None", server_content)

        # 2. Check BottomTimeline.tsx has frame-accurate Zero-Leak audio sentry
        timeline_file = REPOSITORY_ROOT / "web" / "src" / "components" / "timeline" / "BottomTimeline.tsx"
        self.assertTrue(timeline_file.exists())
        timeline_content = timeline_file.read_text(encoding="utf-8")
        self.assertIn("checkTimeInCues", timeline_content)
        self.assertIn("Frame-Accurate Zero-Leak Audio Sentry", timeline_content)
        self.assertIn("audio.muted = targetMuted", timeline_content)
        self.assertIn("audio.volume = targetVol", timeline_content)
        self.assertIn("cues.length > 0 ? apiClient.getVoiceoverAudioUrl", timeline_content)

    def test_gemini_key_storage_removed_from_right_inspector(self) -> None:
        inspector_file = REPOSITORY_ROOT / "web" / "src" / "components" / "inspector" / "RightInspectorPanel.tsx"
        self.assertTrue(inspector_file.exists())
        inspector_content = inspector_file.read_text(encoding="utf-8")
        # Verify key storage input is NOT in RightInspectorPanel
        self.assertNotIn("Dán mã AIzaSy", inspector_content)
        self.assertNotIn("Lưu Key", inspector_content)
        self.assertNotIn("handleSaveGeminiKey", inspector_content)

    def test_three_pipeline_synthesis_buttons(self) -> None:
        # Check StudioHeader.tsx has the 3 buttons
        header_file = REPOSITORY_ROOT / "web" / "src" / "components" / "layout" / "StudioHeader.tsx"
        self.assertTrue(header_file.exists())
        header_content = header_file.read_text(encoding="utf-8")
        self.assertIn("1. Quét Sub", header_content)
        self.assertIn("2. Dịch AI", header_content)
        self.assertIn("3. Lồng Tiếng", header_content)

        # Check App.tsx connects onTranslateAll and onDubAll to StudioHeader
        app_file = REPOSITORY_ROOT / "web" / "src" / "App.tsx"
        self.assertTrue(app_file.exists())
        app_content = app_file.read_text(encoding="utf-8")
        self.assertIn("onTranslateAll={handleTranslateAll}", app_content)
        self.assertIn("onDubAll={handleDubAll}", app_content)
        self.assertIn("isTranslating={isTranslatingAll}", app_content)
        self.assertIn("isDubbing={isDubbingAll}", app_content)

    def test_smpte_grid_toggle_and_overlay(self) -> None:
        player_file = REPOSITORY_ROOT / "web" / "src" / "components" / "player" / "VideoPlayer.tsx"
        self.assertTrue(player_file.exists())
        player_content = player_file.read_text(encoding="utf-8")
        self.assertIn("showGrid", player_content)
        self.assertIn("player-grid-button", player_content)
        self.assertIn("smpte-grid-overlay", player_content)

    def test_ui_selects_standardization_with_chevrons(self) -> None:
        inspector_file = REPOSITORY_ROOT / "web" / "src" / "components" / "inspector" / "RightInspectorPanel.tsx"
        sidebar_file = REPOSITORY_ROOT / "web" / "src" / "components" / "sidebar" / "LeftMediaSidebar.tsx"
        inspector_content = inspector_file.read_text(encoding="utf-8")
        sidebar_content = sidebar_file.read_text(encoding="utf-8")

        self.assertIn("ChevronDown", inspector_content)
        self.assertIn("ChevronDown", sidebar_content)
        self.assertIn("appearance-none pr-7", inspector_content)
        self.assertIn("appearance-none pr-7", sidebar_content)


if __name__ == "__main__":
    unittest.main()
