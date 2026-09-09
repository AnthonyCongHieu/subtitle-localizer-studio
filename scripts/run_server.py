"""Subtitle Localizer Studio - Backend Server Launcher."""
import os
import sys
import socket
from pathlib import Path

# Fix Windows console encoding cho tiếng Việt
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Fix Windows asyncio ProactorEventLoop WinError 10054 khi stream video ngắt kết nối
if sys.platform == "win32":
    try:
        from asyncio.proactor_events import _ProactorBasePipeTransport
        _orig_call_connection_lost = _ProactorBasePipeTransport._call_connection_lost

        def _safe_call_connection_lost(self, exc):
            try:
                _orig_call_connection_lost(self, exc)
            except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
                pass
            except OSError as err:
                if getattr(err, "winerror", None) in (10053, 10054):
                    pass
                else:
                    raise

        _ProactorBasePipeTransport._call_connection_lost = _safe_call_connection_lost
    except Exception:
        pass

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

import uvicorn
from subtitle_localizer.service.server import create_app
from subtitle_localizer.service.lan import LanDiscoveryResponder

app = create_app()

if __name__ == "__main__":
    print("=" * 60)
    print("  Subtitle Localizer Studio Backend Server (127.0.0.1:8899)")
    print("=" * 60)
    # Advertise this coordinator to workers on the local subnet.  Discovery
    # carries endpoint metadata only; authentication remains HTTP bearer auth.
    try:
        lan_host = socket.gethostbyname(socket.gethostname())
    except OSError:
        lan_host = "127.0.0.1"
    discovery = LanDiscoveryResponder(f"http://{lan_host}:8899")
    discovery.start()
    print("  LAN coordinator: UDP discovery port 45871")
    uvicorn.run(app, host="0.0.0.0", port=8899, log_level="info")
