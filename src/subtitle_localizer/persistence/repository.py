from __future__ import annotations

import json
import time
from typing import Any, List, Optional

from subtitle_localizer.domain.models import (
    BridgeEventV1,
    ProjectManifestV1,
    RegionTrackV1,
    StageRunV1,
    SubtitleCueV1,
)
from subtitle_localizer.persistence.database import Database


class ProjectRepository:
    """Repository quản lý Projects, Cues, Regions, StageRuns và BridgeEvents."""

    def __init__(self, database: Database) -> None:
        self.db = database

    def save_project(self, manifest: ProjectManifestV1) -> None:
        """Lưu hoặc ghi đè một ProjectManifest."""
        conn = self.db.get_connection()
        manifest_json = json.dumps(manifest.to_dict(), ensure_ascii=False)
        with conn:
            conn.execute(
                """
                INSERT INTO projects (
                    project_id, title, source_video_path, video_fingerprint,
                    source_language, target_language, active_revision,
                    manifest_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    title = excluded.title,
                    source_video_path = excluded.source_video_path,
                    video_fingerprint = excluded.video_fingerprint,
                    source_language = excluded.source_language,
                    target_language = excluded.target_language,
                    active_revision = excluded.active_revision,
                    manifest_json = excluded.manifest_json,
                    updated_at = excluded.updated_at;
                """,
                (
                    manifest.project_id,
                    manifest.title,
                    manifest.source_video_path,
                    manifest.video_fingerprint,
                    manifest.source_language,
                    manifest.target_language,
                    manifest.active_revision,
                    manifest_json,
                    manifest.created_at,
                    time.time(),
                ),
            )

    def get_project(self, project_id: str) -> Optional[ProjectManifestV1]:
        """Lấy ProjectManifest theo project_id."""
        conn = self.db.get_connection()
        cursor = conn.execute("SELECT manifest_json FROM projects WHERE project_id = ?;", (project_id,))
        row = cursor.fetchone()
        if not row:
            return None
        data = json.loads(row["manifest_json"])
        return ProjectManifestV1.from_dict(data)

    def list_projects(self) -> List[ProjectManifestV1]:
        """Danh sách tất cả projects đã lưu."""
        conn = self.db.get_connection()
        cursor = conn.execute("SELECT manifest_json FROM projects ORDER BY updated_at DESC;")
        rows = cursor.fetchall()
        return [ProjectManifestV1.from_dict(json.loads(row["manifest_json"])) for row in rows]

    def update_project_revision(self, manifest: ProjectManifestV1, expected_revision: int) -> bool:
        """
        Cập nhật project có kiểm tra optimistic revision.
        Nếu revision hiện tại trong database != expected_revision, lệnh sẽ bị từ chối (trả về False).
        Khi thành công, active_revision được tăng lên 1.
        """
        conn = self.db.get_connection()
        new_revision = expected_revision + 1
        manifest.active_revision = new_revision
        manifest.updated_at = time.time()
        manifest_json = json.dumps(manifest.to_dict(), ensure_ascii=False)

        with conn:
            cursor = conn.execute(
                """
                UPDATE projects SET
                    title = ?,
                    source_video_path = ?,
                    video_fingerprint = ?,
                    source_language = ?,
                    target_language = ?,
                    active_revision = ?,
                    manifest_json = ?,
                    updated_at = ?
                WHERE project_id = ? AND active_revision = ?;
                """,
                (
                    manifest.title,
                    manifest.source_video_path,
                    manifest.video_fingerprint,
                    manifest.source_language,
                    manifest.target_language,
                    new_revision,
                    manifest_json,
                    manifest.updated_at,
                    manifest.project_id,
                    expected_revision,
                ),
            )
            return cursor.rowcount > 0

    def delete_project(self, project_id: str) -> bool:
        """Xóa project cùng toàn bộ cues và regions liên quan (CASCADE)."""
        conn = self.db.get_connection()
        with conn:
            cursor = conn.execute("DELETE FROM projects WHERE project_id = ?;", (project_id,))
            return cursor.rowcount > 0

    def save_cues(self, project_id: str, cues: List[SubtitleCueV1]) -> None:
        """Lưu danh sách cues cho một project trong một transaction duy nhất."""
        conn = self.db.get_connection()
        conn.execute("BEGIN IMMEDIATE;")
        try:
            # Xóa các cues cũ của project để ghi đè danh sách mới
            conn.execute("DELETE FROM cues WHERE project_id = ?;", (project_id,))
            for cue in cues:
                cue_json = json.dumps(cue.to_dict(), ensure_ascii=False)
                conn.execute(
                    """
                    INSERT INTO cues (
                        cue_id, project_id, start_pts, end_pts,
                        source_text, translated_text, status,
                        confidence, revision, cue_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
                    """,
                    (
                        cue.cue_id,
                        project_id,
                        cue.start_pts,
                        cue.end_pts,
                        cue.source_text,
                        cue.translated_text,
                        cue.status,
                        cue.confidence,
                        cue.revision,
                        cue_json,
                    ),
                )
            conn.execute("COMMIT;")
        except Exception:
            conn.execute("ROLLBACK;")
            raise

    def get_cues(self, project_id: str) -> List[SubtitleCueV1]:
        """Lấy toàn bộ cues của project được sắp xếp theo start_pts tăng dần."""
        conn = self.db.get_connection()
        cursor = conn.execute(
            "SELECT cue_json FROM cues WHERE project_id = ? ORDER BY start_pts ASC;",
            (project_id,),
        )
        rows = cursor.fetchall()
        return [SubtitleCueV1.from_dict(json.loads(row["cue_json"])) for row in rows]

    def update_cue(self, project_id: str, cue: SubtitleCueV1) -> bool:
        """Cập nhật một cue đơn lẻ."""
        conn = self.db.get_connection()
        cue_json = json.dumps(cue.to_dict(), ensure_ascii=False)
        with conn:
            cursor = conn.execute(
                """
                UPDATE cues SET
                    start_pts = ?,
                    end_pts = ?,
                    source_text = ?,
                    translated_text = ?,
                    status = ?,
                    confidence = ?,
                    revision = revision + 1,
                    cue_json = ?
                WHERE project_id = ? AND cue_id = ?;
                """,
                (
                    cue.start_pts,
                    cue.end_pts,
                    cue.source_text,
                    cue.translated_text,
                    cue.status,
                    cue.confidence,
                    cue_json,
                    project_id,
                    cue.cue_id,
                ),
            )
            return cursor.rowcount > 0

    def delete_cue(self, project_id: str, cue_id: str) -> bool:
        """Xóa một cue theo id."""
        conn = self.db.get_connection()
        with conn:
            cursor = conn.execute(
                "DELETE FROM cues WHERE project_id = ? AND cue_id = ?;",
                (project_id, cue_id),
            )
            return cursor.rowcount > 0

    def save_stage_run(self, project_id: str, stage: StageRunV1) -> None:
        """Ghi nhận tiến trình stage run."""
        conn = self.db.get_connection()
        stage_json = json.dumps(stage.to_dict(), ensure_ascii=False)
        with conn:
            conn.execute(
                """
                INSERT INTO stage_runs (
                    project_id, stage_name, status, progress, stage_json, start_time, end_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    project_id,
                    stage.stage_name,
                    stage.status,
                    stage.progress,
                    stage_json,
                    stage.start_time,
                    stage.end_time,
                ),
            )

    def get_stage_runs(self, project_id: str) -> List[StageRunV1]:
        """Lấy lịch sử các stage runs của project."""
        conn = self.db.get_connection()
        cursor = conn.execute(
            "SELECT stage_json FROM stage_runs WHERE project_id = ? ORDER BY id ASC;",
            (project_id,),
        )
        rows = cursor.fetchall()
        return [StageRunV1.from_dict(json.loads(row["stage_json"])) for row in rows]

    def clear_stage_runs(self, project_id: str) -> None:
        """Xóa lịch sử stage runs cũ khi khởi chạy đợt pipeline mới để tránh xung đột trạng thái."""
        conn = self.db.get_connection()
        with conn:
            conn.execute("DELETE FROM stage_runs WHERE project_id = ?;", (project_id,))

    def save_event(self, event: BridgeEventV1) -> None:
        """Lưu event vào chuỗi sự kiện WebSocket ordered sequence."""
        conn = self.db.get_connection()
        payload_json = json.dumps(event.payload, ensure_ascii=False)
        with conn:
            conn.execute(
                """
                INSERT INTO bridge_events (
                    event_id, sequence, project_id, job_id, event_type, payload_json, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    event.event_id,
                    event.sequence,
                    event.project_id,
                    event.job_id,
                    event.event_type,
                    payload_json,
                    event.timestamp,
                ),
            )

    def get_events_after(self, sequence: int, limit: int = 100) -> List[BridgeEventV1]:
        """Lấy danh sách các events có sequence lớn hơn sequence được truyền vào (dùng để resume WebSocket)."""
        conn = self.db.get_connection()
        cursor = conn.execute(
            "SELECT * FROM bridge_events WHERE sequence > ? ORDER BY sequence ASC LIMIT ?;",
            (sequence, limit),
        )
        rows = cursor.fetchall()
        events: List[BridgeEventV1] = []
        for row in rows:
            events.append(
                BridgeEventV1(
                    event_id=row["event_id"],
                    sequence=row["sequence"],
                    project_id=row["project_id"],
                    job_id=row["job_id"],
                    event_type=row["event_type"],
                    payload=json.loads(row["payload_json"]),
                    timestamp=row["timestamp"],
                )
            )
        return events
