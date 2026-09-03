import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

# Thử import các domain models và persistence layer của T01
from subtitle_localizer.domain.models import (
    BridgeEventV1,
    CommandEnvelopeV1,
    ModelDescriptorV1,
    OcrObservationV1,
    ProjectManifestV1,
    RegionTrackV1,
    StageRunV1,
    SubtitleCueV1,
)
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.persistence.store import AtomicArtifactStore


class DomainModelsTest(unittest.TestCase):
    def test_project_manifest_roundtrip_utf8(self) -> None:
        manifest = ProjectManifestV1(
            project_id="proj-001",
            title="Dự án phụ đề tiếng Việt & 中文 & 日本語 & 한국어",
            source_video_path="E:/videos/sample.mp4",
            video_fingerprint="abc123def456",
            source_language="zh",
            target_language="vi",
            active_revision=1,
        )
        data = manifest.to_dict()
        restored = ProjectManifestV1.from_dict(data)
        self.assertEqual(restored.project_id, "proj-001")
        self.assertEqual(restored.title, "Dự án phụ đề tiếng Việt & 中文 & 日本語 & 한국어")
        self.assertEqual(restored.schema_version, "project-manifest-v1")

    def test_subtitle_cue_validation_and_status(self) -> None:
        cue = SubtitleCueV1(
            cue_id="cue-01",
            start_pts=1.5,
            end_pts=3.8,
            source_text="你好世界",
            translated_text="Xin chào thế giới",
            status="auto",
            confidence=0.95,
        )
        self.assertEqual(cue.duration(), 2.3)
        self.assertFalse(cue.is_locked())
        cue.lock()
        self.assertTrue(cue.is_locked())
        self.assertEqual(cue.status, "locked")

    def test_region_track_normalized_bounds(self) -> None:
        region = RegionTrackV1(
            region_id="reg-01",
            x=0.1,
            y=0.8,
            width=0.8,
            height=0.15,
        )
        self.assertTrue(region.is_valid())
        invalid_region = RegionTrackV1(
            region_id="reg-inv",
            x=-0.1,
            y=0.8,
            width=1.5,
            height=0.2,
        )
        self.assertFalse(invalid_region.is_valid())

    def test_region_track_from_dict_handles_none_valid_pts(self) -> None:
        data = {
            "region_id": "reg-none",
            "x": 0.08,
            "y": 0.78,
            "width": 0.84,
            "height": 0.18,
            "valid_start_pts": None,
            "valid_end_pts": None,
        }
        track = RegionTrackV1.from_dict(data)
        self.assertEqual(track.valid_start_pts, 0.0)
        self.assertEqual(track.valid_end_pts, float("inf"))


class PersistenceAndOptimisticRevisionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.store = AtomicArtifactStore(Path(self.temp_dir.name) / "artifacts")

    def tearDown(self) -> None:
        self.db.close()
        self.temp_dir.cleanup()

    def test_project_crud_and_persistence(self) -> None:
        manifest = ProjectManifestV1(
            project_id="proj-100",
            title="Kiểm thử lưu trữ dự án",
            source_video_path="E:/videos/test.mp4",
            video_fingerprint="fp100",
            source_language="ja",
            target_language="vi",
            active_revision=1,
        )
        self.repo.save_project(manifest)
        loaded = self.repo.get_project("proj-100")
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.title, "Kiểm thử lưu trữ dự án")

    def test_optimistic_revision_conflict_rejection(self) -> None:
        manifest = ProjectManifestV1(
            project_id="proj-200",
            title="Dự án Revision",
            source_video_path="E:/videos/rev.mp4",
            video_fingerprint="fp200",
            source_language="en",
            target_language="vi",
            active_revision=1,
        )
        self.repo.save_project(manifest)

        # Cập nhật đúng revision 1 -> 2
        manifest.title = "Dự án Revision - Cập nhật"
        success = self.repo.update_project_revision(manifest, expected_revision=1)
        self.assertTrue(success)

        # Cố gắng cập nhật với revision cũ (1) khi hiện tại đã là 2 -> phải bị reject
        manifest.title = "Dự án Revision - Xung đột"
        conflict = self.repo.update_project_revision(manifest, expected_revision=1)
        self.assertFalse(conflict)

    def test_cues_batch_operations_and_locking(self) -> None:
        manifest = ProjectManifestV1(
            project_id="proj-100",
            title="Dự án cues",
            source_video_path="E:/videos/test.mp4",
            video_fingerprint="fp100",
            source_language="ja",
            target_language="vi",
            active_revision=1,
        )
        self.repo.save_project(manifest)
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="Line 1", translated_text="Dòng 1"),
            SubtitleCueV1(cue_id="c2", start_pts=1.2, end_pts=2.5, source_text="Line 2", translated_text="Dòng 2"),
        ]
        self.repo.save_cues("proj-100", cues)
        loaded_cues = self.repo.get_cues("proj-100")
        self.assertEqual(len(loaded_cues), 2)
        self.assertEqual(loaded_cues[0].source_text, "Line 1")

    def test_stage_run_lifecycle_and_metrics(self) -> None:
        manifest = ProjectManifestV1(
            project_id="proj-stage",
            title="Dự án stage test",
            source_video_path="E:/videos/test.mp4",
            video_fingerprint="fp_stage",
            source_language="en",
            target_language="vi",
        )
        self.repo.save_project(manifest)
        stage = StageRunV1(
            stage_name="ocr_inference",
            status="running",
            progress=0.45,
            metrics={"processed_frames": 90, "avg_fps": 30.2},
        )
        self.repo.save_stage_run("proj-stage", stage)
        runs = self.repo.get_stage_runs("proj-stage")
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0].stage_name, "ocr_inference")
        self.assertEqual(runs[0].metrics["processed_frames"], 90)

    def test_bridge_event_ordering_and_resumption(self) -> None:
        e1 = BridgeEventV1(event_id="ev-1", sequence=1, project_id="p1", job_id=None, event_type="started", payload={"step": 1})
        e2 = BridgeEventV1(event_id="ev-2", sequence=2, project_id="p1", job_id=None, event_type="progress", payload={"progress": 0.5})
        e3 = BridgeEventV1(event_id="ev-3", sequence=3, project_id="p1", job_id=None, event_type="completed", payload={"result": "ok"})
        self.repo.save_event(e1)
        self.repo.save_event(e2)
        self.repo.save_event(e3)

        # Giả lập client reconnect sau sequence 1 -> phải nhận được sequence 2 và 3
        resumed = self.repo.get_events_after(sequence=1)
        self.assertEqual(len(resumed), 2)
        self.assertEqual(resumed[0].sequence, 2)
        self.assertEqual(resumed[1].sequence, 3)

    def test_atomic_artifact_store_path_traversal_protection(self) -> None:
        with self.assertRaises(ValueError):
            self.store.write_atomic("../forbidden.txt", b"evil")

    def test_database_migration_idempotence(self) -> None:
        # Gọi migrate lần thứ 2, 3 không được gây ra lỗi
        self.db.migrate()
        self.db.migrate()
        manifest = ProjectManifestV1(
            project_id="proj-idempotent",
            title="Idempotent migration test",
            source_video_path="E:/videos/test.mp4",
            video_fingerprint="fp_idem",
            source_language="en",
            target_language="vi",
        )
        self.repo.save_project(manifest)
        self.assertIsNotNone(self.repo.get_project("proj-idempotent"))

    def test_project_delete_cascades_cues(self) -> None:
        manifest = ProjectManifestV1(
            project_id="proj-cascade",
            title="Cascade delete test",
            source_video_path="E:/videos/test.mp4",
            video_fingerprint="fp_casc",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(manifest)
        cues = [
            SubtitleCueV1(cue_id="c_casc_1", start_pts=0.0, end_pts=1.0, source_text="Line 1"),
        ]
        self.repo.save_cues("proj-cascade", cues)
        self.assertEqual(len(self.repo.get_cues("proj-cascade")), 1)

        # Xóa project
        deleted = self.repo.delete_project("proj-cascade")
        self.assertTrue(deleted)
        self.assertIsNone(self.repo.get_project("proj-cascade"))
        self.assertEqual(len(self.repo.get_cues("proj-cascade")), 0)


if __name__ == "__main__":
    unittest.main()
