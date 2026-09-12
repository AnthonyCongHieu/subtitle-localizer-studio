from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable, Dict, List, Optional, Union

from subtitle_localizer.domain.models import (
    BridgeEventV1,
    FullPipelineWorkflowV1,
    ProjectManifestV1,
    RegionTrackV1,
    StageRunV1,
    SubtitleCueV1,
)
from subtitle_localizer.persistence.database import Database

logger = logging.getLogger(__name__)


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

    def patch_project(
        self,
        project_id: str,
        patch_data: Optional[Dict[str, Any]] = None,
        updater: Optional[Callable[[ProjectManifestV1], None]] = None,
    ) -> Optional[ProjectManifestV1]:
        """
        Cập nhật nguyên tử một ProjectManifest trong một transaction SQLite duy nhất (BEGIN IMMEDIATE).
        Khóa hàng để đọc manifest mới nhất từ database, áp dụng patch hoặc hàm cập nhật updater,
        tự động tăng active_revision và cập nhật updated_at, loại bỏ hoàn toàn race condition.
        """
        conn = self.db.get_connection()
        conn.execute("BEGIN IMMEDIATE;")
        try:
            cursor = conn.execute("SELECT manifest_json, active_revision FROM projects WHERE project_id = ?;", (project_id,))
            row = cursor.fetchone()
            if not row:
                conn.execute("ROLLBACK;")
                return None

            data = json.loads(row["manifest_json"])
            manifest = ProjectManifestV1.from_dict(data)

            if updater:
                updater(manifest)

            if patch_data:
                if "regions" in patch_data:
                    raw_regions = patch_data["regions"]
                    manifest.regions = [
                        RegionTrackV1.from_dict(r) if isinstance(r, dict) else r
                        for r in raw_regions
                    ]
                if "custom_pipeline_settings" in patch_data:
                    manifest.custom_pipeline_settings = patch_data["custom_pipeline_settings"]
                if "title" in patch_data:
                    manifest.title = patch_data["title"]
                if "source_language" in patch_data:
                    manifest.source_language = patch_data["source_language"]
                if "target_language" in patch_data:
                    manifest.target_language = patch_data["target_language"]
                if "cues_count" in patch_data:
                    manifest.cues_count = patch_data["cues_count"]
                if "translated_count" in patch_data:
                    manifest.translated_count = patch_data["translated_count"]

            new_revision = (manifest.active_revision or 0) + 1
            manifest.active_revision = new_revision
            manifest.updated_at = time.time()
            manifest_json = json.dumps(manifest.to_dict(), ensure_ascii=False)

            conn.execute(
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
                WHERE project_id = ?;
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
                    project_id,
                ),
            )
            conn.execute("COMMIT;")
            return manifest
        except Exception:
            conn.execute("ROLLBACK;")
            raise

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
        """Danh sách tất cả projects đã lưu với cơ chế tự phục hồi self-healing nếu gặp lỗi disk malformed."""
        try:
            conn = self.db.get_connection()
            cursor = conn.execute("SELECT manifest_json FROM projects ORDER BY updated_at DESC;")
            rows = cursor.fetchall()
            return [ProjectManifestV1.from_dict(json.loads(row["manifest_json"])) for row in rows]
        except Exception as e:
            if "malformed" in str(e).lower() and hasattr(self.db, "recover_corrupted_database"):
                self.db.recover_corrupted_database()
                conn = self.db.get_connection()
                cursor = conn.execute("SELECT manifest_json FROM projects ORDER BY updated_at DESC;")
                rows = cursor.fetchall()
                return [ProjectManifestV1.from_dict(json.loads(row["manifest_json"])) for row in rows]
            raise

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

    def reconcile_orphaned_stage_runs(
        self,
        reason: str = "interrupted_by_restart",
        stale_after_seconds: float = 3600.0,
    ) -> int:
        """Đánh dấu các stage run còn ``running`` từ tiến trình trước là thất bại.

        Chỉ gọi lúc khởi động ứng dụng: khi đó không còn stage nào thực sự chạy,
        nên các dòng ``running`` còn lại là tàn dư của lần crash trước đó và sẽ
        khiến giao diện hiển thị "đang chạy" mãi mãi.

        ``stale_after_seconds`` bảo vệ stage vừa mới bắt đầu: nếu một tiến trình
        khác đang dùng chung database, dòng ``running`` mới ghi sẽ không bị đụng.
        """
        conn = self.db.get_connection()
        cutoff = time.time() - max(0.0, stale_after_seconds)
        cursor = conn.execute(
            "SELECT id, stage_json FROM stage_runs WHERE status = 'running' AND start_time <= ?;",
            (cutoff,),
        )
        rows = cursor.fetchall()
        if not rows:
            return 0

        now = time.time()
        marked = 0
        with conn:
            for row in rows:
                data = json.loads(row["stage_json"])
                data["status"] = "failed"
                data["end_time"] = now
                errors = list(data.get("errors") or [])
                errors.append(reason)
                data["errors"] = errors
                conn.execute(
                    "UPDATE stage_runs SET status = ?, stage_json = ?, end_time = ? WHERE id = ?;",
                    ("failed", json.dumps(data, ensure_ascii=False), now, row["id"]),
                )
                marked += 1
        logger.warning("Đã đánh dấu %s stage run còn 'running' từ tiến trình trước là failed", marked)
        return marked

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

    def get_latest_event_sequence(self) -> int:
        """Return the persisted event cursor so a restarted API continues it."""
        conn = self.db.get_connection()
        row = conn.execute("SELECT COALESCE(MAX(sequence), 0) AS latest FROM bridge_events;").fetchone()
        return int(row["latest"] if row else 0)

    # -------------------------------------------------------------------------
    # Full Pipeline Workflows (Ticket T28)
    # -------------------------------------------------------------------------
    def save_workflow(self, workflow: FullPipelineWorkflowV1) -> None:
        """Lưu hoặc cập nhật trạng thái FullPipelineWorkflowV1 bền vững."""
        conn = self.db.get_connection()
        settings_json = json.dumps(workflow.settings.to_dict(), ensure_ascii=False)
        workflow_json = json.dumps(workflow.to_dict(), ensure_ascii=False)
        with conn:
            conn.execute(
                """
                INSERT INTO full_pipeline_workflows (
                    workflow_id, idempotency_key, state, current_stage,
                    project_id, settings_json, workflow_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(workflow_id) DO UPDATE SET
                    idempotency_key = excluded.idempotency_key,
                    state = excluded.state,
                    current_stage = excluded.current_stage,
                    project_id = excluded.project_id,
                    settings_json = excluded.settings_json,
                    workflow_json = excluded.workflow_json,
                    updated_at = excluded.updated_at;
                """,
                (
                    workflow.workflow_id,
                    workflow.idempotency_key,
                    workflow.state,
                    workflow.current_stage,
                    workflow.project_id,
                    settings_json,
                    workflow_json,
                    workflow.created_at,
                    workflow.updated_at,
                ),
            )

    def get_workflow(self, workflow_id: str) -> Optional[FullPipelineWorkflowV1]:
        """Lấy một workflow theo workflow_id."""
        conn = self.db.get_connection()
        cursor = conn.execute(
            "SELECT workflow_json FROM full_pipeline_workflows WHERE workflow_id = ?;",
            (workflow_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        data = json.loads(row["workflow_json"])
        return FullPipelineWorkflowV1.from_dict(data)

    def find_workflow_by_idempotency_key(self, key: str) -> Optional[FullPipelineWorkflowV1]:
        """Tìm workflow theo idempotency_key để tránh tạo tác vụ trùng."""
        if not key or not str(key).strip():
            return None
        conn = self.db.get_connection()
        cursor = conn.execute(
            "SELECT workflow_json FROM full_pipeline_workflows WHERE idempotency_key = ?;",
            (key.strip(),),
        )
        row = cursor.fetchone()
        if not row:
            return None
        data = json.loads(row["workflow_json"])
        return FullPipelineWorkflowV1.from_dict(data)

    def list_workflows(self, limit: int = 50) -> List[FullPipelineWorkflowV1]:
        """Lấy danh sách các workflow gần nhất."""
        conn = self.db.get_connection()
        cursor = conn.execute(
            "SELECT workflow_json FROM full_pipeline_workflows ORDER BY updated_at DESC LIMIT ?;",
            (limit,),
        )
        rows = cursor.fetchall()
        result: List[FullPipelineWorkflowV1] = []
        for r in rows:
            data = json.loads(r["workflow_json"])
            result.append(FullPipelineWorkflowV1.from_dict(data))
        return result

    def reconcile_active_workflows(self) -> int:
        """Khôi phục các workflow còn kẹt ở trạng thái active khi restart server."""
        active_states = ("downloading", "detecting_roi", "ocr", "translating", "dubbing", "exporting")
        conn = self.db.get_connection()
        placeholders = ",".join("?" for _ in active_states)
        cursor = conn.execute(
            f"SELECT workflow_json FROM full_pipeline_workflows WHERE state IN ({placeholders});",
            active_states,
        )
        rows = cursor.fetchall()
        reconciled_count = 0
        for r in rows:
            data = json.loads(r["workflow_json"])
            wf = FullPipelineWorkflowV1.from_dict(data)
            # Chuyển sang needs_review kèm cảnh báo server restart để người dùng có thể retry hoặc tiếp tục
            wf.state = "needs_review"
            wf.warnings.append(f"Tiến trình bị gián đoạn do máy chủ khởi động lại tại stage '{wf.current_stage}'.")
            self.save_workflow(wf)
            reconciled_count += 1
        if reconciled_count > 0:
            logger.warning("Đã khôi phục %d workflow active kẹt từ lần chạy trước sang 'needs_review'.", reconciled_count)
        return reconciled_count
