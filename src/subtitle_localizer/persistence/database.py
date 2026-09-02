from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any, List, Optional


CURRENT_SCHEMA_VERSION = 2

MIGRATIONS = {
    1: """
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
        project_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source_video_path TEXT NOT NULL,
        video_fingerprint TEXT NOT NULL,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL DEFAULT 'vi',
        active_revision INTEGER NOT NULL DEFAULT 1,
        manifest_json TEXT NOT NULL,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cues (
        cue_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        start_pts REAL NOT NULL,
        end_pts REAL NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'auto',
        confidence REAL NOT NULL DEFAULT 1.0,
        revision INTEGER NOT NULL DEFAULT 1,
        cue_json TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cues_project_pts ON cues(project_id, start_pts);

    CREATE TABLE IF NOT EXISTS regions (
        region_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        valid_start_pts REAL NOT NULL,
        valid_end_pts REAL NOT NULL,
        region_json TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stage_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        stage_name TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0.0,
        stage_json TEXT NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL,
        FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bridge_events (
        event_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        job_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        timestamp REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bridge_events_seq ON bridge_events(sequence);
    """,
    2: """
    BEGIN IMMEDIATE;

    CREATE TABLE cues_v2 (
        project_id TEXT NOT NULL,
        cue_id TEXT NOT NULL,
        start_pts REAL NOT NULL,
        end_pts REAL NOT NULL,
        source_text TEXT NOT NULL,
        translated_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'auto',
        confidence REAL NOT NULL DEFAULT 1.0,
        revision INTEGER NOT NULL DEFAULT 1,
        cue_json TEXT NOT NULL,
        PRIMARY KEY(project_id, cue_id),
        FOREIGN KEY(project_id) REFERENCES projects(project_id) ON DELETE CASCADE
    );

    INSERT INTO cues_v2 (
        project_id, cue_id, start_pts, end_pts,
        source_text, translated_text, status,
        confidence, revision, cue_json
    )
    SELECT
        project_id, cue_id, start_pts, end_pts,
        source_text, translated_text, status,
        confidence, revision, cue_json
    FROM cues;

    DROP TABLE cues;
    ALTER TABLE cues_v2 RENAME TO cues;
    CREATE INDEX idx_cues_project_pts ON cues(project_id, start_pts);

    COMMIT;
    """,
}


class Database:
    """Quản lý kết nối SQLite thread-safe, tự động nâng cấp migration và xử lý transaction an toàn."""

    def __init__(self, db_path: Path | str) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._all_conns: List[sqlite3.Connection] = []
        self._lock = threading.Lock()

    def get_connection(self) -> sqlite3.Connection:
        if not hasattr(self._local, "connection") or self._local.connection is None:
            conn = sqlite3.connect(
                str(self.db_path),
                timeout=30.0,
                check_same_thread=False,
                isolation_level=None,  # Autocommit mode
            )
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA foreign_keys=ON;")
            conn.row_factory = sqlite3.Row
            self._local.connection = conn
            with self._lock:
                self._all_conns.append(conn)
        return self._local.connection

    def migrate(self) -> None:
        """Thực thi các script migration theo thứ tự phiên bản."""
        conn = self.get_connection()
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);")
        cursor = conn.execute("SELECT MAX(version) FROM schema_migrations;")
        row = cursor.fetchone()
        latest_version = row[0] if (row and row[0] is not None) else 0

        for ver in sorted(MIGRATIONS.keys()):
            if ver > latest_version:
                with conn:
                    conn.executescript(MIGRATIONS[ver])
                    conn.execute("INSERT INTO schema_migrations(version) VALUES (?);", (ver,))

    def close(self) -> None:
        with self._lock:
            for conn in self._all_conns:
                try:
                    conn.close()
                except Exception:
                    pass
            self._all_conns.clear()
        if hasattr(self._local, "connection"):
            self._local.connection = None
