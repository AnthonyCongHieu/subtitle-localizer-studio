import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository


class ProjectScopedCuePersistenceTest(unittest.TestCase):
    """Regression tests for per-project cue replacement behavior."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db = Database(Path(self.temp_dir.name) / "projects.db")
        self.db.migrate()
        self.repo = ProjectRepository(self.db)

    def tearDown(self) -> None:
        self.db.close()
        self.temp_dir.cleanup()

    def _save_project(self, project_id: str) -> None:
        self.repo.save_project(
            ProjectManifestV1(
                project_id=project_id,
                title=f"Project {project_id}",
                source_video_path="C:/input/video.mp4",
                video_fingerprint=f"fingerprint-{project_id}",
                source_language="zh",
                target_language="vi",
            )
        )

    @staticmethod
    def _cue(cue_id: str, source_text: str) -> SubtitleCueV1:
        return SubtitleCueV1(
            cue_id=cue_id,
            start_pts=0.0,
            end_pts=1.0,
            source_text=source_text,
        )

    def test_two_projects_can_store_the_same_local_cue_id(self) -> None:
        """A deterministic cue id must be unique only within its project."""
        self._save_project("project-one")
        self._save_project("project-two")

        self.repo.save_cues("project-one", [self._cue("cue-0001", "字幕一")])
        self.repo.save_cues("project-two", [self._cue("cue-0001", "字幕二")])

        self.assertEqual(self.repo.get_cues("project-one")[0].source_text, "字幕一")
        self.assertEqual(self.repo.get_cues("project-two")[0].source_text, "字幕二")

    def test_failed_cue_replacement_preserves_existing_project_cues(self) -> None:
        """A malformed replacement cannot delete a project's last valid cue set."""
        self._save_project("project-one")
        self.repo.save_cues("project-one", [self._cue("stable", "đang giữ")])

        with self.assertRaises(sqlite3.IntegrityError):
            self.repo.save_cues(
                "project-one",
                [self._cue("duplicate", "một"), self._cue("duplicate", "hai")],
            )

        self.assertEqual(
            [cue.cue_id for cue in self.repo.get_cues("project-one")],
            ["stable"],
        )

    def test_migration_keeps_existing_v1_cue_data(self) -> None:
        """Migrating a v1 database retains cues and scopes its primary key."""
        legacy_path = Path(self.temp_dir.name) / "legacy-v1.db"
        legacy = sqlite3.connect(legacy_path)
        legacy.executescript(
            """
            CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
            INSERT INTO schema_migrations(version) VALUES (1);
            CREATE TABLE projects (
                project_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                source_video_path TEXT NOT NULL,
                video_fingerprint TEXT NOT NULL,
                source_language TEXT NOT NULL,
                target_language TEXT NOT NULL,
                active_revision INTEGER NOT NULL,
                manifest_json TEXT NOT NULL,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            CREATE TABLE cues (
                cue_id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                start_pts REAL NOT NULL,
                end_pts REAL NOT NULL,
                source_text TEXT NOT NULL,
                translated_text TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'auto',
                confidence REAL NOT NULL DEFAULT 1.0,
                revision INTEGER NOT NULL DEFAULT 1,
                cue_json TEXT NOT NULL
            );
            """
        )
        manifest = ProjectManifestV1(
            project_id="legacy-project",
            title="Legacy project",
            source_video_path="C:/input/legacy.mp4",
            video_fingerprint="legacy-fingerprint",
            source_language="zh",
        )
        cue = self._cue("cue-0001", "保留字幕")
        legacy.execute(
            "INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                manifest.project_id,
                manifest.title,
                manifest.source_video_path,
                manifest.video_fingerprint,
                manifest.source_language,
                manifest.target_language,
                manifest.active_revision,
                json.dumps(manifest.to_dict(), ensure_ascii=False),
                manifest.created_at,
                manifest.updated_at,
            ),
        )
        legacy.execute(
            "INSERT INTO cues VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                cue.cue_id,
                manifest.project_id,
                cue.start_pts,
                cue.end_pts,
                cue.source_text,
                cue.translated_text,
                cue.status,
                cue.confidence,
                cue.revision,
                json.dumps(cue.to_dict(), ensure_ascii=False),
            ),
        )
        legacy.commit()
        legacy.close()

        migrated_db = Database(legacy_path)
        try:
            migrated_db.migrate()
            migrated_repo = ProjectRepository(migrated_db)

            self.assertEqual(migrated_repo.get_cues("legacy-project")[0].source_text, "保留字幕")
            cursor = migrated_db.get_connection().execute("PRAGMA table_info(cues)")
            try:
                primary_key_columns = [row[1] for row in cursor if row[5]]
            finally:
                cursor.close()
            self.assertEqual(primary_key_columns, ["project_id", "cue_id"])
        finally:
            migrated_db.close()


if __name__ == "__main__":
    unittest.main()
