"""Export a clean, lightweight version of Subtitle Localizer Studio.

Excludes:
- Models (*.onnx, *.pt, *.safetensors, etc.)
- User video uploads (uploads/)
- Render outputs (outputs/, output/)
- Local SQLite active databases (*.db, *.db-shm, *.db-wal)
- Node modules (web/node_modules/ - web/dist is already compiled and served)
- Agent cache & logs (.claude/, .agents/, .serena/, .pytest_cache/, scratch/)
- Temporary media binaries (*.mp4, *.mkv, *.avi)

The exported bundle can be run immediately on another machine with:
    KHOI_DONG_STUDIO.bat
"""
from __future__ import annotations

import argparse
import fnmatch
import os
from pathlib import Path
import shutil
import sys
import zipfile

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parents[1]

EXCLUDE_DIRS = {
    ".git",
    ".claude",
    ".agents",
    ".serena",
    ".pytest_cache",
    "__pycache__",
    "uploads",
    "outputs",
    "output",
    "scratch",
    "e2e_results",
    "screenshots_admin_worker",
    "node_modules",
    "cache",
    "crops",
    "clips",
    "private",
}

EXCLUDE_FILE_PATTERNS = [
    "*.onnx",
    "*.pt",
    "*.safetensors",
    "*.h5",
    "*.engine",
    "*.db",
    "*.db-shm",
    "*.db-wal",
    "*.mp4",
    "*.mkv",
    "*.avi",
    "*.webm",
    "*.mov",
    "*.zip",
    "*.tar",
    "*.gz",
    "*.7z",
    "*.bak",
    "*.corrupted",
]


def should_exclude_dir(dir_name: str, rel_path: Path, include_bin: bool) -> bool:
    if dir_name in EXCLUDE_DIRS:
        return True
    if not include_bin and dir_name == "bin":
        return True
    return False


def should_exclude_file(filename: str, rel_path: Path) -> bool:
    if filename == "subtitle_localizer_clean.db":
        return False
    for pat in EXCLUDE_FILE_PATTERNS:
        if fnmatch.fnmatch(filename.lower(), pat.lower()):
            return True
    return False


def collect_files(include_bin: bool = True):
    included_files: list[tuple[Path, Path]] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        curr_dir = Path(dirpath)
        rel_dir = curr_dir.relative_to(ROOT)

        dirnames[:] = [
            d for d in dirnames
            if not should_exclude_dir(d, rel_dir / d, include_bin=include_bin)
        ]

        for fname in filenames:
            file_path = curr_dir / fname
            rel_file = file_path.relative_to(ROOT)
            if not should_exclude_file(fname, rel_file):
                included_files.append((file_path, rel_file))

    return included_files


def export_zip(dest_zip: Path, include_bin: bool = True) -> Path:
    dest_zip = dest_zip.resolve()
    dest_zip.parent.mkdir(parents=True, exist_ok=True)
    if dest_zip.exists():
        dest_zip.unlink()

    files = collect_files(include_bin=include_bin)
    print(f"[*] Đang đóng gói {len(files)} files vào: {dest_zip}")

    with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for abs_path, rel_path in files:
            if abs_path == dest_zip:
                continue
            zf.write(abs_path, str(rel_path))

    size_mb = dest_zip.stat().st_size / (1024 * 1024)
    print(f"[OK] Đã tạo file zip thành công: {dest_zip} ({size_mb:.2f} MB)")
    return dest_zip


def export_folder(dest_dir: Path, include_bin: bool = True) -> Path:
    dest_dir = dest_dir.resolve()
    if dest_dir == ROOT or ROOT in dest_dir.parents:
        raise ValueError("Thư mục đích không được nằm trong chính dự án hiện tại!")
    dest_dir.mkdir(parents=True, exist_ok=True)

    files = collect_files(include_bin=include_bin)
    print(f"[*] Đang sao chép {len(files)} files vào: {dest_dir}")

    total_bytes = 0
    for abs_path, rel_path in files:
        target = dest_dir / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(abs_path, target)
        total_bytes += abs_path.stat().st_size

    size_mb = total_bytes / (1024 * 1024)
    print(f"[OK] Đã sao chép toàn bộ dự án sạch thành công vào: {dest_dir} ({size_mb:.2f} MB)")
    return dest_dir


def main() -> int:
    parser = argparse.ArgumentParser(description="Export clean Subtitle Localizer Studio project")
    parser.add_argument(
        "--dest",
        type=Path,
        default=Path.home() / "Desktop" / "subtitle-localizer-studio-clean.zip",
        help="Đường dẫn file .zip hoặc thư mục xuất ra (mặc định: Desktop)",
    )
    parser.add_argument(
        "--format",
        choices=["zip", "folder"],
        default="zip",
        help="Định dạng xuất: 'zip' (nén) hoặc 'folder' (chép trực tiếp)",
    )
    parser.add_argument(
        "--no-bin",
        action="store_true",
        help="Không kèm thư mục bin/ (xray proxy tool)",
    )

    args = parser.parse_args()
    include_bin = not args.no_bin

    if args.format == "zip":
        target = args.dest
        if target.suffix.lower() != ".zip":
            target = target.with_suffix(".zip")
        export_zip(target, include_bin=include_bin)
    else:
        export_folder(args.dest, include_bin=include_bin)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
