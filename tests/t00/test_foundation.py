from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer_t00.benchmarks import make_not_run_result, validate_benchmark_input
from subtitle_localizer_t00.capabilities import canonical_probe_payload, parse_tool_version
from subtitle_localizer_t00.fixtures import has_variable_frame_intervals, validate_fixture_manifest
from subtitle_localizer_t00.golden import validate_golden_manifest
from subtitle_localizer_t00.provenance import validate_source_matrix
from subtitle_localizer_t00.utf8scan import scan_text


class CapabilityTests(unittest.TestCase):
    def test_parse_tool_version_extracts_first_version_after_tool_name(self) -> None:
        self.assertEqual(
            parse_tool_version("ffmpeg version 8.0-full_build", "ffmpeg"),
            "8.0-full_build",
        )

    def test_probe_payload_requires_runtime_and_disk_sections(self) -> None:
        payload = canonical_probe_payload({"python": {"version": "3.11"}})

        self.assertIn("runtime", payload)
        self.assertIn("disk", payload)
        self.assertEqual(payload["runtime"]["python"]["version"], "3.11")


class GoldenManifestTests(unittest.TestCase):
    def _manifest(self, video_path: Path, sha256: str) -> dict[str, object]:
        return {
            "schema_version": "golden-manifest-v1",
            "clips": [
                {
                    "id": "zh-portrait-vfr",
                    "video_path": str(video_path),
                    "sha256": sha256,
                    "language": "zh",
                    "orientation": "portrait",
                    "difficulty": "difficult",
                    "ground_truth_path": str(video_path.with_suffix(".srt")),
                    "pts_mode": "vfr",
                },
                {
                    "id": "ja-landscape-cfr",
                    "video_path": str(video_path),
                    "sha256": sha256,
                    "language": "ja",
                    "orientation": "landscape",
                    "difficulty": "clean",
                    "ground_truth_path": str(video_path.with_suffix(".srt")),
                    "pts_mode": "cfr",
                },
                {
                    "id": "ko-portrait-cfr",
                    "video_path": str(video_path),
                    "sha256": sha256,
                    "language": "ko",
                    "orientation": "portrait",
                    "difficulty": "clean",
                    "ground_truth_path": str(video_path.with_suffix(".srt")),
                    "pts_mode": "cfr",
                },
                {
                    "id": "en-landscape-vfr",
                    "video_path": str(video_path),
                    "sha256": sha256,
                    "language": "en",
                    "orientation": "landscape",
                    "difficulty": "difficult",
                    "ground_truth_path": str(video_path.with_suffix(".srt")),
                    "pts_mode": "vfr",
                },
            ],
        }

    def test_rejects_video_path_inside_repository(self) -> None:
        manifest = self._manifest(REPOSITORY_ROOT / "fixtures" / "forbidden.mp4", "a" * 64)

        errors = validate_golden_manifest(manifest, REPOSITORY_ROOT, verify_files=False)

        self.assertTrue(any("outside the repository" in error for error in errors))

    def test_rejects_hash_mismatch_for_external_clip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            video_path = Path(directory) / "clip.mp4"
            video_path.write_bytes(b"external clip bytes")
            video_path.with_suffix(".srt").write_text("1\n00:00:00,000 --> 00:00:01,000\ntest\n", encoding="utf-8")
            manifest = self._manifest(video_path, "0" * 64)

            errors = validate_golden_manifest(manifest, REPOSITORY_ROOT, verify_files=True)

        self.assertTrue(any("sha256 mismatch" in error for error in errors))

    def test_accepts_matching_external_clip_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            video_path = Path(directory) / "clip.mp4"
            video_path.write_bytes(b"external clip bytes")
            video_path.with_suffix(".srt").write_text("1\n00:00:00,000 --> 00:00:01,000\ntest\n", encoding="utf-8")
            digest = hashlib.sha256(video_path.read_bytes()).hexdigest()
            manifest = self._manifest(video_path, digest)

            errors = validate_golden_manifest(manifest, REPOSITORY_ROOT, verify_files=True)

        self.assertEqual(errors, [])


