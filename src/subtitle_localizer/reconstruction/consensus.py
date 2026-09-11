from __future__ import annotations

import difflib
from collections import Counter
from typing import List


def _longest_common_substring_len(s1: str, s2: str) -> int:
    """Độ dài LCS liên tục (substring) — đủ nhẹ cho câu phụ đề ngắn."""
    if not s1 or not s2:
        return 0
    if s1 in s2:
        return len(s1)
    if s2 in s1:
        return len(s2)
    # Ưu tiên chiều ngắn hơn để giảm O(n*m)
    a, b = (s1, s2) if len(s1) <= len(s2) else (s2, s1)
    best = 0
    # Rolling search by decreasing length
    for length in range(len(a), 0, -1):
        if length <= best:
            break
        for start in range(0, len(a) - length + 1):
            chunk = a[start : start + length]
            if chunk in b:
                return length
    return best


def is_progressive_text_growth(s1: str, s2: str, *, min_core: int = 6) -> bool:
    """Nhận diện hard-sub OCR mọc dần / hoàn thiện cùng một dòng trên màn hình.

    Chuẩn ngành (Subtitle Edit / hardsub OCR): nếu bản ngắn là prefix/suffix/
    containment hoặc chia sẻ core đủ dài với bản dài trong cùng event → gộp.
    Giữ ngưỡng min_core để không gộp thoại ngắn khác nhau (vd. 回戏班 vs 让我回戏班吧).
    """
    t1, t2 = (s1 or "").strip(), (s2 or "").strip()
    if not t1 or not t2:
        return False
    if t1 == t2:
        return True

    shorter, longer = (t1, t2) if len(t1) <= len(t2) else (t2, t1)
    if len(shorter) < min_core:
        return False

    if shorter in longer:
        return True
    if longer.startswith(shorter) or longer.endswith(shorter):
        return True

    core = _longest_common_substring_len(shorter, longer)
    # Core phải phủ phần lớn bản ngắn; bản dài hơn phải thực sự "mọc".
    if core < max(min_core, int(round(len(shorter) * 0.65))):
        return False
    return len(longer) >= len(shorter) + 1


def calculate_text_similarity(s1: str, s2: str) -> float:
    """Tính độ tương đồng văn bản giữa 2 quan sát OCR (0.0 -> 1.0)."""
    if not s1 and not s2:
        return 1.0
    if not s1 or not s2:
        return 0.0
    t1, t2 = s1.strip(), s2.strip()
    if t1 == t2:
        return 1.0
    # Progressive hard-sub: nửa câu → full câu vẫn thuộc cùng event.
    if is_progressive_text_growth(t1, t2):
        shorter, longer = (t1, t2) if len(t1) <= len(t2) else (t2, t1)
        core = _longest_common_substring_len(shorter, longer)
        return max(0.85, core / max(len(longer), 1))
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

    Với progressive OCR, ưu tiên bản dài nhất trong nhóm phổ biến gần cao nhất
    để tránh chọn nhầm nửa câu xuất hiện nhiều frame hơn.
    """
    cleaned = [t.strip() for t in texts if t.strip()]
    if not cleaned:
        return ""
    counts = Counter(cleaned)
    most_common, top_count = counts.most_common(1)[0]
    # Nếu cluster có progressive growth, chọn bản dài nhất có tần suất gần top.
    progressive_present = any(
        is_progressive_text_growth(a, b)
        for i, a in enumerate(cleaned)
        for b in cleaned[i + 1 :]
    )
    if progressive_present:
        candidates = [t for t, c in counts.items() if c >= max(1, top_count - 1)]
        return max(candidates, key=lambda t: (len(t), counts[t]))
    return most_common


def fuse_ocr_and_asr(asr_text: str, ocr_text: str, ocr_conf: float = 0.50) -> str:
    """Hợp nhất thông minh giữa văn bản âm thanh CapCut ASR và văn bản thị giác Local OCR.
    
    Nguyên tắc:
    1. Local OCR là Ground Truth chuẩn xác tuyệt đối cho danh từ riêng, tên nhân vật,
       và các từ ngữ bị ASR nghe nhầm.
    2. Nếu OCR chỉ bắt được 1 trích đoạn ngắn của câu ASR dài (do sub tách nhịp),
       không cắt cụt câu ASR.
    3. Trả về xâu ký tự tối ưu nhất.
    """
    if not ocr_text or ocr_conf < 0.35:
        return asr_text
    if not asr_text:
        return ocr_text

    clean_asr = "".join(c for c in asr_text if c.isalnum())
    clean_ocr = "".join(c for c in ocr_text if c.isalnum())

    if clean_ocr == clean_asr:
        return ocr_text

    # Nếu OCR là chuỗi con ngắn của ASR (ví dụ sub tách nhịp visual), giữ câu ASR đầy đủ
    if clean_ocr in clean_asr and len(clean_ocr) < len(clean_asr) * 0.70:
        return asr_text

    # Nếu ASR là chuỗi con của OCR, OCR đầy đủ hơn
    if clean_asr in clean_ocr:
        return ocr_text

    common = sum(1 for c in clean_ocr if c in clean_asr)
    sim = common / max(1, max(len(clean_ocr), len(clean_asr)))

    # Nếu độ tương đồng >= 0.45 và độ dài tương đương: OCR là Ground Truth
    if sim >= 0.45:
        if abs(len(clean_ocr) - len(clean_asr)) <= max(3, int(len(clean_asr) * 0.40)):
            return ocr_text

    # Nếu ASR bị ảo giác âm thanh nặng nhưng OCR nhận diện với độ tin cậy cao (>= 0.85)
    if ocr_conf >= 0.85 and abs(len(clean_ocr) - len(clean_asr)) <= 6:
        return ocr_text

    return asr_text
