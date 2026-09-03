"""Subtitle Localizer Studio - Backend Server Launcher."""
import os
import sys
from pathlib import Path

# Fix Windows console encoding cho tiếng Việt
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

import uvicorn
from subtitle_localizer.service.server import create_app

app = create_app()

if __name__ == "__main__":
    print("=" * 60)
    print("  Subtitle Localizer Studio Backend Server (127.0.0.1:8899)")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8899, log_level="info")
