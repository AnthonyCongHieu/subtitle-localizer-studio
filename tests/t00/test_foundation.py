from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer_t00.benchmarks import (
    make_not_run_result,
    validate_benchmark_input,
    validate_benchmark_result,
)
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

    def test_rejects_relative_or_internal_ground_truth_path(self) -> None:
        manifest = self._manifest(Path("E:/external/clip.mp4"), "a" * 64)
        manifest["clips"][0]["ground_truth_path"] = "relative/ground_truth.srt"
        errors = validate_golden_manifest(manifest, REPOSITORY_ROOT, verify_files=False)
        self.assertTrue(any("ground_truth_path" in err and "outside" in err for err in errors))

        manifest2 = self._manifest(Path("E:/external/clip.mp4"), "a" * 64)
        manifest2["clips"][0]["ground_truth_path"] = str(REPOSITORY_ROOT / "fixtures" / "truth.srt")
        errors2 = validate_golden_manifest(manifest2, REPOSITORY_ROOT, verify_files=False)
        self.assertTrue(any("ground_truth_path" in err and "outside" in err for err in errors2))

    def test_rejects_golden_manifest_missing_language_coverage(self) -> None:
        manifest = self._manifest(Path("E:/external/clip.mp4"), "a" * 64)
        for clip in manifest["clips"]:
            clip["language"] = "zh"
        errors = validate_golden_manifest(manifest, REPOSITORY_ROOT, verify_files=False)
        self.assertTrue(any("language" in err.lower() and ("coverage" in err.lower() or "missing" in err.lower() or "must cover" in err.lower()) for err in errors))

    def test_rejects_golden_manifest_missing_orientation_coverage(self) -> None:
        manifest = self._manifest(Path("E:/external/clip.mp4"), "a" * 64)
        for clip in manifest["clips"]:
            clip["orientation"] = "portrait"
        errors = validate_golden_manifest(manifest, REPOSITORY_ROOT, verify_files=False)
        self.assertTrue(any("orientation" in err.lower() and ("coverage" in err.lower() or "both" in err.lower() or "must cover" in err.lower()) for err in errors))

    def test_rejects_golden_manifest_missing_pts_mode_coverage(self) -> None:
        manifest = self._manifest(Path("E:/external/clip.mp4"), "a" * 64)
        for clip in manifest["clips"]:
            clip["pts_mode"] = "cfr"
        errors = validate_golden_manifest(manifest, REPOSITORY_ROOT, verify_files=False)
        self.assertTrue(any("pts_mode" in err.lower() and ("coverage" in err.lower() or "both" in err.lower() or "must cover" in err.lower()) for err in errors))

    def test_rejects_invalid_golden_difficulty(self) -> None:
        manifest = self._manifest(Path("E:/external/clip.mp4"), "a" * 64)
        manifest["clips"][0]["difficulty"] = "nonsense"
        errors = validate_golden_manifest(manifest, REPOSITORY_ROOT, verify_files=False)
        self.assertTrue(any("difficulty" in err.lower() for err in errors))

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

    def test_accepts_valid_golden_manifest_example(self) -> None:
        example_path = REPOSITORY_ROOT / "benchmarks" / "golden_manifest.example.json"
        manifest = json.loads(example_path.read_text(encoding="utf-8"))
        errors = validate_golden_manifest(manifest, REPOSITORY_ROOT, verify_files=False)
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
                        "id": "multilingual-cfr",
                        "path": "cfr.mp4",
                        "timing": "cfr",
                        "sha256": "f" * 64,
                        "languages": ["zh", "ja", "ko", "en", "vi"],
                        "ffprobe": {"format": {"duration": "2.0"}},
                    },
                    {
                        "id": "multilingual-vfr",
                        "path": "vfr.mp4",
                        "timing": "vfr",
                        "sha256": "e" * 64,
                        "languages": ["zh", "ja", "ko", "en", "vi"],
                        "ffprobe": {"format": {"duration": "2.0"}, "frame_pts_seconds": [0.0, 0.7, 1.8, 2.4, 3.7, 4.9]},
                    },
                ],
            }

            errors = validate_fixture_manifest(manifest, root, verify_files=True)

        self.assertTrue(any("sha256 mismatch" in error for error in errors))

    def test_rejects_truncated_or_invalid_fixture_sha(self) -> None:
        manifest = {
            "schema_version": "synthetic-fixture-manifest-v1",
            "fixtures": [
                {
                    "id": "multilingual-cfr",
                    "path": "cfr.mp4",
                    "timing": "cfr",
                    "sha256": "dac31533b41a20fe4ef091df199dd2be6e06055805a26751c53c03889230b",  # 63 chars
                    "languages": ["zh", "ja", "ko", "en", "vi"],
                    "ffprobe": {"format": {"duration": "2.0"}},
                },
                {
                    "id": "multilingual-vfr",
                    "path": "vfr.mp4",
                    "timing": "vfr",
                    "sha256": "dac31533b41a20fe4ef091df199dd2be6e06055805a26751c53c03889230bafd",
                    "languages": ["zh", "ja", "ko", "en", "vi"],
                    "ffprobe": {"format": {"duration": "2.0"}, "frame_pts_seconds": [0.0, 0.7, 1.8, 2.4, 3.7, 4.9]},
                },
            ],
        }
        errors = validate_fixture_manifest(manifest, Path("."), verify_files=False)
        self.assertTrue(any("sha256" in err for err in errors))

    def test_rejects_absolute_machine_path_in_fixture_manifest(self) -> None:
        manifest = {
            "schema_version": "synthetic-fixture-manifest-v1",
            "fixtures": [
                {
                    "id": "multilingual-cfr",
                    "path": "cfr.mp4",
                    "timing": "cfr",
                    "sha256": "a" * 64,
                    "languages": ["zh", "ja", "ko", "en", "vi"],
                    "ffprobe": {"format": {"filename": "D:\\Project\\multilingual-cfr.mp4"}},
                },
                {
                    "id": "multilingual-vfr",
                    "path": "vfr.mp4",
                    "timing": "vfr",
                    "sha256": "b" * 64,
                    "languages": ["zh", "ja", "ko", "en", "vi"],
                    "ffprobe": {"format": {"duration": "2.0"}, "frame_pts_seconds": [0.0, 0.7, 1.8, 2.4, 3.7, 4.9]},
                },
            ],
        }
        errors = validate_fixture_manifest(manifest, Path("."), verify_files=False)
        self.assertTrue(any("absolute" in err.lower() or "machine" in err.lower() or "portable" in err.lower() or "filename" in err.lower() for err in errors))

    def test_rejects_mismatched_vfr_frame_pts(self) -> None:
        manifest = {
            "schema_version": "synthetic-fixture-manifest-v1",
            "fixtures": [
                {
                    "id": "multilingual-cfr",
                    "path": "cfr.mp4",
                    "timing": "cfr",
                    "sha256": "a" * 64,
                    "languages": ["zh", "ja", "ko", "en", "vi"],
                    "ffprobe": {"format": {"duration": "5.0"}},
                },
                {
                    "id": "multilingual-vfr",
                    "path": "vfr.mp4",
                    "timing": "vfr",
                    "sha256": "b" * 64,
                    "languages": ["zh", "ja", "ko", "en", "vi"],
                    "ffprobe": {"format": {"duration": "5.0"}, "frame_pts_seconds": [0.0, 1.0, 2.0, 3.0]},
                },
            ],
        }
        errors = validate_fixture_manifest(manifest, Path("."), verify_files=False)
        self.assertTrue(any("pts" in err.lower() or "frame" in err.lower() for err in errors))

    def test_accepts_deterministic_fixture_metadata_for_cfr_and_vfr(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixtures = [
                {
                    "id": "multilingual-cfr",
                    "path": "cfr.mp4",
                    "timing": "cfr",
                    "sha256": hashlib.sha256(b"cfr").hexdigest(),
                    "languages": ["zh", "ja", "ko", "en", "vi"],
                    "ffprobe": {"format": {"duration": "2.0"}},
                },
                {
                    "id": "multilingual-vfr",
                    "path": "vfr.mp4",
                    "timing": "vfr",
                    "sha256": hashlib.sha256(b"vfr").hexdigest(),
                    "languages": ["zh", "ja", "ko", "en", "vi"],
                    "ffprobe": {"format": {"duration": "2.0"}, "frame_pts_seconds": [0.0, 0.7, 1.8, 2.4, 3.7, 4.9]},
                },
            ]
            (root / "cfr.mp4").write_bytes(b"cfr")
            (root / "vfr.mp4").write_bytes(b"vfr")

            errors = validate_fixture_manifest(
                {"schema_version": "synthetic-fixture-manifest-v1", "fixtures": fixtures},
                root,
                verify_files=True,
            )

        self.assertEqual(errors, [])

    def test_accepts_committed_fixture_audit_manifest(self) -> None:
        manifest_path = REPOSITORY_ROOT / "fixtures" / "synthetic" / "fixture_manifest.json"
        self.assertTrue(manifest_path.exists(), "fixture_manifest.json must exist in fixtures/synthetic/")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        errors = validate_fixture_manifest(manifest, manifest_path.parent, verify_files=False)
        self.assertEqual(errors, [])


class BenchmarkTests(unittest.TestCase):
    def test_rejects_benchmark_input_without_required_measurements(self) -> None:
        errors = validate_benchmark_input({"schema_version": "benchmark-input-v1"})

        self.assertIn("missing required field: detector", errors)

    def test_rejects_empty_nested_objects_in_benchmark_input(self) -> None:
        payload = {
            "schema_version": "benchmark-input-v1",
            "detector": {},
            "ocr": {},
            "translation": {},
            "timing": {},
            "memory": {},
            "disk": {},
            "utf8_gate": {},
        }
        errors = validate_benchmark_input(payload)
        self.assertTrue(len(errors) > 0)
        self.assertTrue(any("detector" in err for err in errors))

    def test_rejects_missing_or_invalid_nested_fields_in_benchmark_input(self) -> None:
        payload = {
            "schema_version": "benchmark-input-v1",
            "detector": {"candidate": "native", "version": ""},
            "ocr": {"candidate": "", "model": "v6"},
            "translation": {"candidate": "gemma", "runtime": "not-run"},
            "timing": {"pts_required": "not-a-bool", "median_error_ms": -5, "p95_error_ms": 300},
            "memory": {"peak_ram_bytes": "invalid", "peak_vram_bytes": 0},
            "disk": {"cache_bytes": 100, "output_bytes": -1},
            "utf8_gate": {"reject_replacement_character": "yes", "reject_mojibake": True},
        }
        errors = validate_benchmark_input(payload)
        self.assertTrue(len(errors) >= 5)

    def test_dry_run_result_is_explicitly_not_run_when_golden_data_is_missing(self) -> None:
        result = make_not_run_result("golden clips are unavailable")

        self.assertEqual(result["decision"], "not_run")
        self.assertEqual(result["quality_metrics"], None)
        self.assertIn("golden clips", result["reason"])

    def test_rejects_invalid_decision_or_empty_reason_in_benchmark_result(self) -> None:
        invalid_decision = {
            "schema_version": "benchmark-result-v1",
            "decision": "unknown_decision",
            "reason": "some reason",
            "quality_metrics": None,
            "measurements": {"wall_seconds": None, "fps": None, "peak_ram_bytes": None, "peak_vram_bytes": None, "disk_bytes": None},
        }
        self.assertTrue(any("decision" in err for err in validate_benchmark_result(invalid_decision)))

        empty_reason = {
            "schema_version": "benchmark-result-v1",
            "decision": "not_run",
            "reason": "   ",
            "quality_metrics": None,
            "measurements": {"wall_seconds": None, "fps": None, "peak_ram_bytes": None, "peak_vram_bytes": None, "disk_bytes": None},
        }
        self.assertTrue(any("reason" in err for err in validate_benchmark_result(empty_reason)))

    def test_rejects_measured_result_without_required_metrics(self) -> None:
        measured_missing_quality = {
            "schema_version": "benchmark-result-v1",
            "decision": "measured",
            "reason": "measured on golden set",
            "quality_metrics": None,
            "measurements": {"wall_seconds": 12.0, "fps": 30.0, "peak_ram_bytes": 1000000, "peak_vram_bytes": 500000, "disk_bytes": 2000},
        }
        errors = validate_benchmark_result(measured_missing_quality)
        self.assertTrue(any("quality_metrics" in err for err in errors))

    def test_accepts_valid_not_run_result_from_make_not_run_result(self) -> None:
        result = make_not_run_result("golden clips are unavailable")
        errors = validate_benchmark_result(result)
        self.assertEqual(errors, [])

    def test_accepts_committed_benchmark_input_example(self) -> None:
        example_path = REPOSITORY_ROOT / "benchmarks" / "benchmark_input.example.json"
        payload = json.loads(example_path.read_text(encoding="utf-8"))
        errors = validate_benchmark_input(payload)
        self.assertEqual(errors, [])


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
