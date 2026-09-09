"""Subtitle Localizer Studio - Unified Single-CMD Launcher with Self-Healing Pre-flight Checks."""
from __future__ import annotations

import argparse
import importlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Fix Windows console UTF-8 output
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

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

# Danh sách 16 module cốt lõi cần kiểm tra
CORE_MODULES: List[Tuple[str, str]] = [
    ("fastapi", "fastapi>=0.115.0"),
    ("uvicorn", "uvicorn>=0.34.0"),
    ("pydantic", "pydantic>=2.11.0"),
    ("numpy", "numpy>=1.24.0"),
    ("cv2", "opencv-python>=4.10.0"),
    ("onnxruntime", "onnxruntime>=1.16.0"),
    ("rapidocr_onnxruntime", "rapidocr-onnxruntime>=1.4.4"),
    ("python_multipart", "python-multipart>=0.0.20"),
    ("requests", "requests>=2.28.0"),
    ("Crypto", "pycryptodome>=3.18.0"),
    ("gmssl", "gmssl>=3.2.2"),
    ("betterproto", "betterproto==1.2.5"),
    ("yt_dlp", "yt-dlp>=2024.0.0"),
    ("websockets", "websockets>=12.0"),
    ("edge_tts", "edge-tts>=6.1.0"),
]


def check_python_version() -> Tuple[bool, str]:
    """Kiểm tra phiên bản Python tương thích (khuyến nghị >= 3.10)."""
    major, minor, micro = sys.version_info[:3]
    version_str = f"Python {major}.{minor}.{micro}"
    if major < 3 or (major == 3 and minor < 10):
        return False, f"{version_str} không được hỗ trợ. Vui lòng cài Python 3.10, 3.11 hoặc 3.12."
    return True, f"{version_str} (Hợp lệ)"


def check_dependencies(modules: List[Tuple[str, str]] = CORE_MODULES) -> Tuple[bool, List[str]]:
    """Kiểm tra các thư viện Python cần thiết."""
    missing: List[str] = []
    for import_name, pkg_spec in modules:
        try:
            importlib.import_module(import_name)
        except ImportError:
            if import_name == "python_multipart":
                try:
                    importlib.import_module("multipart")
                    continue
                except ImportError:
                    pass
            missing.append(pkg_spec)
    return len(missing) == 0, missing


def auto_install_packages(packages: List[str], root_dir: Path = ROOT_DIR) -> bool:
    """Tự động cài đặt các gói còn thiếu từ requirements.txt hoặc gói trực tiếp."""
    print(f"[*] Đang tự động cài đặt {len(packages)} thư viện còn thiếu...")
    req_file = root_dir / "requirements.txt"
    cmd = [sys.executable, "-m", "pip", "install"]

    # Ưu tiên cài đặt theo requirements.txt nếu có
    if req_file.exists():
        target_args = ["-r", str(req_file)]
    else:
        target_args = packages

    try:
        res = subprocess.run(cmd + target_args, capture_output=False, check=False)
        if res.returncode != 0:
            print("[*] Thử cài đặt với cờ --user...")
            res = subprocess.run(cmd + ["--user"] + target_args, capture_output=False, check=False)
        return res.returncode == 0
    except Exception as e:
        print(f"[!] Lỗi khi chạy pip: {e}")
        return False


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Kiểm tra port có đang bị chiếm dụng hay không."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.6)
        try:
            s.connect((host, port))
            return True
        except (socket.timeout, ConnectionRefusedError, OSError):
            return False


def find_pids_using_port(port: int) -> List[int]:
    """Tìm danh sách PID đang chiếm port trên Windows/Linux."""
    pids: List[int] = []
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(
                f"netstat -ano | findstr :{port}",
                shell=True,
                text=True,
                stderr=subprocess.DEVNULL,
            )
            for line in out.strip().splitlines():
                parts = line.split()
                if len(parts) >= 5 and f":{port}" in parts[1] and parts[3] in ("LISTENING", "ESTABLISHED"):
                    try:
                        pid = int(parts[4])
                        if pid > 0 and pid not in pids and pid != os.getpid():
                            pids.append(pid)
                    except ValueError:
                        pass
        except Exception:
            pass
    return pids


