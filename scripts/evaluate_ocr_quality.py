"""Evaluate an OCR SRT against operator-supplied ground truth."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.evaluation.ocr_quality import evaluate_srt_pair


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure SRT cue recall, CER and timing error")
    parser.add_argument("ground_truth", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--overlap-threshold", type=float, default=0.5)
    parser.add_argument("--json", type=Path, help="Optional path for machine-readable result")
    args = parser.parse_args()
    result = evaluate_srt_pair(args.ground_truth, args.output, overlap_threshold=args.overlap_threshold)
    encoded = json.dumps(result, ensure_ascii=False, indent=2)
    print(encoded)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(encoded + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
