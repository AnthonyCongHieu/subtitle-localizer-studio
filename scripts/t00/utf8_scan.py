from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer_t00.utf8scan import scan_paths


def main() -> int:
    parser = argparse.ArgumentParser(description="Reject invalid UTF-8 and known mojibake indicators in tracked text files.")
    parser.add_argument("paths", nargs="*", type=Path, default=[REPOSITORY_ROOT])
    arguments = parser.parse_args()
    files: list[Path] = []
    for path in arguments.paths:
        if path.is_file():
            files.append(path)
        elif path.is_dir():
            files.extend(candidate for candidate in path.rglob("*") if candidate.is_file() and ".git" not in candidate.parts and candidate.suffix.lower() in {".md", ".py", ".json", ".toml", ".txt"})
    findings = scan_paths(files)
    for finding in findings:
        print(finding)
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
