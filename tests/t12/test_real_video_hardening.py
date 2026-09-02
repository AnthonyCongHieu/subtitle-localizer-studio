import json
import sqlite3
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1
from subtitle_localizer.detector.sampler import AdaptiveFrameSampler
from subtitle_localizer.ocr.preprocessing import build_ocr_candidates
from subtitle_localizer.ocr.registry import OcrRegistry
from subtitle_localizer.ocr.rapid import RapidOcrProvider
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.worker import BackgroundWorker
from subtitle_localizer.service.server import create_app
from subtitle_localizer.translation.real import RealTranslationProvider


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


class RealFrameSamplingTest(unittest.TestCase):
    class _SingleFrameCapture:
        def __init__(self) -> None:
            x_gradient = np.arange(100, dtype=np.uint8)[None, :, None]
            self.frame = np.broadcast_to(x_gradient, (100, 100, 3)).copy()

        def isOpened(self) -> bool:
            return True

        def get(self, prop: int) -> float:
            values = {
                cv2.CAP_PROP_FPS: 1.0,
                cv2.CAP_PROP_FRAME_COUNT: 1.0,
                cv2.CAP_PROP_FRAME_WIDTH: 100.0,
                cv2.CAP_PROP_FRAME_HEIGHT: 100.0,
                cv2.CAP_PROP_POS_MSEC: 1250.0,
            }
            return values.get(prop, 0.0)

        def set(self, prop: int, value: float) -> bool:
            return True

        def read(self):
            return True, self.frame.copy()

        def release(self) -> None:
            return None

    def test_non_square_roi_uses_width_for_x_end_and_decoder_timestamp(self) -> None:
        sampler = AdaptiveFrameSampler(sample_fps=1.0)
        fake_capture = self._SingleFrameCapture()

        with patch("cv2.VideoCapture", return_value=fake_capture):
            crops, timestamps = sampler.sample_video_frames(
                "C:/input/video.mp4",
                roi_norm=(0.10, 0.70, 0.50, 0.10),
            )

        self.assertEqual(crops[0].shape, (10, 50, 3))
        self.assertEqual(int(crops[0][0, 0, 0]), 10)
        self.assertEqual(int(crops[0][0, -1, 0]), 59)
        self.assertEqual(timestamps, [1.25])

    def test_ocr_candidates_keep_original_and_preserve_image_dimensions(self) -> None:
        crop = np.full((8, 12, 3), 120, dtype=np.uint8)

        candidates = build_ocr_candidates(crop)

        self.assertIs(candidates[0], crop)
        self.assertEqual(len(candidates), 3)
        self.assertTrue(all(item.shape[:2] == (8, 12) for item in candidates))
        self.assertEqual(candidates[1].ndim, 2)
        self.assertEqual(candidates[2].ndim, 2)


