from __future__ import annotations

import os
import shutil
from pathlib import Path


def canonicalize_path(raw_path: Path | str) -> Path:
    """Chuẩn hóa đường dẫn tuyệt đối an toàn."""
    path = Path(raw_path).resolve()
    return path


def check_disk_space(target_path: Path | str, required_bytes: int = 100 * 1024 * 1024) -> bool:
    """Kiểm tra dung lượng đĩa khả dụng trước khi thực hiện ghi file lớn/proxy."""
    path = Path(target_path).resolve()
    check_dir = path if path.is_dir() else path.parent
    if not check_dir.exists():
        check_dir.mkdir(parents=True, exist_ok=True)

    usage = shutil.disk_usage(str(check_dir))
    return usage.free >= required_bytes


def validate_source_read_only(source_path: Path | str) -> bool:
    """
    Kiểm tra tính toàn vẹn và quyền đọc của file nguồn.
    Tuyệt đối không cấp quyền ghi vào file nguồn.
    """
    path = Path(source_path).resolve()
    if not path.exists() or not path.is_file():
        return False
    return os.access(str(path), os.R_OK)