def free_port(port: int, force: bool = True) -> bool:
    """Tự động giải phóng port nếu có tiến trình zombie đang chiếm dụng."""
    if not is_port_in_use(port):
        return True

    pids = find_pids_using_port(port)
    if not pids:
        # Nếu socket connect được nhưng không lấy được PID qua netstat, thử qua PowerShell
        if sys.platform == "win32":
            try:
                ps_cmd = (
                    f"Get-Process -Id (Get-NetTCPConnection -LocalPort {port} -EA 0).OwningProcess -EA 0 "
                    f"| Stop-Process -Force -EA 0"
                )
                subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], check=False, capture_output=True)
            except Exception:
                pass
    else:
        for pid in pids:
            try:
                if sys.platform == "win32":
                    subprocess.run(["taskkill", "/F", "/PID", str(pid)], check=False, capture_output=True)
                else:
                    os.kill(pid, signal.SIGKILL)
            except Exception:
                pass

    time.sleep(1.0)
    return not is_port_in_use(port)


def check_and_fix_configs(root_dir: Path = ROOT_DIR) -> Dict[str, bool]:
    """Kiểm tra và tự động khôi phục các file cấu hình và key pool."""
    results: Dict[str, bool] = {"env": False, "gemini_pool": False}

    # 1. subtitle_localizer.env
    env_file = root_dir / "subtitle_localizer.env"
    env_example = root_dir / "subtitle_localizer.env.example"
    if not env_file.exists():
        if env_example.exists():
            shutil.copy(env_example, env_file)
            print("[*] Đã tự động tạo 'subtitle_localizer.env' từ file mẫu.")
        else:
            env_file.write_text("HOST=0.0.0.0\nPORT=8899\nOUTPUT_DIR=outputs\n", encoding="utf-8")
            print("[*] Đã khởi tạo 'subtitle_localizer.env' mặc định.")
    results["env"] = env_file.exists()

    # 2. gemini_keys_pool.json
    gemini_file = root_dir / "gemini_keys_pool.json"
    gemini_example = root_dir / "gemini_keys_pool.json.example"
    if not gemini_file.exists():
        if gemini_example.exists():
            shutil.copy(gemini_example, gemini_file)
            print("[*] Đã tự động tạo 'gemini_keys_pool.json' từ file mẫu.")
        else:
            gemini_file.write_text("[]", encoding="utf-8")
            print("[*] Đã khởi tạo 'gemini_keys_pool.json' rỗng.")
    else:
        # Kiểm tra tính hợp lệ của JSON
        try:
            content = json.loads(gemini_file.read_text(encoding="utf-8"))
            if not isinstance(content, list):
                gemini_file.write_text("[]", encoding="utf-8")
        except Exception:
            gemini_file.write_text("[]", encoding="utf-8")
            print("[!] 'gemini_keys_pool.json' bị lỗi định dạng. Đã tự động khôi phục cấu trúc JSON hợp lệ.")
    results["gemini_pool"] = gemini_file.exists()

    return results


def ensure_local_model(model: str = "qwen2.5:7b-instruct") -> bool:
    """Verify the local translation model before advertising host readiness."""
    ollama = shutil.which("ollama")
    if not ollama:
        print("[!] Thiếu Ollama; dịch local chưa sẵn sàng.")
        return False
    try:
        listed = subprocess.run([ollama, "list"], capture_output=True, text=True, timeout=15)
        if listed.returncode == 0 and model.lower() in listed.stdout.lower():
            print(f"[✅] Local model sẵn sàng: {model}")
            return True
        if os.getenv("SL_AUTO_PULL_MODEL", "1") != "1":
            print(f"[!] Chưa có model {model}; bật SL_AUTO_PULL_MODEL=1 hoặc chạy ollama pull {model}.")
            return False
        print(f"[*] Đang tải local model {model}; lần đầu có thể mất vài phút...")
        return subprocess.run([ollama, "pull", model], timeout=3600).returncode == 0
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"[!] Không kiểm tra được local model: {exc}")
        return False


