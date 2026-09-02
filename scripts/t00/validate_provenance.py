from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer_t00.provenance import validate_source_matrix


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate required T00 source/model provenance fields.")
    parser.add_argument("matrix", type=Path, nargs="?", default=REPOSITORY_ROOT / "docs" / "research" / "T00_SOURCE_MODEL_MATRIX.json")
    arguments = parser.parse_args()
    matrix = json.loads(arguments.matrix.read_text(encoding="utf-8"))
    errors = validate_source_matrix(matrix)
    print(json.dumps({"valid": not errors, "errors": errors}, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