class RealOnlyPipelineTest(unittest.TestCase):
    class _FailingOcrProvider:
        def __init__(self) -> None:
            self.unloaded = False

        def load(self) -> None:
            return None

        def recognize(self, crops, pts_list, language="zh"):
            raise RuntimeError("OCR unavailable")

        def unload(self) -> None:
            self.unloaded = True

    class _CandidateScoringEngine:
        def __init__(self) -> None:
            self.call_count = 0

        def __call__(self, image):
            self.call_count += 1
            scores = [0.55, 0.93, 0.70]
            texts = ["错误", "正确字幕", "候选"]
            index = self.call_count - 1
            return [([0, 0, 10, 10], texts[index], scores[index])], 0.01

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db = Database(Path(self.temp_dir.name) / "worker.db")
        self.db.migrate()
        self.repo = ProjectRepository(self.db)

    def tearDown(self) -> None:
        self.db.close()
        self.temp_dir.cleanup()

    def _save_video_project(self, video_path: Path, project_id: str = "real-project") -> None:
        self.repo.save_project(
            ProjectManifestV1(
                project_id=project_id,
                title="Real OCR",
                source_video_path=str(video_path),
                video_fingerprint="real-video-fingerprint",
                source_language="zh",
                target_language="none",
            )
        )

    def test_rapid_ocr_rejects_invalid_encoded_bytes_instead_of_mocking(self) -> None:
        provider = RapidOcrProvider()
        provider.is_loaded = True
        provider.engine = object()

        with self.assertRaisesRegex(RuntimeError, "valid decoded image"):
            provider.recognize([b"not-an-image"], [1.0], "zh")

    def test_rapid_ocr_stops_rescue_after_high_confidence_candidate(self) -> None:
        provider = RapidOcrProvider()
        engine = self._CandidateScoringEngine()
        provider.is_loaded = True
        provider.engine = engine

        observations = provider.recognize(
            [np.full((16, 32, 3), 128, dtype=np.uint8)],
            [2.5],
            "zh",
        )

        self.assertEqual(engine.call_count, 2)
        self.assertEqual(observations[0].raw_text, "正确字幕")
        self.assertEqual(observations[0].confidence, 0.93)
        self.assertEqual(observations[0].model_metadata["engine"], "rapidocr-onnx")
        self.assertEqual(observations[0].preprocessing_metadata["candidate_index"], 1)

    def test_rapid_ocr_uses_only_original_when_it_is_high_confidence(self) -> None:
        class HighConfidenceEngine:
            def __init__(self) -> None:
                self.call_count = 0

            def __call__(self, image):
                self.call_count += 1
                return [([0, 0, 10, 10], "高质量字幕", 0.97)], 0.01

        provider = RapidOcrProvider()
        engine = HighConfidenceEngine()
        provider.is_loaded = True
        provider.engine = engine

        observations = provider.recognize(
            [np.full((16, 32, 3), 128, dtype=np.uint8)],
            [2.5],
            "zh",
        )

        self.assertEqual(engine.call_count, 1)
        self.assertEqual(observations[0].raw_text, "高质量字幕")

    def test_chinese_ocr_discards_latin_only_lines_but_keeps_chinese_numbers(self) -> None:
        class BilingualEngine:
            def __call__(self, image):
                return [
                    ([0, 0, 10, 10], "第6趟车", 0.96),
                    ([0, 10, 10, 20], "The sixth train", 0.99),
                ], 0.01

        provider = RapidOcrProvider()
        provider.is_loaded = True
        provider.engine = BilingualEngine()

        observations = provider.recognize(
            [np.full((16, 32, 3), 128, dtype=np.uint8)],
            [2.5],
            "zh",
        )

        self.assertEqual(observations[0].raw_text, "第6趟车")
        self.assertNotIn("sixth", observations[0].raw_text)

    def test_production_registry_does_not_fall_back_to_mock_or_paddle(self) -> None:
        registry = OcrRegistry()
        registry._providers.pop("rapidocr")

        with self.assertRaisesRegex(RuntimeError, "production OCR provider"):
            registry.get_provider_for_language("zh")

    def test_translation_failure_does_not_copy_source_as_success(self) -> None:
        class FailingGoogleTranslator:
            def __init__(self, source: str, target: str) -> None:
                return None

            def translate(self, text: str) -> str:
                raise ConnectionError("translation offline")

        provider = RealTranslationProvider()
        cue = SubtitleCueV1(
            cue_id="cue-translation",
            start_pts=0.0,
            end_pts=1.0,
            source_text="真实字幕",
        )

        with patch.dict(
            sys.modules,
            {"deep_translator": SimpleNamespace(GoogleTranslator=FailingGoogleTranslator)},
        ):
            with self.assertRaisesRegex(RuntimeError, "translation offline"):
                provider.translate_cues([cue], source_lang="zh", target_lang="vi")

        self.assertEqual(cue.translated_text, "")

    def test_missing_video_records_failed_stage_without_mock_cues(self) -> None:
        missing_video = Path(self.temp_dir.name) / "missing.mp4"
        self._save_video_project(missing_video)

        success = BackgroundWorker(self.repo).run_pipeline_synchronous("real-project")

        self.assertFalse(success)
        self.assertEqual(self.repo.get_cues("real-project"), [])
        failed_stage = self.repo.get_stage_runs("real-project")[-1]
        self.assertEqual(failed_stage.status, "failed")
        self.assertIn("does not exist", failed_stage.errors[0])

    def test_worker_records_provider_failure_and_always_unloads(self) -> None:
        video_path = Path(self.temp_dir.name) / "video.mp4"
        video_path.write_bytes(b"real-file-placeholder")
        self._save_video_project(video_path)
        worker = BackgroundWorker(self.repo)
        failing_provider = self._FailingOcrProvider()

        with (
            patch.object(
                worker.sampler,
                "sample_video_frames",
                return_value=([np.zeros((10, 10, 3), dtype=np.uint8)], [0.5]),
            ),
            patch.object(
                worker.ocr_registry,
                "get_provider_for_language",
                return_value=failing_provider,
            ),
        ):
            success = worker.run_pipeline_synchronous("real-project")

        self.assertFalse(success)
        self.assertTrue(failing_provider.unloaded)
        failed_stage = self.repo.get_stage_runs("real-project")[-1]
        self.assertEqual(failed_stage.status, "failed")
        self.assertEqual(failed_stage.errors, ["OCR unavailable"])

    def test_regions_endpoint_persists_reviewed_roi(self) -> None:
        from fastapi.testclient import TestClient

        video_path = Path(self.temp_dir.name) / "video.mp4"
        video_path.write_bytes(b"real-file-placeholder")
        self._save_video_project(video_path)
        app = create_app(database=self.db, repo=self.repo, auth_token="test-token")
        region = {
            "region_id": "reviewed",
            "x": 0.1,
            "y": 0.72,
            "width": 0.8,
            "height": 0.2,
        }

        response = TestClient(app).put(
            "/api/v1/projects/real-project/regions",
            json=[region],
            headers={"Authorization": "Bearer test-token"},
        )

        self.assertEqual(response.status_code, 200)
        saved = self.repo.get_project("real-project")
        self.assertEqual(saved.regions[0].region_id, "reviewed")
        self.assertEqual(saved.regions[0].x, 0.1)
        self.assertEqual(saved.regions[0].width, 0.8)

    def test_regions_endpoint_rejects_out_of_bounds_roi(self) -> None:
        from fastapi.testclient import TestClient

        video_path = Path(self.temp_dir.name) / "video.mp4"
        video_path.write_bytes(b"real-file-placeholder")
        self._save_video_project(video_path)
        app = create_app(database=self.db, repo=self.repo, auth_token="test-token")

        response = TestClient(app).put(
            "/api/v1/projects/real-project/regions",
            json=[
                {
                    "region_id": "invalid",
                    "x": 0.8,
                    "y": 0.8,
                    "width": 0.5,
                    "height": 0.5,
                }
            ],
            headers={"Authorization": "Bearer test-token"},
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.repo.get_project("real-project").regions, [])

    def test_pyproject_declares_real_runtime_dependencies(self) -> None:
        project = tomllib.loads(
            (REPOSITORY_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        )["project"]
        dependency_names = {
            dependency.split(">=")[0].split("==")[0]
            for dependency in project["dependencies"]
        }

        self.assertTrue(
            {
                "fastapi",
                "uvicorn",
                "numpy",
                "opencv-python",
                "rapidocr-onnxruntime",
                "deep-translator",
                "python-multipart",
            }.issubset(dependency_names)
        )


if __name__ == "__main__":
    unittest.main()