def check_database(db_path: Path | str = ROOT_DIR / "subtitle_localizer.db") -> Tuple[bool, str]:
    """Kiểm tra, tự động khởi tạo / migrate và kiểm định tính toàn vẹn (Self-Healing) cơ sở dữ liệu SQLite."""
    try:
        from subtitle_localizer.persistence.database import Database
        db = Database(str(db_path))
        db.migrate()
        db.check_integrity_or_recover()
        return True, "Cơ sở dữ liệu SQLite sẵn sàng, toàn vẹn 100% và đã cập nhật migration."
    except Exception as e:
        return False, f"Lỗi khởi tạo cơ sở dữ liệu: {e}"


def check_frontend(root_dir: Path = ROOT_DIR, auto_build: bool = True, force_build: bool = False) -> Tuple[bool, str]:
    """Kiểm tra giao diện Web UI (web/dist/index.html) và tự động build nếu thiếu hoặc có cập nhật mã nguồn."""
    dist_index = root_dir / "web" / "dist" / "index.html"
    src_dir = root_dir / "web" / "src"

    needs_build = force_build or not dist_index.exists() or dist_index.stat().st_size == 0
    if not needs_build and src_dir.exists():
        dist_mtime = dist_index.stat().st_mtime
        for f in src_dir.rglob("*"):
            if f.is_file() and f.stat().st_mtime > dist_mtime:
                needs_build = True
                print("[*] Phát hiện mã nguồn giao diện (web/src) mới hơn bản build hiện tại. Đang tự động build lại...")
                break

    if not needs_build:
        return True, "Bản build Web UI (Production) đã sẵn sàng và đồng bộ mới nhất."

    if not auto_build:
        return False, "Chưa tìm thấy bản build web/dist/index.html hoặc cần build lại."

    # Kiểm tra npm để tự động build
    npm_cmd = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm_cmd:
        if dist_index.exists() and dist_index.stat().st_size > 0:
            return True, "Bản build Web UI hiện có sẵn sàng (Lưu ý: chưa cài npm để tự động build mã nguồn mới nhất)."
        return False, "Chưa có web/dist và máy chưa cài đặt npm/Node.js để tự động build."

    print("[*] Đang tiến hành build Web UI: 'npm run build'...")
    web_dir = root_dir / "web"
    node_modules = web_dir / "node_modules"

    if not node_modules.exists():
        print("[*] Đang cài đặt thư viện giao diện: npm install...")
        subprocess.run([npm_cmd, "install"], cwd=str(web_dir), check=False)

    build_res = subprocess.run([npm_cmd, "run", "build"], cwd=str(web_dir), check=False)
    if build_res.returncode == 0 and dist_index.exists():
        return True, "Đã tự động build Web UI thành công!"
    return False, "Build Web UI thất bại. Vui lòng kiểm tra môi trường Node.js."



def check_ffmpeg(root_dir: Path = ROOT_DIR) -> Tuple[bool, str]:
    """Kiểm tra sự hiện diện của FFmpeg trên máy tính."""
    ffmpeg_cmd = shutil.which("ffmpeg")
    if ffmpeg_cmd:
        return True, f"FFmpeg có sẵn trong PATH: {ffmpeg_cmd}"

    local_bin = root_dir / "bin" / "ffmpeg.exe"
    if local_bin.exists():
        return True, f"FFmpeg có sẵn trong thư mục bin: {local_bin}"

    root_ffmpeg = root_dir / "ffmpeg.exe"
    if root_ffmpeg.exists():
        return True, f"FFmpeg có sẵn tại thư mục gốc: {root_ffmpeg}"

    return False, "Chưa tìm thấy FFmpeg (Tính năng xuất video MP4 và waveform có thể bị giới hạn)."


