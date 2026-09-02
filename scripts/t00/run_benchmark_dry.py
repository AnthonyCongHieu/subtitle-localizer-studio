from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer_t00.benchmarks import make_not_run_result, validate_benchmark_input
from subtitle_localizer_t00.golden import validate_golden_manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate T00 benchmark inputs and make no model inference.")
    parser.add_argument("--input", type=Path, default=REPOSITORY_ROOT / "benchmarks" / "benchmark_input.example.json")
    parser.add_argument("--golden", type=Path, default=REPOSITORY_ROOT / "benchmarks" / "golden_manifest.example.json")
    parser.add_argument("--output", type=Path, default=REPOSITORY_ROOT / "benchmarks" / "results" / "dry_run_result.json")
    arguments = parser.parse_args()
    benchmark_input = json.loads(arguments.input.read_text(encoding="utf-8"))
    golden_manifest = json.loads(arguments.golden.read_text(encoding="utf-8"))
    errors = validate_benchmark_input(benchmark_input)
    errors.extend(validate_golden_manifest(golden_manifest, REPOSITORY_ROOT, verify_files=False))
    clips = golden_manifest.get("clips", [])
    missing_inputs = [clip["id"] for clip in clips if not Path(clip["video_path"]).exists()]
    reason = "golden clips are unavailable: " + ", ".join(missing_inputs) if missing_inputs else "dry-run mode never loads model weights or runs inference"
    result = make_not_run_result(reason)
    result["input_validation_errors"] = errors
    result["missing_golden_clips"] = missing_inputs
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
