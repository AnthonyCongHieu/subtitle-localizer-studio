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
    t1, t2 = s1.strip(), s2.strip()
    if t1 == t2:
        return 1.0
    # Nếu chênh lệch độ dài đáng kể (ví dụ câu 3 chữ '回戏班' và câu 6 chữ '让我回戏班吧'),
    # đây là 2 câu thoại độc lập của 2 nhân vật, không được gộp!
    len_ratio = min(len(t1), len(t2)) / max(len(t1), len(t2))
    if len_ratio < 0.72:
        return 0.0
    return difflib.SequenceMatcher(None, t1, t2).ratio()


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
