import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class SubtitleEditorTest(unittest.TestCase):
    def test_editor_components_exist(self) -> None:
        editor_dir = REPOSITORY_ROOT / "web" / "src" / "components" / "editor"
        self.assertTrue((editor_dir / "useUndoRedo.ts").exists())
        self.assertTrue((editor_dir / "ProxyPlayer.tsx").exists())
        self.assertTrue((editor_dir / "WaveformTimeline.tsx").exists())
        self.assertTrue((editor_dir / "CueTable.tsx").exists())
        self.assertTrue((editor_dir / "EditorView.tsx").exists())

    def test_cue_table_features_present(self) -> None:
        cue_table_code = (REPOSITORY_ROOT / "web" / "src" / "components" / "editor" / "CueTable.tsx").read_text(encoding="utf-8")
        self.assertIn("onToggleLock", cue_table_code)
        self.assertIn("onSplitCue", cue_table_code)
        self.assertIn("onMergeWithNext", cue_table_code)
        self.assertIn("filterLowConf", cue_table_code)
        self.assertIn("translated_text", cue_table_code)

    def test_undo_redo_hook_structure(self) -> None:
        hook_code = (REPOSITORY_ROOT / "web" / "src" / "components" / "editor" / "useUndoRedo.ts").read_text(encoding="utf-8")
        self.assertIn("canUndo", hook_code)
        self.assertIn("canRedo", hook_code)
        self.assertIn("undo", hook_code)
        self.assertIn("redo", hook_code)


if __name__ == "__main__":
    unittest.main()
