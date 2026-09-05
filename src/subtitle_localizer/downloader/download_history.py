"""
download_history.py - Quản lý lịch sử video/phim đã tải xuống để tránh tải trùng lặp.
Lưu vết: BVID (Bilibili), Video ID (YouTube), Series ID (Hồng Quả), URL.
"""

import json
from pathlib import Path
from typing import Set, Dict, Any, List

HISTORY_FILE = Path(__file__).resolve().parent / "download_history.json"

_downloaded_ids: Set[str] = set()


def _load_history() -> Set[str]:
    global _downloaded_ids
    if HISTORY_FILE.exists():
        try:
            data = json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                _downloaded_ids = set(str(x) for x in data if x)
            elif isinstance(data, dict):
                _downloaded_ids = set(str(k) for k in data.keys() if k)
            return _downloaded_ids
        except Exception:
            pass
    _downloaded_ids = set()
    return _downloaded_ids


def _save_history() -> None:
    try:
        HISTORY_FILE.write_text(
            json.dumps(sorted(list(_downloaded_ids)), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:
        pass


_load_history()


def record_downloaded_item(identifier: str) -> None:
    """Ghi nhận một video hoặc bộ phim đã được tải thành công."""
    if not identifier:
        return
    clean_id = str(identifier).strip()
    if clean_id:
        _downloaded_ids.add(clean_id)
        _save_history()


def is_item_downloaded(identifier: str) -> bool:
    """Kiểm tra một video hoặc ID đã từng được tải về máy chưa."""
    if not identifier:
        return False
    clean_id = str(identifier).strip()
    return clean_id in _downloaded_ids


def get_all_downloaded_ids() -> Set[str]:
    """Trả về tập hợp toàn bộ ID đã tải."""
    return set(_downloaded_ids)


def clear_download_history() -> None:
    """Xóa toàn bộ lịch sử tải xuống cục bộ."""
    global _downloaded_ids
    _downloaded_ids = set()
    _save_history()
