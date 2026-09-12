from __future__ import annotations

import shutil
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, List, Optional


CURRENT_SCHEMA_VERSION = 5

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
    3: """
    CREATE TABLE IF NOT EXISTS lan_workers (
        worker_id TEXT PRIMARY KEY,
        worker_json TEXT NOT NULL,
        updated_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lan_jobs (
        job_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        job_json TEXT NOT NULL,
        updated_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lan_downloads (
        request_id TEXT PRIMARY KEY,
        download_json TEXT NOT NULL,
        updated_at REAL NOT NULL
    );
    """,
    4: """
    ALTER TABLE lan_jobs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE lan_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE lan_jobs ADD COLUMN lease_id TEXT;
    ALTER TABLE lan_jobs ADD COLUMN lease_expires_at REAL;
    ALTER TABLE lan_jobs ADD COLUMN heartbeat_at REAL;
    ALTER TABLE lan_jobs ADD COLUMN started_at REAL;
    ALTER TABLE lan_jobs ADD COLUMN finished_at REAL;
    ALTER TABLE lan_jobs ADD COLUMN current_stage TEXT;
    ALTER TABLE lan_jobs ADD COLUMN result_json TEXT;
    ALTER TABLE lan_jobs ADD COLUMN artifacts_json TEXT;
    ALTER TABLE lan_jobs ADD COLUMN protocol_version INTEGER NOT NULL DEFAULT 1;
    CREATE INDEX IF NOT EXISTS idx_lan_jobs_lease ON lan_jobs(lease_expires_at);
    """,
    5: """
    CREATE TABLE IF NOT EXISTS full_pipeline_workflows (
        workflow_id TEXT PRIMARY KEY,
        idempotency_key TEXT UNIQUE,
        state TEXT NOT NULL,
        current_stage TEXT NOT NULL,
        project_id TEXT,
        settings_json TEXT NOT NULL,
        workflow_json TEXT NOT NULL,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fp_workflows_state ON full_pipeline_workflows(state);
    CREATE INDEX IF NOT EXISTS idx_fp_workflows_updated ON full_pipeline_workflows(updated_at);
    CREATE INDEX IF NOT EXISTS idx_fp_workflows_idem ON full_pipeline_workflows(idempotency_key);
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

    def check_integrity_or_recover(self) -> bool:
        """Kiểm tra tính toàn vẹn của SQLite DB. Nếu phát hiện malformed, tự động cứu hộ row-by-row."""
        try:
            conn = self.get_connection()
            rows = conn.execute("PRAGMA integrity_check;").fetchall()
            if rows and rows[0][0] == "ok":
                return True
        except Exception:
            pass
        return self.recover_corrupted_database()

    def recover_corrupted_database(self) -> bool:
        """Tự động cứu hộ và phục hồi toàn bộ dữ liệu hợp lệ khi SQLite gặp lỗi disk image malformed."""
        with self._lock:
            self.close()
            now = int(time.time())
            backup_path = self.db_path.with_name(f"{self.db_path.name}.corrupted.{now}")
            clean_path = self.db_path.with_name(f"{self.db_path.name}.clean.{now}")
            try:
                # 1. Sao lưu database bị lỗi
                if self.db_path.exists():
                    shutil.copy2(self.db_path, backup_path)
                wal_path = self.db_path.with_name(f"{self.db_path.name}-wal")
                if wal_path.exists():
                    shutil.copy2(wal_path, self.db_path.with_name(f"{backup_path.name}-wal"))

                # 2. Tạo database sạch và nạp schema
                clean_db = sqlite3.connect(str(clean_path))
                clean_db.row_factory = sqlite3.Row
                clean_db.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);")
                for ver in sorted(MIGRATIONS.keys()):
                    clean_db.executescript(MIGRATIONS[ver])
                    clean_db.execute("INSERT INTO schema_migrations(version) VALUES (?);", (ver,))

                # 3. Cứu hộ dữ liệu từng dòng từ database cũ
                if backup_path.exists():
                    try:
                        src_conn = sqlite3.connect(str(backup_path))
                        src_conn.row_factory = sqlite3.Row
                        for tbl in ["projects", "cues", "regions", "stage_runs", "bridge_events", "lan_workers", "lan_jobs", "lan_downloads"]:
                            try:
                                cur = src_conn.execute(f"SELECT rowid FROM {tbl}")
                                rowids = cur.fetchall()
                                for r in rowids:
                                    try:
                                        row = src_conn.execute(f"SELECT * FROM {tbl} WHERE rowid = ?", (r[0],)).fetchone()
                                        if row:
                                            placeholders = ", ".join(["?"] * len(row))
                                            clean_db.execute(f"INSERT OR REPLACE INTO {tbl} VALUES ({placeholders})", tuple(row))
                                    except Exception:
                                        pass
                                clean_db.commit()
                            except Exception:
                                pass
                        src_conn.close()
                    except Exception:
                        pass
                clean_db.close()

                # 4. Dọn dẹp file WAL/SHM cũ và hoán đổi file sạch
                for ext in ["-wal", "-shm"]:
                    extra = self.db_path.with_name(f"{self.db_path.name}{ext}")
                    if extra.exists():
                        try:
                            extra.unlink(missing_ok=True)
                        except Exception:
                            pass

                if self.db_path.exists():
                    try:
                        self.db_path.unlink(missing_ok=True)
                    except Exception:
                        pass
                clean_path.rename(self.db_path)
                return True
            except Exception:
                return False

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
