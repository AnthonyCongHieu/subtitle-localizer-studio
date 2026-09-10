"""Create a distributable worker directory from the current checkout.

Runtime data (databases, uploads, outputs, caches and secrets) is deliberately
excluded.  The resulting directory can be copied to another Windows machine.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ITEMS = ("src", "scripts/run_worker_agent.py", "requirements.txt", "pipeline_settings.json", "worker", "start-worker.bat")


def package(destination: Path) -> Path:
    destination = destination.resolve()
    if destination == ROOT or ROOT in destination.parents:
        raise ValueError("Thư mục đích phải nằm ngoài source checkout để tránh ghi đè source")
    destination.mkdir(parents=True, exist_ok=True)
    for relative in DEFAULT_ITEMS:
        source = ROOT / relative
        target = destination / relative
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"))
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description="Package a portable LAN worker")
    parser.add_argument("destination", type=Path, help="Thư mục bundle đầu ra")
    args = parser.parse_args()
    print(f"Worker bundle: {package(args.destination)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