def wait_for_health(port: int = 8899, timeout_seconds: float = 15.0) -> bool:
    """Chờ server phản hồi endpoint /api/v1/health ổn định."""
    import urllib.request
    url = f"http://127.0.0.1:{port}/api/v1/health"
    start_time = time.time()
    while time.time() - start_time < timeout_seconds:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Studio-Launcher"})
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def create_local_worker_agent(port: int = 8899):
    """Create the host's worker agent using the same runtime as remote workers.

    Kept as a small public launcher hook so smoke tests and alternate launchers
    can verify host bootstrap without starting uvicorn.  The returned tuple is
    ``(agent, thread)``; callers own shutdown via ``agent.stop()``.
    """
    from subtitle_localizer.persistence.database import Database
    from subtitle_localizer.persistence.repository import ProjectRepository
    from subtitle_localizer.service.lan_worker import (
        LanWorkerAgent, build_pipeline_job_handler, build_download_handler,
        collect_worker_capabilities,
    )
    db_path = Path(os.getenv("SL_DATABASE", str(ROOT_DIR / "subtitle_localizer.db")))
    database = Database(db_path)
    database.migrate()
    repository = ProjectRepository(database)
    coordinator_url = os.getenv("SL_COORDINATOR_URL", f"http://127.0.0.1:{port}")
    agent = LanWorkerAgent(
        coordinator_url,
        os.getenv("SL_WORKER_ID", "") or None,
        os.getenv("SL_WORKER_TOKEN", ""),
        interval_seconds=float(os.getenv("SL_WORKER_INTERVAL", "5")),
        state_path=Path(os.getenv("SL_WORKER_STATE", str(ROOT_DIR / "worker_state.json"))),
    )
    thread = threading.Thread(
        target=agent.run,
        args=(build_pipeline_job_handler(repository), build_download_handler(repository), collect_worker_capabilities()),
        name="local-worker-agent", daemon=True,
    )
    return agent, thread


def run_preflight_checks(root_dir: Path = ROOT_DIR, auto_fix: bool = True, port: int = 8899, force_build_web: bool = False) -> bool:
    """Chạy toàn bộ 6 bước kiểm tra trạng thái ổn định và tự sửa chữa."""
    print("=" * 72)
    print("      🚀 SUBTITLE LOCALIZER STUDIO - KIỂM TRA ĐỘ ỔN ĐỊNH & TỰ FIX")
    print("=" * 72)

    # 1. Python runtime
    py_ok, py_msg = check_python_version()
    status_icon = "✅" if py_ok else "❌"
    print(f"[{status_icon}] [1/6] Python Runtime: {py_msg}")
    if not py_ok:
        return False

    # 2. Dependencies
    dep_ok, missing = check_dependencies()
    if not dep_ok:
        print(f"[!] [2/6] Phát hiện thiếu {len(missing)} thư viện: {', '.join([m.split('>=')[0] for m in missing])}")
        if auto_fix:
            installed = auto_install_packages(missing, root_dir)
            dep_ok, missing = check_dependencies()
            if dep_ok:
                print("[✅] [2/6] Đã tự động cài đặt đầy đủ tất cả thư viện Python!")
            else:
                print(f"[❌] [2/6] Vẫn còn thiếu thư viện: {missing}. Vui lòng kiểm tra kết nối mạng.")
                return False
        else:
            return False
    else:
        print("[✅] [2/6] Thư viện Python: Đầy đủ 100% các gói core.")

    # 3. Port conflict
    if is_port_in_use(port):
        print(f"[!] [3/6] Cổng {port} đang bị chiếm bởi một tiến trình cũ. Đang tự động giải phóng...")
        if auto_fix and free_port(port):
            print(f"[✅] [3/6] Đã giải phóng cổng {port} thành công!")
        else:
            print(f"[❌] [3/6] Không thể giải phóng cổng {port}. Vui lòng đóng ứng dụng đang chiếm cổng.")
            return False
    else:
        print(f"[✅] [3/6] Cổng mạng {port}: Sẵn sàng.")

    # 4. Config files
    configs = check_and_fix_configs(root_dir)
    print(f"[✅] [4/6] Cấu hình local: Đã đồng bộ (Env: OK, local model profile: OK).")
    ensure_local_model()

    # 5. Database
    db_ok, db_msg = check_database(root_dir / "subtitle_localizer.db")
    status_icon = "✅" if db_ok else "❌"
    print(f"[{status_icon}] [5/6] Cơ sở dữ liệu: {db_msg}")
    if not db_ok:
        return False

    # 6. Frontend Web UI & FFmpeg
    fe_ok, fe_msg = check_frontend(root_dir, auto_build=auto_fix, force_build=force_build_web)
    status_icon = "✅" if fe_ok else "⚠️"
    print(f"[{status_icon}] [6/6] Giao diện Web UI: {fe_msg}")

    ff_ok, ff_msg = check_ffmpeg(root_dir)
    status_icon = "✅" if ff_ok else "ℹ️"
    print(f"[{status_icon}]       FFmpeg Video Engine: {ff_msg}")

    try:
        import onnxruntime as ort
        providers = ort.get_available_providers()
        if "CUDAExecutionProvider" in providers:
            print("[✅]       AI Hardware Engine: NVIDIA GPU (CUDAExecutionProvider - Siêu tốc RTX)")
        else:
            print("[ℹ️]       AI Hardware Engine: CPUExecutionProvider (CPU)")
    except Exception:
        pass

    print("=" * 72)
    return True


