"""Subtitle Localizer Studio - Backend Server Launcher."""
import sys
import uvicorn
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.service.server import create_app

app = create_app()

if __name__ == "__main__":
    print("==================================================================")
    print("  Khởi động Subtitle Localizer Studio Backend Server (127.0.0.1) ")
    print("==================================================================")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
