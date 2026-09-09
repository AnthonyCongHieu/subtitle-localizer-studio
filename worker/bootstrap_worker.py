"""Portable Windows bootstrapper for a Subtitle Localizer LAN worker.

The first run creates ``.venv`` in this folder and installs the repository's
requirements.  Subsequent runs use that interpreter and start the normal LAN
agent.  No coordinator URL is required when UDP discovery is available.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


WORKER_DIR = Path(__file__).resolve().parent
REPO_ROOT = WORKER_DIR.parent
VENV_DIR = WORKER_DIR / ".venv"


def _python_candidates() -> list[str]:
    candidates = [sys.executable]
    if os.name == "nt":
        candidates += ["py -3.11", "py -3.12", "py -3", "python"]
    return candidates


def _resolve_python() -> str:
    for candidate in _python_candidates():
        command = candidate.split() if " " in candidate else [candidate]
        try:
            result = subprocess.run(command + ["--version"], capture_output=True, text=True)
        except OSError:
            continue
        if result.returncode == 0:
            return candidate
    raise RuntimeError("Không tìm thấy Python 3.10+; hãy cài Python rồi chạy lại start-worker.bat")


def _venv_python() -> Path:
    return VENV_DIR / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def ensure_environment(skip_install: bool = False) -> Path:
    python = _venv_python()
    if not python.exists():
        base = _resolve_python()
        command = base.split() if " " in base else [base]
        print("[*] Tạo môi trường worker tại", VENV_DIR, flush=True)
        subprocess.check_call(command + ["-m", "venv", str(VENV_DIR)])
    if not skip_install:
        requirements = WORKER_DIR / "requirements.txt"
        if not requirements.exists():
            requirements = REPO_ROOT / "requirements.txt"
        if requirements.exists():
            marker = VENV_DIR / ".requirements-installed"
            req_mtime = str(requirements.stat().st_mtime_ns)
            needs_install = not marker.exists()
            if not needs_install:
                try:
                    needs_install = marker.read_text(encoding="utf-8").strip() != req_mtime
                except OSError:
                    needs_install = True
            if needs_install:
                print("[*] Cài/cập nhật dependency worker (có thể mất vài phút)...", flush=True)
                subprocess.check_call([str(python), "-m", "pip", "install", "--upgrade", "pip"])
                subprocess.check_call([str(python), "-m", "pip", "install", "-r", str(requirements)])
                marker.write_text(req_mtime, encoding="utf-8")
    return python


def report_external_tools() -> None:
    """Report optional system tools without making startup fail on CPU hosts."""
    for name, hint in (("ffmpeg", "cài FFmpeg để render video"), ("ollama", "cài Ollama để dịch model local")):
        if shutil.which(name) is None:
            print(f"[!] Chưa tìm thấy {name}; {hint}.", flush=True)


def ensure_local_model(model: str = "qwen2.5:7b-instruct", auto_pull: bool = True) -> bool:
    """Ensure the configured local translation model is installed.

    A worker must not advertise itself as fully ready while translation would
    fail later.  Pulling is idempotent; disable with ``--skip-model-pull`` for
    offline environments, which then produces an explicit warning.
    """
    ollama = shutil.which("ollama")
    if not ollama:
        print("[!] Thiếu Ollama; không thể chuẩn bị model local.", flush=True)
        return False
    try:
        listed = subprocess.run([ollama, "list"], capture_output=True, text=True, timeout=15)
        if listed.returncode == 0 and model.lower() in listed.stdout.lower():
            print(f"[✓] Local model sẵn sàng: {model}", flush=True)
            return True
        if not auto_pull:
            print(f"[!] Chưa có local model {model}; chạy 'ollama pull {model}'.", flush=True)
            return False
        print(f"[*] Đang tải local model {model} (có thể vài GB)...", flush=True)
        pulled = subprocess.run([ollama, "pull", model], timeout=3600)
        if pulled.returncode == 0:
            print(f"[✓] Đã cài local model: {model}", flush=True)
            return True
        print(f"[!] Ollama pull thất bại (exit {pulled.returncode}).", flush=True)
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"[!] Không kiểm tra/tải được local model: {exc}", flush=True)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap and run a portable LAN worker")
    parser.add_argument("--skip-install", action="store_true", help="Không cài dependency (dùng khi offline)")
    parser.add_argument("--coordinator", default=os.getenv("SL_COORDINATOR_URL", ""))
    parser.add_argument("--token", default=os.getenv("SL_WORKER_TOKEN", ""))
    parser.add_argument("--worker-id", default=os.getenv("SL_WORKER_ID", ""))
    parser.add_argument("--interval", default=os.getenv("SL_WORKER_INTERVAL", "5"))
    parser.add_argument("--model", default=os.getenv("SL_LOCAL_MODEL", "qwen2.5:7b-instruct"))
    parser.add_argument("--skip-model-pull", action="store_true", help="Không tự tải model Ollama")
    args, extra = parser.parse_known_args()
    python = ensure_environment(args.skip_install)
    report_external_tools()
    ensure_local_model(args.model, auto_pull=not args.skip_model_pull)
    source_root = Path(os.getenv("SL_SOURCE_ROOT", str(REPO_ROOT))).resolve()
    if not (source_root / "src").exists() or not (source_root / "scripts" / "run_worker_agent.py").exists():
        raise RuntimeError(
            "Không tìm thấy source worker (src/ và scripts/run_worker_agent.py). "
            "Hãy copy toàn bộ project cùng thư mục worker, hoặc đặt SL_SOURCE_ROOT tới thư mục source."
        )
    env = os.environ.copy()
    env["PYTHONPATH"] = str(source_root / "src") + os.pathsep + env.get("PYTHONPATH", "")
    database = env.setdefault("SL_DATABASE", str(WORKER_DIR / "subtitle_localizer_worker.db"))
    command = [str(python), str(source_root / "scripts" / "run_worker_agent.py"), "--database", database,
               "--interval", str(args.interval)]
    if args.coordinator:
        command += ["--coordinator", args.coordinator]
    if args.token:
        command += ["--token", args.token]
    if args.worker_id:
        command += ["--worker-id", args.worker_id]
    command += extra
    print("[*] Worker đang khởi động; coordinator: ", args.coordinator or "UDP discovery", flush=True)
    return subprocess.call(command, cwd=str(source_root), env=env)


if __name__ == "__main__":
    raise SystemExit(main())