def launch_studio(dev_mode: bool = False, open_browser: bool = True, port: int = 8899,
                  local_worker: bool = True) -> None:
    """Khởi động toàn bộ Studio trong 1 cửa sổ CMD duy nhất."""
    import webbrowser
    import uvicorn
    from subtitle_localizer.service.server import create_app
    from subtitle_localizer.service.lan import LanDiscoveryResponder

    app = create_app()
    try:
        lan_host = socket.gethostbyname(socket.gethostname())
    except OSError:
        lan_host = "127.0.0.1"
    discovery = LanDiscoveryResponder(f"http://{lan_host}:{port}")
    discovery.start()
    local_agent = None
    local_agent_thread = None

    def _start_local_worker() -> None:
        """Register this host as a normal LAN worker and process local jobs.

        The agent starts only after the API health endpoint is available, so a
        single ``start-host`` process is both coordinator and worker without a
        second command window or race during startup.
        """
        nonlocal local_agent, local_agent_thread
        if not local_worker:
            return
        try:
            local_agent, local_agent_thread = create_local_worker_agent(port)
            local_agent_thread.start()
        except Exception as error:
            # Host remains usable as coordinator; surface a clear diagnostic.
            print(f"[!] Không thể khởi động worker cục bộ: {error}", flush=True)

    def _stop_local_worker() -> None:
        if local_agent is not None:
            local_agent.stop()
        if local_agent_thread is not None and local_agent_thread.is_alive():
            local_agent_thread.join(timeout=3.0)

    # Thread kiểm tra health và tự động mở trình duyệt
    def _health_and_browser_worker():
        target_url = f"http://127.0.0.1:{port}" if not dev_mode else "http://localhost:5199"
        if wait_for_health(port=port, timeout_seconds=15.0):
            banner = (
                "\n"
                + "=" * 72 + "\n"
                + "  🎉 SUBTITLE LOCALIZER STUDIO ĐANG CHẠY ỔN ĐỊNH!\n"
                + f"  👉 Địa chỉ Web Studio:   {target_url}\n"
                + f"  👉 Backend API Health:   http://127.0.0.1:{port}/api/v1/health\n"
                + f"  👉 API Documentation:    http://127.0.0.1:{port}/docs\n"
                + "  ℹ️  Toàn bộ hệ thống chạy chung trong 1 CMD này.\n"
                + "  🛑 Nhấn Ctrl+C trong cửa sổ này để dừng Studio an toàn.\n"
                + "=" * 72 + "\n"
            )
            print(banner, flush=True)
            if open_browser:
                try:
                    time.sleep(1.0)
                    webbrowser.open(target_url)
                except Exception:
                    pass

    health_thread = threading.Thread(target=_health_and_browser_worker, daemon=True)
    health_thread.start()
    _start_local_worker()
    if dev_mode:
        npm_cmd = shutil.which("npm.cmd") or shutil.which("npm")
        if not npm_cmd:
            print("[!] Không tìm thấy npm để chạy chế độ Dev, chuyển về chế độ Production tiêu chuẩn...")
            try:
                uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
            finally:
                _stop_local_worker()
                discovery.stop()
            return

        # Chạy Vite Dev Server đồng thời trong 1 CMD
        web_dir = ROOT_DIR / "web"
        print("[*] Đang khởi động đồng thời Vite Dev Server (port 5199) trong cùng 1 CMD...")
        vite_proc = subprocess.Popen(
            [npm_cmd, "run", "dev"],
            cwd=str(web_dir),
            stdout=sys.stdout,
            stderr=sys.stderr,
        )

        def _cleanup(sig, frame):
            print("\n[*] Đang tắt Vite Dev Server và Backend Studio...")
            try:
                vite_proc.terminate()
            except Exception:
                pass
            sys.exit(0)

        signal.signal(signal.SIGINT, _cleanup)
        try:
            uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
        finally:
            try:
                vite_proc.terminate()
            except Exception:
                pass
            _stop_local_worker()
            discovery.stop()
    else:
        # Chế độ tiêu chuẩn: 1 CMD duy nhất, phục vụ trực tiếp cả UI lẫn Backend API
        try:
            uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
        finally:
            _stop_local_worker()
            discovery.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="Subtitle Localizer Studio Unified Launcher")
    parser.add_argument("--check-only", action="store_true", help="Chỉ kiểm tra tính ổn định và tự sửa, không khởi động server")
    parser.add_argument("--no-fix", action="store_true", help="Không tự động cài đặt hay sửa lỗi")
    parser.add_argument("--no-browser", action="store_true", help="Không tự động mở trình duyệt")
    parser.add_argument("--dev", action="store_true", help="Khởi động song song Vite dev server và Backend trong cùng 1 CMD")
    parser.add_argument("--build-web", action="store_true", help="Buộc build lại giao diện Web UI (web/dist)")
    parser.add_argument("--port", type=int, default=8899, help="Cổng chạy Backend API (mặc định 8899)")
    parser.add_argument("--no-local-worker", action="store_true", help="Chỉ chạy coordinator, không đăng ký worker trên máy host")

    args = parser.parse_args()

    ok = run_preflight_checks(root_dir=ROOT_DIR, auto_fix=not args.no_fix, port=args.port, force_build_web=args.build_web)
    if not ok:
        print("\n[!] Hệ thống kiểm tra phát hiện lỗi chưa khắc phục được. Khởi động bị dừng.")
        sys.exit(1)

    if args.check_only:
        print("\n[OK] Đã hoàn thành kiểm tra tính ổn định và tự fix. Trạng thái: SẴN SÀNG.")
        sys.exit(0)

    print("\n[*] Đang khởi động Backend Server và Web Studio...")
    try:
        launch_studio(dev_mode=args.dev, open_browser=not args.no_browser, port=args.port,
                      local_worker=not args.no_local_worker)
    except KeyboardInterrupt:
        print("\n\n[OK] Subtitle Localizer Studio đã dừng an toàn theo lệnh của bạn.")
        sys.exit(0)
    except SystemExit:
        sys.exit(0)


if __name__ == "__main__":
    main()
