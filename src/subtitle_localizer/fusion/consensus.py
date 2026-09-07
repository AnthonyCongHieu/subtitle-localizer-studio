from __future__ import annotations

import difflib
import re
from typing import Dict, List, Optional, Set, Tuple


# Bảng các cặp chữ Hán hình cận (nét vẽ rất giống nhau khiến OCR dễ nhầm khi mờ, nhưng âm thanh đọc khác nhau hoàn toàn)
# {Ký tự OCR hay nhầm: Ký tự đúng trong văn bản ngữ âm}
CHINESE_VISUALLY_CONFUSABLE: Dict[str, Set[str]] = {
    "己": {"已", "巳"},
    "巳": {"已", "己"},
    "日": {"曰"},
    "曰": {"日"},
    "未": {"末"},
    "末": {"未"},
    "崇": {"祟"},
    "祟": {"崇"},
    "盲": {"育"},
    "千": {"干", "于"},
    "土": {"士"},
    "士": {"土"},
    "天": {"夫"},
    "夫": {"天"},
    "人": {"入"},
    "入": {"人"},
}

# Các nhóm từ đồng âm thường gặp trong tiếng Trung (Whisper hay nhầm do cùng âm, nhưng chữ OCR trên màn hình luôn chuẩn)
CHINESE_HOMOPHONE_GROUPS: List[Set[str]] = [
    {"座", "坐"},
    {"报", "豹", "爆", "抱"},
    {"她", "他", "它"},
    {"的", "得", "地"},
    {"象", "像", "相"},
    {"做", "作"},
    {"份", "分"},
    {"再", "在"},
    {"需", "须"},
    {"意", "义"},
    {"各", "个"},
    {"元", "原", "源"},
    {"利", "例", "立", "丽"},
    {"顾", "故"},
    {"炎", "言", "严"},
]

# Thán từ đệm trong hội thoại tiếng Anh & tiếng Trung
ENGLISH_FILLERS = re.compile(
    r"\b(um|uh|er|ah|you know|i mean|like|well|sort of|kind of)\b[,.?!]?",
    re.IGNORECASE,
)
CHINESE_FILLERS = re.compile(r"[嗯啊呃额呀吧呢嗷，。？！\s]+")


def compute_temporal_iou(
    start_a: float, end_a: float, start_b: float, end_b: float
) -> float:
    """Tính chỉ số giao thoa trên khoảng thời gian (Temporal IoU)."""
    intersection_start = max(start_a, start_b)
    intersection_end = min(end_a, end_b)
    intersection = max(0.0, intersection_end - intersection_start)

    union_start = min(start_a, start_b)
    union_end = max(end_a, end_b)
    union = union_end - union_start

    if union <= 0.0:
        return 0.0
    return intersection / union


