import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))
sys.path.insert(0, str(REPOSITORY_ROOT / "scripts"))

import run_real_video_batch as batch
from subtitle_localizer.domain.models import SubtitleCueV1


class RealVideoBatchContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.input_dir = self.root / "input"
        self.output_dir = self.root / "output"
        self.input_dir.mkdir()
        (self.input_dir / "clip.mp4").write_bytes(b"test-video-placeholder")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    @staticmethod
    def _successful_real_ocr(*args, **kwargs) -> batch.OcrRunResult:
        return batch.OcrRunResult(
            cues=[
                SubtitleCueV1(
                    cue_id="cue-0001",
                    start_pts=1.25,
                    end_pts=2.75,
                    source_text="真实中文字幕",
                    confidence=0.94,
                )
            ],
            engine_id="rapidocr-onnx",
            elapsed_seconds=1.5,
            warnings=[],
        )

    def test_batch_runner_writes_parseable_report_and_utf8_exports(self) -> None:
        with patch.object(batch, "run_project_ocr", side_effect=self._successful_real_ocr):
            exit_code = batch.main(
                [
                    "--input-dir",
                    str(self.input_dir),
                    "--output-dir",
                    str(self.output_dir),
                    "--language",
                    "zh",
                    "--no-translate",
                ]
            )

        video_output = self.output_dir / "clip"
        report = json.loads(
            (video_output / "clip.report.json").read_text(encoding="utf-8")
        )
        srt_text = (video_output / "clip.zh.srt").read_text(encoding="utf-8")
        ass_text = (video_output / "clip.zh.ass").read_text(encoding="utf-8")

        self.assertEqual(exit_code, 0)
        self.assertEqual(report["status"], "completed")
        self.assertEqual(report["ocr_engine"], "rapidocr-onnx")
        self.assertEqual(report["cue_count"], 1)
        self.assertIn("真实中文字幕", srt_text)
        self.assertIn("真实中文字幕", ass_text)
        self.assertNotIn("Sample text", srt_text)
        self.assertEqual(report["sample_cues"][0]["source_text"], "真实中文字幕")

    def test_batch_runner_records_failure_and_returns_nonzero(self) -> None:
        with patch.object(
            batch,
            "run_project_ocr",
            side_effect=RuntimeError("RapidOCR model unavailable"),
        ):
            exit_code = batch.main(
                [
                    "--input-dir",
                    str(self.input_dir),
                    "--output-dir",
                    str(self.output_dir),
                    "--no-translate",
                ]
            )

        report = json.loads(
            (self.output_dir / "clip" / "clip.report.json").read_text(encoding="utf-8")
        )
        self.assertEqual(exit_code, 1)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["errors"], ["RapidOCR model unavailable"])
        self.assertFalse((self.output_dir / "clip" / "clip.zh.srt").exists())


if __name__ == "__main__":
    unittest.main()
