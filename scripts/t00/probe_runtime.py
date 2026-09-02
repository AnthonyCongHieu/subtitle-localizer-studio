from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer_t00.capabilities import write_runtime_probe


def main() -> int:
    parser = argparse.ArgumentParser(description="Write a T00 runtime capability probe as UTF-8 JSON.")
    parser.add_argument("--output", type=Path, default=REPOSITORY_ROOT / "benchmarks" / "runtime_probe.json")
    arguments = parser.parse_args()
    write_runtime_probe(arguments.output, REPOSITORY_ROOT)
    print(arguments.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
