from __future__ import annotations

import difflib
from collections import Counter
from typing import List


def calculate_text_similarity(s1: str, s2: str) -> float:
    """Tính độ tương đồng văn bản giữa 2 quan sát OCR (0.0 -> 1.0)."""
    if not s1 and not s2:
        return 1.0
    if not s1 or not s2:
        return 0.0
    return difflib.SequenceMatcher(None, s1.strip(), s2.strip()).ratio()


def majority_vote_text(texts: List[str]) -> str:
    """
    Thực hiện majority vote để chọn xâu ký tự đại diện ổn định nhất
    qua chuỗi các frame của một câu phụ đề.
    """
    cleaned = [t.strip() for t in texts if t.strip()]
    if not cleaned:
        return ""
    counts = Counter(cleaned)
    # Lấy xâu xuất hiện nhiều nhất
    most_common, _ = counts.most_common(1)[0]
    return most_common
