from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer_t00.fixtures import validate_fixture_manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate generated T00 CFR/VFR fixture bytes and ffprobe metadata.")
    parser.add_argument("manifest", type=Path, nargs="?", default=REPOSITORY_ROOT / "fixtures" / "synthetic" / "fixture_manifest.json")
    parser.add_argument("--verify-files", action="store_true")
    arguments = parser.parse_args()
    manifest_path = arguments.manifest
    if not manifest_path.exists() and (REPOSITORY_ROOT / "fixtures" / "synthetic" / "generated" / "manifest.json").exists():
        manifest_path = REPOSITORY_ROOT / "fixtures" / "synthetic" / "generated" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors = validate_fixture_manifest(manifest, manifest_path.parent, arguments.verify_files)
    print(json.dumps({"valid": not errors, "errors": errors}, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