class FixtureManifestTests(unittest.TestCase):
    def test_detects_non_uniform_frame_intervals_for_vfr_fixture_verification(self) -> None:
        self.assertTrue(has_variable_frame_intervals([0.0, 0.7, 1.8, 2.4]))
        self.assertFalse(has_variable_frame_intervals([0.0, 0.1, 0.2, 0.3]))

    def test_rejects_fixture_manifest_with_wrong_checksum(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture_path = root / "cfr.mp4"
            fixture_path.write_bytes(b"fixture")
            manifest = {
                "schema_version": "synthetic-fixture-manifest-v1",
                "fixtures": [
                    {
                        "id": "cfr",
                        "path": "cfr.mp4",
                        "timing": "cfr",
                        "sha256": "f" * 64,
                        "languages": ["zh", "ja", "ko", "en", "vi"],
                        "ffprobe": {"format": {"duration": "2.0"}},
                    }
                ],
            }

            errors = validate_fixture_manifest(manifest, root, verify_files=True)

        self.assertTrue(any("sha256 mismatch" in error for error in errors))

    def test_accepts_deterministic_fixture_metadata_for_cfr_and_vfr(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixtures = []
            for timing in ("cfr", "vfr"):
                path = root / f"{timing}.mp4"
                path.write_bytes(timing.encode("ascii"))
                fixtures.append(
                    {
                        "id": timing,
                        "path": path.name,
                        "timing": timing,
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "languages": ["zh", "ja", "ko", "en", "vi"],
                        "ffprobe": {"format": {"duration": "2.0"}},
                    }
                )

            errors = validate_fixture_manifest(
                {"schema_version": "synthetic-fixture-manifest-v1", "fixtures": fixtures},
                root,
                verify_files=True,
            )

        self.assertEqual(errors, [])


class BenchmarkTests(unittest.TestCase):
    def test_rejects_benchmark_input_without_required_measurements(self) -> None:
        errors = validate_benchmark_input({"schema_version": "benchmark-input-v1"})

        self.assertIn("missing required field: detector", errors)

    def test_dry_run_result_is_explicitly_not_run_when_golden_data_is_missing(self) -> None:
        result = make_not_run_result("golden clips are unavailable")

        self.assertEqual(result["decision"], "not_run")
        self.assertEqual(result["quality_metrics"], None)
        self.assertIn("golden clips", result["reason"])


class ProvenanceTests(unittest.TestCase):
    def test_rejects_verified_source_without_pinned_commit(self) -> None:
        matrix = {
            "schema_version": "source-matrix-v1",
            "sources": [
                {
                    "id": "paddleocr",
                    "official_url": "https://github.com/PaddlePaddle/PaddleOCR",
                    "evidence_type": "remote_git",
                    "pinned_ref": "",
                    "license": "Apache-2.0",
                    "languages": ["zh", "ja", "ko", "en"],
                    "runtime": "PaddlePaddle",
                    "hardware_notes": "GPU optional",
                    "verification_status": "verified",
                }
            ],
        }

        errors = validate_source_matrix(matrix)

        self.assertIn("paddleocr: verified remote_git source requires a 40-character pinned_ref", errors)

    def test_accepts_verified_source_with_complete_provenance(self) -> None:
        matrix = {
            "schema_version": "source-matrix-v1",
            "sources": [
                {
                    "id": "paddleocr",
                    "official_url": "https://github.com/PaddlePaddle/PaddleOCR",
                    "evidence_type": "remote_git",
                    "pinned_ref": "a" * 40,
                    "license": "Apache-2.0",
                    "languages": ["zh", "ja", "ko", "en"],
                    "runtime": "PaddlePaddle",
                    "hardware_notes": "GPU optional",
                    "verification_status": "verified",
                }
            ],
        }

        self.assertEqual(validate_source_matrix(matrix), [])


class Utf8ScanTests(unittest.TestCase):
    def test_reports_replacement_and_mojibake_indicators_without_flagging_vietnamese(self) -> None:
        findings = scan_text("Tiếng Việt hợp lệ\n\u00e3\u201a¹\u00e3\u0192Ÿ\ntext\ufffd")

        self.assertIn("mojibake indicator", findings)
        self.assertIn("replacement character", findings)

    def test_accepts_cjk_and_vietnamese_text(self) -> None:
        self.assertEqual(scan_text("中文 日本語 한국어 Tiếng Việt"), [])


if __name__ == "__main__":
    unittest.main()
