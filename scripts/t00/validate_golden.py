from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer_t00.golden import validate_golden_manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a T00 external golden-clip manifest.")
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--verify-files", action="store_true")
    arguments = parser.parse_args()
    manifest = json.loads(arguments.manifest.read_text(encoding="utf-8"))
    errors = validate_golden_manifest(manifest, REPOSITORY_ROOT, arguments.verify_files)
    if errors:
        print(json.dumps({"valid": False, "errors": errors}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"valid": True, "manifest": str(arguments.manifest)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