def clean_speech_fillers(text: str, lang: str = "auto") -> str:
    """Làm sạch các thán từ đệm trong chuỗi nhận diện âm thanh ASR."""
    if not text:
        return ""
    t = text.strip()
    l = (lang or "auto").lower()

    if l == "en" or (l == "auto" and re.search(r"[a-zA-Z]", t)):
        cleaned = ENGLISH_FILLERS.sub("", t)
        cleaned = re.sub(r",\s*,+", ",", cleaned)
        cleaned = re.sub(r"\s*,\s*", ", ", cleaned)
        cleaned = re.sub(r"\bto,\s*", "to ", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*,\s*(?=[a-z])", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        cleaned = re.sub(r"\s+([,.:;?!])", r"\1", cleaned)
        cleaned = re.sub(r"^[,.:;?!]\s*", "", cleaned)
        return cleaned.strip()

    return t


def _are_homophones(c1: str, c2: str) -> bool:
    """Kiểm tra xem 2 chữ Hán có thuộc cùng nhóm đồng âm thường nhầm không."""
    for grp in CHINESE_HOMOPHONE_GROUPS:
        if c1 in grp and c2 in grp:
            return True
    return False


def _is_visually_confusable(ocr_char: str, asr_char: str) -> bool:
    """Kiểm tra xem ký tự OCR có phải là chữ hình cận với ký tự ASR không."""
    if ocr_char in CHINESE_VISUALLY_CONFUSABLE:
        return asr_char in CHINESE_VISUALLY_CONFUSABLE[ocr_char]
    return False


def resolve_text_conflict(
    ocr_text: str,
    asr_text: str,
    ocr_conf: float = 0.85,
    lang: str = "auto",
) -> str:
    """
    Hợp nhất và giải quyết xung đột giữa văn bản OCR và ASR.
    - Với tiếng Trung: Phân biệt lỗi hình cận (ưu tiên ASR sửa nét) và lỗi đồng âm (ưu tiên OCR giữ chữ).
    - Với tiếng Anh: Loại bỏ thán từ, chuẩn hóa từ viết tắt/nuốt âm.
    """
    t_ocr = (ocr_text or "").strip()
    t_asr = (asr_text or "").strip()

    if not t_ocr:
        return clean_speech_fillers(t_asr, lang=lang)
    if not t_asr:
        return t_ocr

    if t_ocr == t_asr:
        return t_ocr

    is_chinese = bool(re.search(r"[\u4e00-\u9fff]", t_ocr)) or (lang == "zh")

    if is_chinese:
        # Nếu độ dài 2 câu bằng nhau, so sánh từng ký tự
        if len(t_ocr) == len(t_asr):
            resolved_chars = []
            for c_ocr, c_asr in zip(t_ocr, t_asr):
                if c_ocr == c_asr:
                    resolved_chars.append(c_ocr)
                elif _are_homophones(c_ocr, c_asr):
                    # Đồng âm: Người làm phim đã gõ chữ đúng trên màn hình -> Ưu tiên OCR
                    resolved_chars.append(c_ocr)
                elif _is_visually_confusable(c_ocr, c_asr) and ocr_conf < 0.75:
                    # Chữ hình cận và điểm OCR thấp (chữ mờ/nét đứt) -> Mượn âm chuẩn của ASR
                    resolved_chars.append(c_asr)
                else:
                    # Mặc định: Nếu OCR conf cao thì theo OCR, ngược lại theo ASR
                    resolved_chars.append(c_ocr if ocr_conf >= 0.70 else c_asr)
            return "".join(resolved_chars)

        # Nếu độ dài khác nhau một chút:
        # Làm sạch thán từ trong ASR
        t_asr_clean = re.sub(r"[嗯啊呃额呀吧呢嗷，。？！\s]+", "", t_asr)
        t_ocr_clean = re.sub(r"[，。？！\s]+", "", t_ocr)
        if t_ocr_clean == t_asr_clean:
            return t_ocr

        # Nếu OCR có độ tin cậy cao (>= 0.82) -> Giữ nguyên OCR
        if ocr_conf >= 0.82:
            return t_ocr

        # Nếu OCR bị mất quá nhiều từ do chữ chạy nhanh
        if len(t_ocr_clean) < len(t_asr_clean) * 0.65 and ocr_conf < 0.65:
            return t_asr

        return t_ocr

    # Tiếng Anh và các ngôn ngữ Latin khác
    clean_asr = clean_speech_fillers(t_asr, lang=lang)
    if not clean_asr:
        return t_ocr

    # Tính độ tương đồng
    seq = difflib.SequenceMatcher(None, t_ocr.lower(), clean_asr.lower())
    ratio = seq.ratio()

    # Nếu tương đồng cao (>= 0.75) và OCR tự tin:
    if ratio >= 0.75 and ocr_conf >= 0.75:
        return t_ocr

    # Nếu OCR bị điểm thấp hoặc tỷ lệ tương đồng kém:
    if ocr_conf < 0.60:
        return clean_asr

    return t_ocr
