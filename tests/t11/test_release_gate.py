import json
import sys
import tempfile
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.detector.roi import propose_default_roi
from subtitle_localizer.domain.models import ProjectManifestV1
from subtitle_localizer.media.pts import PtsTimelineMapper
from subtitle_localizer.ocr.mock import MockOcrProvider
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.reconstruction.builder import CueReconstructor
from subtitle_localizer.render.ass import AssExporter
from subtitle_localizer.render.srt import SrtExporter
from subtitle_localizer.translation.mock import MockTranslationProvider


class ReleaseGateE2ETest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.temp_dir.name) / "e2e_release.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)

    def tearDown(self) -> None:
        self.db.close()
        import gc
        gc.collect()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_full_pipeline_end_to_end(self) -> None:
        # 1. Khởi tạo Project
        manifest = ProjectManifestV1(
            project_id="e2e-proj-1",
            title="Dự án E2E Release Verification",
            source_video_path="E:/videos/sample.mp4",
            video_fingerprint="fp_e2e_12345",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(manifest)

        # 2. PTS Mapping
        pts_list = [1.0, 1.3, 1.6, 2.0, 3.5, 3.8, 4.2]
        mapper = PtsTimelineMapper(pts_list, is_vfr=False, fps=25.0)
        self.assertEqual(mapper.total_frames(), 7)

        # 3. ROI Proposal
        roi = propose_default_roi(1920, 1080)
        manifest.regions.append(roi)
        self.repo.save_project(manifest)

        # 4. OCR Inference
        ocr = MockOcrProvider()
        observations = ocr.recognize(
            crops=[b"crop"] * len(pts_list),
            pts_list=pts_list,
            language="zh",
        )
        self.assertEqual(len(observations), 7)

        # 5. Cue Reconstruction
        reconstructor = CueReconstructor(min_cue_duration=0.25)
        cues = reconstructor.build_cues(observations)
        self.assertTrue(len(cues) >= 1)

        # 6. Translation
        translator = MockTranslationProvider()
        translated_cues = translator.translate_cues(cues, source_lang="zh", target_lang="vi")
        self.assertTrue(len(translated_cues[0].translated_text) > 0)
        self.assertIn("tiếng Trung", translated_cues[0].translated_text)

        # 7. Lưu Database
        self.repo.save_cues("e2e-proj-1", translated_cues)

        # 8. Render SRT và ASS
        srt_exporter = SrtExporter()
        srt_text = srt_exporter.export_srt_text(translated_cues)
        self.assertIn("-->", srt_text)

        ass_exporter = AssExporter()
        ass_text = ass_exporter.export_ass_text(translated_cues)
        self.assertIn("[Script Info]", ass_text)
        self.assertIn("[Events]", ass_text)

        # 9. Database Restart Simulation
        self.db.close()
        new_db = Database(self.db_path)
        new_repo = ProjectRepository(new_db)
        reloaded_proj = new_repo.get_project("e2e-proj-1")
        reloaded_cues = new_repo.get_cues("e2e-proj-1")
        self.assertIsNotNone(reloaded_proj)
        self.assertEqual(len(reloaded_cues), len(translated_cues))
        new_db.close()

    def test_golden_benchmark_gate_integrity(self) -> None:
        import subprocess
        script_path = REPOSITORY_ROOT / "scripts" / "t00" / "validate_golden.py"
        example_manifest = REPOSITORY_ROOT / "benchmarks" / "golden_manifest.example.json"

        # Chạy validation không verify files -> phải pass (exit 0)
        res = subprocess.run(
            [sys.executable, str(script_path), str(example_manifest)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0)

        # Chạy validation có --verify-files -> phải exit 1 do golden clips thực tế chưa có (chặn hợp lệ)
        res_verify = subprocess.run(
            [sys.executable, str(script_path), str(example_manifest), "--verify-files"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res_verify.returncode, 1)


if __name__ == "__main__":
    unittest.main()
