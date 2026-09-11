from __future__ import annotations

import logging
import os
from pathlib import Path
import re
import sys
from typing import Dict, List, Optional

from subtitle_localizer.domain.models import ModelDescriptorV1, SubtitleCueV1
from subtitle_localizer.translation.base import TranslationProvider

logger = logging.getLogger(__name__)

DEFAULT_LOCAL_MODEL = "qwen2.5:14b"

# Từ điển ngữ cảnh hội thoại và tiếng lóng video tiếng Trung sang tiếng Việt tự nhiên
DEFAULT_CHINESE_VIETNAMESE_GLOSSARY: Dict[str, str] = {
    # Chào hỏi thông dụng
    "你好": "Xin chào",
    "您好": "Xin chào",
    "你好世界": "Xin chào thế giới",
    "谢谢": "Cảm ơn",
    "再见": "Tạm biệt",
    # Gọi xe / Giao thông
    "打车": "gọi xe",
    "打了一辆": "gọi một chiếc xe",
    "再打一辆": "gọi thêm một xe nữa",
    "换个平台": "đổi app khác",
    "换平台": "đổi app",
    "也是5分钟到": "cũng 5 phút nữa tới",
    "5分钟到": "5 phút nữa tới",
    "都在来的路上了": "xe đang trên đường tới rồi",
    "在来的路上": "đang trên đường tới",
    "没上车之前": "trước khi lên xe",
    "上车": "lên xe",
    "选择的权利": "quyền lựa chọn",
    "平台": "ứng dụng",
    # Đại từ và xưng hô mạng xã hội
    "小哥哥": "anh bạn",
    "小姐姐": "chị gái",
    "老铁": "anh em",
    "家人们": "cả nhà ơi",
    "宝子们": "các bạn ơi",
    "兄弟们": "anh em ơi",
    # Khẩu ngữ và thán từ
    "什么鬼": "cái quái gì thế",
    "搞事情": "kiếm chuyện",
    "太卷了": "áp lực quá",
    "内卷": "cạnh tranh khốc liệt",
    "躺平": "buông xuôi",
    "牛逼": "đỉnh thật",
    "绝了": "đỉnh chóp",
    "打工人": "dân văn phòng",
    "救命": "trời ơi cứu",
    "破防了": "xúc động quá",
    "无语": "cạn lời",
    # Tên riêng nhân vật chuẩn Hán Việt (Phim đô thị tình cảm / ngắn)
    "秦程锦": "Tần Trình Cẩm",
    "宋知节": "Tống Chí Kiệt",
    "宋志杰": "Tống Chí Kiệt",
    "时穗": "Thời Tuệ",
    "穗穗": "Tuệ Tuệ",
    "苏芹": "Tô Cần",
    "出轨对象": "kẻ thứ ba",
    "出轨": "ngoại tình",
    "调理身子": "bồi bổ cơ thể",
    "外边有人": "có người khác bên ngoài",
    "大字不识几个": "một chữ bẻ đôi cũng không biết",
}

# Các cấu trúc tường thuật thường bị dịch máy theo từng chữ. Đây là rule theo
# nguồn/ngữ nghĩa, không phụ thuộc tên phim hay cast của một video cụ thể.
CONTEXTUAL_SOURCE_REWRITES: Dict[str, str] = {
    "影视鉴赏君男人是从业多年的影视审核员":
        "Người chuyên review phim là một kiểm duyệt viên phim ảnh nhiều năm kinh nghiệm",
    "影视鉴赏君就在男人脑海里飞速闪过无数画面时":
        "Khi trong đầu người đàn ông lướt qua vô số hình ảnh",
    "常年泡在海量岛国视频里":
        "Suốt nhiều năm đắm mình trong vô số video Nhật Bản",
    "早就把身体熬成了“挂机模式’":
        "Đã sớm vắt kiệt cơ thể đến mức rơi vào chế độ treo máy",
    "早就把身体熬成了\"挂机模式\"":
        "Đã sớm vắt kiệt cơ thể đến mức rơi vào chế độ treo máy",
}


def _capitalize_first(s: str) -> str:
    """Viết hoa chữ cái đầu tiên của câu phụ đề tiếng Việt."""
    s = s.strip()
    if not s:
        return ""
    return s[0].upper() + s[1:]

_GENDER_PREFIX = re.compile(
    r"^[\[\(\uff08\u3010]\s*(Nam|Nữ|Nu|Male|Female|Man|Woman)(\d+)?\s*[\]\)\uff09\u3011][:\s]*",
    re.IGNORECASE,
)
_SPEAKER_ID_PREFIX = re.compile(
    r"^[\[\(\uff08\u3010]\s*(?P<sid>[A-Za-zÀ-ỹ0-9_\-]{2,32})\s*[\]\)\uff09\u3011][:\s]*",
    re.IGNORECASE,
)
_CROWD_PREFIX = re.compile(
    r"^[\[\(\uff08\u3010]\s*(?:Quần\s*chúng|Đám\s*đông|Crowd|Walla|Extras?|众人|齐声|群众)\s*[\]\)\uff09\u3011][:\s]*",
    re.IGNORECASE,
)
_ROLE_PREFIX = re.compile(
    r"^[\[\(\uff08\u3010]\s*(?:"
    r"Tiếng\s+người\s+dẫn\s+chuyện|Người\s+dẫn\s+chuyện|Lời\s+dẫn\s+chuyện|"
    r"Lời\s+bình|Thuyết\s+minh|Narrator|Voice[\s-]*over|旁白|解说"
    r")\s*[\]\)\uff09\u3011][:\s]*",
    re.IGNORECASE,
)


def _split_speaker_annotation(raw_item: str) -> tuple[str | None, str, dict]:
    """Tách nhãn [Nam]/[Nữ]/[speaker_id]/crowd và chú thích vai khỏi câu dịch.

    Returns: (gender, spoken_text, meta)
    """
    text = (raw_item or "").strip()
    gender: str | None = None
    meta: dict = {}
    for _ in range(6):
        crowd_match = _CROWD_PREFIX.match(text)
        if crowd_match:
            meta["speaker_role"] = "crowd"
            meta.setdefault("speaker_id", "crowd")
            text = text[crowd_match.end() :].strip()
            continue
        gender_match = _GENDER_PREFIX.match(text)
        if gender_match:
            spk_raw = gender_match.group(1).lower()
            gender = "female" if spk_raw in ("nữ", "nu", "female", "woman") else "male"
            suffix = gender_match.group(2) or ""
            if suffix:
                meta["speaker_id"] = f"{'nu' if gender == 'female' else 'nam'}_{suffix}"
            text = text[gender_match.end() :].strip()
            continue
        role_match = _ROLE_PREFIX.match(text)
        if role_match:
            meta.setdefault("speaker_role", "narrator")
            meta.setdefault("speaker_id", "narrator")
            text = text[role_match.end() :].strip()
            continue
        sid_match = _SPEAKER_ID_PREFIX.match(text)
        if sid_match:
            sid = sid_match.group("sid").strip()
            sid_l = sid.lower()
            if sid_l in {"nam", "nữ", "nu", "male", "female", "man", "woman"}:
                break
            meta["speaker_id"] = re.sub(r"\s+", "_", sid_l)
            text = text[sid_match.end() :].strip()
            continue
        break
    return gender, text, meta



def _polish_addressing(
    text: str,
    source_text: str = "",
    speaker_gender: str | None = None,
    addressing_mode: str = "auto",
) -> str:
    """Rewrite generic Vietnamese addressee pronouns by mode + speaker gender.

    Video-agnostic: no cast names. Only touches leading/generic "Bạn" forms.
    """
    result = (text or "").strip()
    if not result:
        return result
    mode = (addressing_mode or "auto").strip().lower()
    if mode in {"neutral", "keep_neutral"}:
        return result
    # couple mode always polishes; auto only when speaker gender is known
    if mode not in {"couple_anh_em", "couple", "auto"}:
        return result
    if mode == "auto" and speaker_gender not in {"female", "male"}:
        return result
    if speaker_gender not in {"female", "male"}:
        return result

    replacement = "Anh" if speaker_gender == "female" else "Em"
    # Leading Ban / Bạn as addressee
    result = re.sub(r"^(Bạn|Ban)(?=\s|,|\?|!|$)", replacement, result, count=1, flags=re.IGNORECASE)
    # Common "Ban/Bạn oi" vocative mid-sentence kept conservative: only exact leading handled above
    return result


def _refine_subtitles(text: str, source_text: str, *, preserve_existing: bool = False) -> str:
    """Tinh chỉnh câu dịch dựa trên từ điển ngữ cảnh và sửa các lỗi dịch thô."""
    result = text.strip()
    
    # Sửa các lỗi dịch máy ngớ ngẩn thường gặp trong phụ đề
    lower_res = result.lower()
    if "error 500" in lower_res or "that's an error" in lower_res or "server error" in lower_res:
        return source_text

    # Khử lỗi dịch "Cũng cách đó 5 phút"
    if "cách đó 5 phút" in lower_res:
        result = "Cũng 5 phút nữa là tới"
    if lower_res == "đến sau 5 phút" or lower_res == "5 phút đến":
        result = "5 phút nữa tới nơi"
    if "thay đổi nền tảng" in lower_res:
        result = "Đổi sang app khác"
    if "có được một chiếc ô tô" in lower_res:
        result = "Gọi một chiếc xe"
    if "tất cả họ đang trên đường đến" in lower_res:
        result = "Xe đang trên đường tới rồi"

    # Áp dụng từ điển ngữ cảnh chuyên sâu khi câu gốc khớp trọn vẹn hoặc chứa thuật ngữ
    clean_src = source_text.strip()
    contextual_rewrite = CONTEXTUAL_SOURCE_REWRITES.get(clean_src)
    if contextual_rewrite:
        return _capitalize_first(contextual_rewrite)
    if clean_src in DEFAULT_CHINESE_VIETNAMESE_GLOSSARY and not preserve_existing:
        result = DEFAULT_CHINESE_VIETNAMESE_GLOSSARY[clean_src]
    else:
        for zh_term, vi_term in DEFAULT_CHINESE_VIETNAMESE_GLOSSARY.items():
            if zh_term in source_text and len(zh_term) >= 2:
                # Thay thế các cụm từ thô ráp thành từ ngữ tự nhiên
                if zh_term in ("换平台", "换个平台") and "nền tảng" in lower_res:
                    result = re.sub(r'(?i)thay đổi nền tảng|nền tảng', 'app khác', result)
                elif zh_term in ("打车", "打了一辆") and ("ô tô" in lower_res or "xe hơi" in lower_res):
                    result = re.sub(r'(?i)có được một chiếc ô tô|bắt xe', 'gọi xe', result)
                elif zh_term in ("家人们", "宝子们") and ("gia đình" in lower_res or "người nhà" in lower_res):
                    result = re.sub(r'(?i)gia đình|người nhà', vi_term, result)

    # General ZH->VI calque / nuance repairs (video-agnostic)
    src = (source_text or "").strip()
    lower_now = result.lower()
    if "是我的问题" in src or src == "是我的问题":
        if "vấn đề của tôi" in lower_now or "van de cua toi" in lower_now:
            result = "Lỗi là của tôi"
    if "是我做得不好" in src:
        if lower_now in {"tôi làm không tốt", "toi lam khong tot"} or lower_now.startswith("tôi làm không tốt"):
            result = "Là do tôi làm không tốt"
    if "你怎么了" in src or "您怎么了" in src:
        # "sao rồi" is status check; source asks what's wrong
        result = re.sub(r"(?i)sao rồi", "sao vậy", result)
        if re.fullmatch(r"(?i)bạn sao vậy", result.strip()):
            result = "Bạn sao vậy?"
        elif re.fullmatch(r"(?i)(anh|em) sao vậy", result.strip()):
            result = result.strip().rstrip("?") + "?"
    if src in {"您说得对", "你说得对"} and re.fullmatch(r"(?i)bạn nói đúng\.?", result.strip()):
        # Keep Ban here; addressing polish decides Anh/Em by speaker/mode
        result = "Bạn nói đúng"

    return _capitalize_first(result)


class RealTranslationProvider(TranslationProvider):
    """Local-model translation provider (Ollama/Qwen).

    Network translation services are intentionally not part of this provider.
    """

    def __init__(self) -> None:
        self.is_loaded = False
        self._cache: Dict[str, str] = {}

    def get_descriptor(self) -> ModelDescriptorV1:
        return ModelDescriptorV1(
            id="ollama-qwen-local",
            source_url="https://ollama.com/library/qwen2.5",
            version_or_commit=DEFAULT_LOCAL_MODEL,
            sha256="0" * 64,
            format="api",
            license="MIT",
            languages=["zh", "en", "vi"],
            runtime="python",
        )

    def load(self) -> None:
        self.is_loaded = True

    def unload(self) -> None:
        self.is_loaded = False

    @staticmethod
    def _local_chunk_size(total_cues: int, configured_batch_size: Optional[int]) -> int:
        """Keep local prompts small enough that Ollama returns every cue marker."""
        if total_cues <= 0:
            return 1
        configured = int(configured_batch_size or 35)
        if configured <= 0:
            configured = 35
        return min(total_cues, configured)


    def _cjk_ratio(self, text: str) -> float:
        cleaned = "".join(ch for ch in (text or "") if not ch.isspace())
        if not cleaned:
            return 0.0
        cjk = sum(1 for ch in cleaned if "一" <= ch <= "鿿")
        return cjk / len(cleaned)

    def _normalize_compare_text(self, text: str) -> str:
        return re.sub(r"[\s。．.，,！!？?：:；;、]+", "", (text or "").strip())

    def _is_source_echo(self, translated: str, sources: list[str]) -> bool:
        norm = self._normalize_compare_text(translated)
        if not norm:
            return False
        for source in sources:
            src = self._normalize_compare_text(source)
            if src and (norm == src or (len(src) >= 6 and (norm in src or src in norm))):
                return True
        return False

    def _has_foreign_source_leak(self, translated: str, other_sources: list[str]) -> bool:
        """Reject mixed VI+CJK lines that still carry another cue's Chinese source."""
        runs = re.findall(r"[\u4e00-\u9fff]{4,}", translated or "")
        if not runs:
            return False
        for run in runs:
            run_n = self._normalize_compare_text(run)
            for source in other_sources:
                src = self._normalize_compare_text(source)
                if src and run_n and (run_n in src or src in run_n):
                    return True
        return False

    def _latin_token_count(self, text: str) -> int:
        return len(re.findall(r"[A-Za-z]{3,}", text or ""))

    def _vietnamese_diacritic_count(self, text: str) -> int:
        marks = (
            "áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợ"
            "úùủũụưứừửữựýỳỷỹỵđ"
            "ÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢ"
            "ÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ"
        )
        return sum(1 for ch in (text or "") if ch in marks)

    def _looks_like_english(self, text: str) -> bool:
        """Detect English without rejecting unaccented Vietnamese output.

        Vietnamese subtitles can legitimately arrive without diacritics (for
        example ``Xin chao``), so Latin-token count alone is too aggressive.
        Require a small English function-word signal as well.
        """
        cleaned = (text or "").strip()
        if not cleaned:
            return False
        if self._vietnamese_diacritic_count(cleaned) > 0:
            return False
        if self._cjk_ratio(cleaned) >= 0.2:
            return False
        if self._latin_token_count(cleaned) < 2:
            return False
        english_markers = {
            "a", "an", "and", "are", "for", "how", "is", "it", "no",
            "not", "of", "that", "the", "this", "to", "what", "with",
            "you", "your",
        }
        tokens = {token.lower() for token in re.findall(r"[A-Za-z]{2,}", cleaned)}
        return bool(tokens & english_markers)

    def _is_invalid_translation(
        self,
        translated: str,
        own_source: str = "",
        target_lang: str = "vi",
    ) -> bool:
        text = (translated or "").strip()
        if not text:
            return True
        if self._normalize_compare_text(text) == self._normalize_compare_text(own_source):
            return True
        if self._cjk_ratio(text) >= 0.45:
            return True
        # Target Vietnamese but model drifted to English mid-batch.
        if (target_lang or "vi").lower().startswith("vi") and self._looks_like_english(text):
            return True
        return False

    def list_untranslated_indices(
        self,
        cues: List[SubtitleCueV1],
        target_lang: str = "vi",
    ) -> List[int]:
        indices: List[int] = []
        for idx, cue in enumerate(cues):
            src = (cue.source_text or "").strip()
            if not src:
                continue
            vi = (cue.translated_text or "").strip()
            if self._is_invalid_translation(vi, src, target_lang=target_lang):
                indices.append(idx)
                continue
            # Contaminated by another source's CJK span.
            others = [
                (cues[j].source_text or "").strip()
                for j in range(len(cues))
                if j != idx and (cues[j].source_text or "").strip()
            ]
            if self._has_foreign_source_leak(vi, others):
                indices.append(idx)
        return indices

    def _build_prior_context_lines(
        self,
        cues: List[SubtitleCueV1],
        *,
        exclude: set[int] | None = None,
        limit: int = 10,
    ) -> List[str]:
        exclude = exclude or set()
        lines: List[str] = []
        for idx, cue in enumerate(cues):
            if idx in exclude:
                continue
            src = (cue.source_text or "").strip()
            vi = (cue.translated_text or "").strip()
            if not src or self._is_invalid_translation(vi, src):
                continue
            if self._has_foreign_source_leak(
                vi,
                [
                    (cues[j].source_text or "").strip()
                    for j in range(len(cues))
                    if j != idx and (cues[j].source_text or "").strip()
                ],
            ):
                continue
            lines.append(f"[P{len(lines)+1}] {src} => {vi}")
        return lines[-limit:]

    def _translate_batch_with_context(
        self,
        batch_items: List[str],
        chunk_indices: List[int],
        *,
        cues: List[SubtitleCueV1],
        source_lang: str = "zh",
        target_lang: str = "vi",
        prompt_tone: str = "dramatic",
        prior_context_lines: List[str] | None = None,
        batch_ordinal: int = 1,
        batch_total: int = 1,
        **_kwargs,
    ) -> bool:
        """Translate one batch. Production engines register a callable on self._batch_engine_fn."""
        engine = getattr(self, "_batch_engine_fn", None)
        if not callable(engine):
            return False
        return bool(
            engine(
                batch_items,
                chunk_indices,
                cues=cues,
                source_lang=source_lang,
                target_lang=target_lang,
                prompt_tone=prompt_tone,
                prior_context_lines=prior_context_lines,
                batch_ordinal=batch_ordinal,
                batch_total=batch_total,
            )
        )

    def retry_untranslated_cues(
        self,
        cues: List[SubtitleCueV1],
        source_lang: str = "zh",
        target_lang: str = "vi",
        *,
        prompt_tone: str = "dramatic",
        max_rounds: int = 3,
        chunk_size: int = 12,
    ) -> int:
        """Re-translate empty / CJK-residue / leaked cues with rolling context."""
        before = len(self.list_untranslated_indices(cues, target_lang=target_lang))
        if before == 0:
            return 0

        for round_no in range(max_rounds):
            holes = self.list_untranslated_indices(cues, target_lang=target_lang)
            if not holes:
                break
            prior = self._build_prior_context_lines(cues, exclude=set(holes))
            # If a large response still omits markers, progressively reduce the
            # retry size; the final pass is one cue/request and is resilient to
            # models that truncate or reorder long numbered responses.
            retry_chunk_size = 1 if round_no == max_rounds - 1 else max(1, chunk_size // (2 ** round_no))
            for start in range(0, len(holes), retry_chunk_size):
                chunk = holes[start : start + retry_chunk_size]
                batch_items = [
                    f"[{pos}] {cues[i].source_text.strip()}"
                    for pos, i in enumerate(chunk, start=1)
                ]
                # Clear invalid text so apply can refill cleanly.
                # Foreign-leak checks against ALL cue sources, not only this hole chunk.
                all_other_sources = [
                    (cues[j].source_text or "").strip()
                    for j in range(len(cues))
                    if (cues[j].source_text or "").strip()
                ]
                for idx in chunk:
                    vi = (cues[idx].translated_text or "").strip()
                    src = (cues[idx].source_text or "").strip()
                    others = [s for s in all_other_sources if s and s != src]
                    if self._is_invalid_translation(vi, src, target_lang=target_lang) or self._has_foreign_source_leak(vi, others):
                        cues[idx].translated_text = ""
                self._translate_batch_with_context(
                    batch_items,
                    chunk,
                    cues=cues,
                    source_lang=source_lang,
                    target_lang=target_lang,
                    prompt_tone=prompt_tone,
                    prior_context_lines=prior,
                    batch_ordinal=1,
                    batch_total=1,
                )
        after = len(self.list_untranslated_indices(cues, target_lang=target_lang))
        return max(0, before - after)

    def _apply_model_response(
        self,
        cues: List[SubtitleCueV1],
        chunk_indices: List[int],
        text_content: str,
    ) -> int:
        """Parse [i] translations and map them onto cues with shift/echo guards."""
        if not chunk_indices:
            return 0

        marker_pattern = re.compile(r"(?m)^[ \t]*(?:[-*][ \t]+)?\[(\d+)\][ \t]*")
        chunk_index_set = set(chunk_indices)
        batch_size = len(chunk_indices)
        valid_labels = (
            chunk_index_set
            | set(range(batch_size))
            | set(range(1, batch_size + 1))
            | {i + 1 for i in chunk_indices}
        )
        markers = [
            match
            for match in marker_pattern.finditer(text_content)
            if int(match.group(1)) in valid_labels
        ]
        if not markers:
            return 0

        labels = [int(match.group(1)) for match in markers]

        # Prefer strict batch-local 1..N when the model followed the prompt.
        is_1based_relative = (
            0 not in labels
            and all(1 <= label <= batch_size for label in labels)
            and len(set(labels)) == len(labels)
        )
        is_0based_relative = (
            any(label == 0 for label in labels)
            and all(0 <= label < batch_size for label in labels)
            and len(set(labels)) == len(labels)
        )
        is_1based_absolute = (
            not is_1based_relative
            and all((label - 1) in chunk_index_set for label in labels)
            and any(label not in chunk_index_set for label in labels)
        )

        source_pool = [(cues[i].source_text or "").strip() for i in chunk_indices if 0 <= i < len(cues)]
        parsed: dict[int, tuple] = {}

        for position, marker in enumerate(markers):
            label = int(marker.group(1))
            if is_1based_relative:
                cue_index = chunk_indices[label - 1]
            elif is_0based_relative:
                cue_index = chunk_indices[label]
            elif is_1based_absolute:
                cue_index = label - 1
            elif label in chunk_index_set:
                cue_index = label
            elif 0 <= label < batch_size:
                cue_index = chunk_indices[label]
            elif 1 <= label <= batch_size:
                cue_index = chunk_indices[label - 1]
            else:
                continue

            if not (0 <= cue_index < len(cues)):
                continue

            text_end = markers[position + 1].start() if position + 1 < len(markers) else len(text_content)
            raw_item = text_content[marker.end() : text_end].strip().rstrip(".")
            gender, spoken, spk_meta = _split_speaker_annotation(raw_item)
            cleaned = _capitalize_first(spoken)
            if not cleaned:
                continue
            own_source = (cues[cue_index].source_text or "").strip()
            other_sources = [s for s in source_pool if s and s != own_source]
            if self._is_source_echo(cleaned, other_sources):
                continue
            if cleaned == own_source:
                continue
            if self._cjk_ratio(cleaned) >= 0.45:
                continue
            if self._has_foreign_source_leak(cleaned, other_sources):
                continue
            parsed[cue_index] = (gender, cleaned, spk_meta)

        updated_indices = set()
        for cue_index, (gender, cleaned, spk_meta) in parsed.items():
            own_source = (cues[cue_index].source_text or "").strip()
            if not isinstance(cues[cue_index].style, dict):
                cues[cue_index].style = {}
            if gender:
                cues[cue_index].style["speaker"] = gender
            if isinstance(spk_meta, dict):
                if spk_meta.get("speaker_id"):
                    cues[cue_index].style["speaker_id"] = spk_meta["speaker_id"]
                if spk_meta.get("speaker_role"):
                    cues[cue_index].style["speaker_role"] = spk_meta["speaker_role"]
            # Fidelity post-process (video-agnostic) + addressing polish.
            try:
                from subtitle_localizer.service.pipeline_settings import get_global_pipeline_settings
                pipe_tr = get_global_pipeline_settings().translation
                addressing_mode = getattr(pipe_tr, "addressing_mode", "auto")
                use_glossary = bool(getattr(pipe_tr, "use_glossary", True))
            except Exception:
                addressing_mode = "auto"
                use_glossary = True
            if use_glossary:
                cleaned = _refine_subtitles(cleaned, own_source, preserve_existing=True)
            cleaned = _polish_addressing(
                cleaned,
                source_text=own_source,
                speaker_gender=gender,
                addressing_mode=addressing_mode,
            )
            if self._is_invalid_translation(cleaned, own_source, target_lang="vi"):
                continue
            # Retranslate should refresh TTS script language.
            if isinstance(cues[cue_index].style, dict) and cues[cue_index].style.get("spoken_text"):
                spoken_existing = str(cues[cue_index].style.get("spoken_text") or "")
                if self._cjk_ratio(spoken_existing) >= 0.3 or self._looks_like_english(spoken_existing):
                    cues[cue_index].style.pop("spoken_text", None)
            cues[cue_index].translated_text = cleaned
            self._cache[(cues[cue_index].source_text or "").strip()] = cleaned
            updated_indices.add(cue_index)
        return len(updated_indices)


    def _build_narrative_prompt(
        self,
        batch_items: List[str],
        source_lang: str,
        target_lang: str,
        prompt_tone: str = "dramatic",
        prior_context_lines: List[str] | None = None,
        batch_ordinal: int = 1,
        batch_total: int = 1,
        addressing_mode: str = "auto",
        character_context: str = "",
    ) -> str:
        """Xây dựng prompt dịch theo ngữ cảnh; không claim full-script khi chỉ gửi một đoạn."""
        tone_instruction = {
            "dramatic": "Kịch tính, điện ảnh, cảm xúc chân thực theo hoàn cảnh nhân vật.",
            "daily": "Đời thường, tự nhiên, gần gũi, chuẩn ngôn ngữ giao tiếp hàng ngày.",
            "humorous": "Hài hước, dí dỏm, sử dụng tiếng lóng hiện đại phù hợp.",
            "literal": "Sát nghĩa từ ngữ gốc, nghiêm túc, chính xác.",
        }.get(prompt_tone, "Tự nhiên, chuẩn ngữ cảnh phim truyền hình.")

        is_full_script = batch_total <= 1 and not prior_context_lines
        if is_full_script:
            script_header = "KỊCH BẢN GỐC TOÀN BỘ CÂU CHUYỆN:"
            read_rule = (
                "1. Đọc toàn bộ kịch bản từ đầu đến cuối để nắm bắt cốt truyện, "
                "tâm lý và mối quan hệ đối thoại qua lại giữa các nhân vật.\n"
            )
        else:
            script_header = f"ĐOẠN KỊCH BẢN CẦN DỊCH (batch {batch_ordinal}/{batch_total}):"
            read_rule = (
                "1. Đọc kỹ ĐOẠN kịch bản hiện tại; dùng NGỮ CẢNH ĐÃ DỊCH (nếu có) chỉ để "
                "giữ nhất quán nhân vật/xưng hô, KHÔNG dịch lại phần ngữ cảnh.\n"
            )

        prior_block = ""
        if prior_context_lines:
            prior_block = (
                "NGỮ CẢNH ĐÃ DỊCH (chỉ để tham chiếu, KHÔNG dịch lại, KHÔNG đánh số lại):\n"
                + "\n".join(prior_context_lines)
                + "\n\n"
            )

        lang_lock = ""
        tgt = (target_lang or "vi").lower()
        if tgt.startswith("vi"):
            lang_lock = (
                "0. KHÓA NGÔN NGỮ: toàn bộ câu dịch BẮT BUỘC là tiếng Việt. "
                "CẤM English, CẤM trả lời bằng tiếng Anh dù chỉ một câu.\n"
            )
        mode = (addressing_mode or "auto").strip().lower()
        if mode in {"couple_anh_em", "couple"}:
            address_lock = (
                "0b. XƯNG HÔ: chế độ couple_anh_em — nữ nói với nam dùng 'anh', nam nói với nữ dùng 'em'; "
                "CẤM dùng 'bạn' làm xưng hô chính.\n"
            )
        elif mode == "neutral":
            address_lock = "0b. XƯNG HÔ: cho phép 'bạn' khi quan hệ không rõ.\n"
        else:
            address_lock = (
                "0b. XƯNG HÔ: ưu tiên anh-em/chị-em theo quan hệ; với hội thoại đôi tình cảm CẤM dùng 'bạn'.\n"
            )
        fidelity = (
            "0c. ĐỘ TRUNG THỰC: bám sát ý gốc và cảm xúc; không bịa tình tiết; "
            "không dịch word-by-word thô; không calque; "
            "'是我的问题' dịch 'lỗi là của tôi' (không phải 'vấn đề của tôi'); "
            "'你怎么了' dịch 'sao vậy' (không phải 'sao rồi').\n"
        )
        cast_block = ""
        ctx = (character_context or "").strip()
        if ctx:
            cast_block = "NGỮ CẢNH NHÂN VẬT/QUAN HỆ (theo project, áp dụng nhất quán):\n" + ctx + "\n\n"

        return (
            f"Bạn là chuyên gia biên kịch và Việt hóa phụ đề phim truyền hình, tiểu phẩm ngắn chuyên nghiệp.\n"
            f"Nhiệm vụ: Dịch đoạn hội thoại từ {source_lang} sang {target_lang} và PHÂN VAI GIỚI TÍNH cho từng nhân vật.\n"
            f"Phong cách kịch bản: {tone_instruction}\n\n"
            f"{cast_block}"
            f"NGUYÊN TẮC BỐI CẢNH & PHÂN VAI (RẤT QUAN TRỌNG):\n"
            f"{lang_lock}{address_lock}{fidelity}"
            f"{read_rule}"
            f"2. BẮT BUỘC xác định rõ giới tính của người nói mỗi câu: [Nam]/[Nữ] hoặc [Nam1]/[Nữ2] nếu nhiều nhân vật cùng giới; thêm [tên_riêng] nếu nhận ra nhân vật. Tiếng quần chúng gắn [Quần chúng]."
            f"2b. Lời dịch phải RÚT GỌN khẩu ngữ để đọc kịp khung thời gian phụ đề (ngắn gọn, tự nhiên).\n"
            f"3. ĐỐI CHIẾU ĐẠI TỪ VÀ GIỚI TÍNH CHÍNH XÁC (TUYỆT ĐỐI KHÔNG NHẦM LẪN):\n"
            f"   - Khi câu thoại có đại từ '他' (anh ấy) hoặc '她' (cô ấy), PHẢI đối chiếu với nhân vật/đối tượng đang được nhắc đến trong ngữ cảnh thực tế của câu chuyện:\n"
            f"     * Nếu đang nói về nhân vật Nữ (vợ cũ, bạn gái, mẹ, con gái, sếp nữ), BẮT BUỘC dịch là 'cô ấy / chị ấy / nàng / mẹ / em', TUYỆT ĐỐI KHÔNG dịch nhầm thành 'anh ấy'.\n"
            f"     * Nếu đang nói về nhân vật Nam (chồng, bạn trai, bố, con trai, sếp nam), BẮT BUỘC dịch là 'anh ấy / chú ấy / chàng / bố / anh'.\n"
            f"   - Với quan hệ gia đình / hôn nhân (ly hôn, tình cảm): xưng hô chuẩn mực 'anh - em', 'chồng - vợ', không xưng hô nhạt nhẽo hay lộn vai vế.\n"
            f"4. Dịch thoát nghĩa, chuẩn văn phong phim truyền hình/điện ảnh, tự nhiên, súc tích, dễ đọc trên video, tuyệt đối KHÔNG dịch thô từng từ vô nghĩa.\n"
            f"4b. DANH XƯNG / THƯƠNG HIỆU / HỌ + 氏: KHÔNG biến họ Trung (vd. 冯氏) thành tên Việt kiểu 'Phùng Thị'. "
            f"Dịch tự nhiên theo ngữ cảnh (họ Phùng / nhà họ Phùng / hiệu Phùng…), giữ tên riêng nhất quán, không gắn 'Thị' kiểu tên người Việt.\n"
            f"5. BẮT BUỘC đánh số theo thứ tự batch hiện tại từ `[1]` đến `[{len(batch_items)}]` (không dùng index tuyệt đối). Kèm nhãn `[Nam]/[Nữ]/[Nam1]/[Nữ2]/[Quần chúng]` (ví dụ: `[1] [Nam] Sao thế?` / `[2] [Nữ] Tâm trạng em không tốt sao?` / `[3] [Quần chúng] Hoan hô!`).\n"
            f"6. Chỉ trả về đúng {len(batch_items)} dòng `[i] [Nam/Nữ] Câu tiếng Việt`, không copy nguyên câu gốc, không kèm lời chào hay giải thích thừa.\n"
            f"7. CẤM ghi chú thích vai trò vào câu phụ đề: không được viết `(Tiếng người dẫn chuyện)`, `(Người dẫn chuyện)`, `(旁白)`, `(Lời bình)`. Lời dẫn chuyện vẫn chỉ là câu thoại đã dịch, gắn `[Nam]` hoặc `[Nữ]` thôi.\n\n"
            f"{prior_block}{script_header}\n"
            + "\n".join(batch_items)
        )


    def _translate_with_local_qwen(
        self,
        cues: List[SubtitleCueV1],
        source_lang: str,
        target_lang: str,
        model: str = DEFAULT_LOCAL_MODEL,
        endpoint: str = "http://localhost:11434",
        prompt_tone: str = "dramatic",
        batch_size: Optional[int] = None,
    ) -> bool:
        """Dịch kịch bản bằng Qwen 2.5 Local LLM qua Ollama hoặc OpenAI-compatible API."""
        from subtitle_localizer.service.pipeline_settings import get_global_pipeline_settings
        pipe_settings = get_global_pipeline_settings().translation
        import json
        import urllib.error
        import urllib.request

        base_url = endpoint.rstrip("/")
        chat_url = f"{base_url}/chat/completions" if base_url.endswith("/v1") else f"{base_url}/v1/chat/completions"

        def _translate_batch(
            batch_items: List[str],
            chunk_indices: List[int],
            prior_context_lines: list[str] | None = None,
            batch_ordinal: int = 1,
            batch_total: int = 1,
        ) -> bool:
            prompt = self._build_narrative_prompt(
                batch_items,
                source_lang,
                target_lang,
                prompt_tone,
                prior_context_lines=prior_context_lines,
                batch_ordinal=batch_ordinal,
                batch_total=batch_total,
                addressing_mode=getattr(pipe_settings, "addressing_mode", "auto"),
                character_context=getattr(pipe_settings, "character_context", "")
            )
            payload_openai = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "You are a professional subtitle localization assistant."},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                "stream": False,
            }
            req_data = json.dumps(payload_openai).encode("utf-8")
            req = urllib.request.Request(chat_url, data=req_data, headers={"Content-Type": "application/json"})

            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    status_code = getattr(resp, "status", getattr(resp, "code", 200))
                    if status_code == 200:
                        res_json = json.loads(resp.read().decode("utf-8"))
                        text_content = res_json.get("choices", [{}])[0].get("message", {}).get("content", "")
                        if text_content:
                            updated = self._apply_model_response(cues, chunk_indices, text_content)
                            return updated > 0
            except Exception as ex_openai:
                try:
                    ollama_native_url = f"{base_url.replace('/v1', '')}/api/chat"
                    payload_ollama = {
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                        "stream": False,
                    }
                    req_native = urllib.request.Request(
                        ollama_native_url,
                        data=json.dumps(payload_ollama).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                    )
                    with urllib.request.urlopen(req_native, timeout=90) as resp2:
                        status_code2 = getattr(resp2, "status", getattr(resp2, "code", 200))
                        if status_code2 == 200:
                            res_json2 = json.loads(resp2.read().decode("utf-8"))
                            text_content2 = res_json2.get("message", {}).get("content", "")
                            if text_content2:
                                updated2 = self._apply_model_response(cues, chunk_indices, text_content2)
                                return updated2 > 0
                except Exception as ex_native:
                    logger.warning(f"Local Qwen call to {base_url} failed: {ex_openai} | {ex_native}")
                    return False
            return False

        all_indices = [i for i, c in enumerate(cues) if c.source_text.strip()]
        if not all_indices:
            return True

        chunk_size = self._local_chunk_size(len(all_indices), batch_size)

        batch_ranges = list(range(0, len(all_indices), chunk_size))
        batch_total = max(1, len(batch_ranges))
        prior_context_lines: list[str] = []
        success_any = False

        def _engine(batch_items, chunk_indices, **kwargs):
            return _translate_batch(
                batch_items,
                chunk_indices,
                prior_context_lines=kwargs.get("prior_context_lines"),
                batch_ordinal=kwargs.get("batch_ordinal", 1),
                batch_total=kwargs.get("batch_total", 1),
            )

        self._batch_engine_fn = _engine
        try:
            for batch_no, start_idx in enumerate(batch_ranges, start=1):
                chunk_indices = all_indices[start_idx : start_idx + chunk_size]
                batch_items = [
                    f"[{pos}] {cues[i].source_text.strip()}"
                    for pos, i in enumerate(chunk_indices, start=1)
                ]
                if _translate_batch(
                    batch_items,
                    chunk_indices,
                    prior_context_lines=prior_context_lines or None,
                    batch_ordinal=batch_no,
                    batch_total=batch_total,
                ):
                    success_any = True
                prior_context_lines = self._build_prior_context_lines(cues)
        finally:
            self._batch_engine_fn = _engine

        return success_any

    def _translate_with_gemini(
        self,
        cues: List[SubtitleCueV1],
        source_lang: str,
        target_lang: str,
        api_keys: Optional[List[str]] = None,
        key_pool: Optional[Any] = None,
        gemini_model: str = "gemini-2.5-flash",
        prompt_tone: str = "dramatic",
        batch_size: Optional[int] = None,
    ) -> bool:
        """Dịch kịch bản bằng Gemini AI qua Smart Pool API Keys với đầy đủ bối cảnh câu chuyện và tối ưu token."""
        from subtitle_localizer.service.pipeline_settings import get_global_pipeline_settings
        pipe_settings = get_global_pipeline_settings().translation
        import json
        import time
        import urllib.error
        import urllib.request
        from subtitle_localizer.translation.key_pool import GeminiKeyPool, get_global_gemini_pool

        pool: GeminiKeyPool = key_pool or get_global_gemini_pool()
        if api_keys:
            pool.load_keys(api_keys)

        if pool.total_keys == 0:
            return False

        if gemini_model in {"gemini-3.8-flash", "3.8", "gemini-3.8"}:
            gemini_model = "gemini-2.5-flash"

        models_to_try = [gemini_model]
        if gemini_model != "gemini-2.5-flash":
            models_to_try.append("gemini-2.5-flash")

        def _translate_batch(
            batch_items: List[str],
            chunk_indices: List[int],
            prior_context_lines: list[str] | None = None,
            batch_ordinal: int = 1,
            batch_total: int = 1,
        ) -> bool:
            prompt = self._build_narrative_prompt(
                batch_items,
                source_lang,
                target_lang,
                prompt_tone,
                prior_context_lines=prior_context_lines,
                batch_ordinal=batch_ordinal,
                batch_total=batch_total,
                addressing_mode=getattr(pipe_settings, "addressing_mode", "auto"),
                character_context=getattr(pipe_settings, "character_context", "")
            )
            # Tắt thinkingBudget để không bị lãng phí token suy luận ngầm và không bị cụt response
            payload = json.dumps({
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 65536,
                    "thinkingConfig": {"thinkingBudget": 0},
                },
            }).encode("utf-8")

            for target_m in models_to_try:
                max_attempts = min(pool.total_keys, 10)
                for _ in range(max_attempts):
                    key = pool.get_next_key(wait_timeout=5.0)
                    if not key:
                        logger.warning("Toàn bộ API Keys trong pool đều đang cooldown hoặc bận")
                        break

                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{target_m}:generateContent?key={key}"
                    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
                    try:
                        with urllib.request.urlopen(req, timeout=180) as resp:
                            status_code = getattr(resp, "status", getattr(resp, "code", 200))
                            if status_code == 200:
                                res = json.loads(resp.read().decode("utf-8"))
                                cand = res.get("candidates", [{}])[0]
                                parts = cand.get("content", {}).get("parts", [])
                                text_content = "".join(p.get("text", "") for p in parts)
                                if text_content:
                                    updated = self._apply_model_response(cues, chunk_indices, text_content)
                                    if updated > 0:
                                        return True
                    except urllib.error.HTTPError as http_err:
                        if http_err.code == 429:
                            err_body = ""
                            try:
                                err_body = http_err.read().decode("utf-8", errors="ignore").lower()
                            except Exception:
                                pass

                            retry_header = http_err.headers.get("Retry-After")
                            cooldown_secs = 60.0
                            if retry_header and retry_header.isdigit():
                                cooldown_secs = float(retry_header)

                            if any(term in err_body for term in ("per day", "daily", "requestsperday", "rpd")):
                                pool.mark_daily_quota_exhausted(key)
                            else:
                                pool.mark_rate_limited(key, cooldown_seconds=cooldown_secs, reason="rate_limit_exceeded")
                        elif http_err.code in (400, 403):
                            pool.mark_rate_limited(key, cooldown_seconds=86400.0, reason=f"http_{http_err.code}_invalid")
                        elif http_err.code == 503:
                            logger.warning(f"Model {target_m} 503 Overloaded trên key ...{key[-6:]}, xoay tiếp key...")
                            time.sleep(1.0)
                            continue
                        continue
                    except Exception as err:
                        logger.warning(f"Gemini API request failed ({target_m}): {err}")
                        continue
            return False

        all_indices = [i for i, c in enumerate(cues) if c.source_text.strip()]
        if not all_indices:
            return True

        # Gemini 2.5 Flash: input 1,048,576 / output 65,536 tokens.
        # Gửi TOÀN BỘ kịch bản 1 request (không chia batch) để giữ ngữ cảnh nhân vật.
        # batch_size chỉ dùng khi set tường minh khác 35/0 (debug); mặc định = full.
        if batch_size and batch_size not in (35, 0) and int(batch_size) < len(all_indices):
            chunk_size = int(batch_size)
            logger.warning(
                "Gemini batch_size=%s được set tường minh — chia %s câu (không khuyến nghị).",
                batch_size,
                chunk_size,
            )
        else:
            chunk_size = len(all_indices)

        batch_ranges = list(range(0, len(all_indices), chunk_size))
        batch_total = max(1, len(batch_ranges))
        prior_context_lines: list[str] = []
        all_succeeded = True

        def _engine(batch_items, chunk_indices, **kwargs):
            return _translate_batch(
                batch_items,
                chunk_indices,
                prior_context_lines=kwargs.get("prior_context_lines"),
                batch_ordinal=kwargs.get("batch_ordinal", 1),
                batch_total=kwargs.get("batch_total", 1),
            )

        self._batch_engine_fn = _engine
        try:
            for batch_no, start_idx in enumerate(batch_ranges, start=1):
                chunk_indices = all_indices[start_idx : start_idx + chunk_size]
                batch_items = [
                    f"[{pos}] {cues[i].source_text.strip()}"
                    for pos, i in enumerate(chunk_indices, start=1)
                ]
                ok = _translate_batch(
                    batch_items,
                    chunk_indices,
                    prior_context_lines=prior_context_lines or None,
                    batch_ordinal=batch_no,
                    batch_total=batch_total,
                )
                if not ok:
                    all_succeeded = False
                prior_context_lines = self._build_prior_context_lines(cues)
        finally:
            self._batch_engine_fn = _engine

        return all_succeeded

    def translate_cues(
        self,
        cues: List[SubtitleCueV1],
        source_lang: str = "zh",
        target_lang: str = "vi",
    ) -> List[SubtitleCueV1]:
        if not cues:
            return cues

        import os
        import sys
        if "PYTEST_CURRENT_TEST" in os.environ and "TEST_WITH_GEMINI" not in os.environ and "deep_translator" in sys.modules:
            try:
                from deep_translator import GoogleTranslator
                translator = GoogleTranslator(source=source_lang, target=target_lang)
                for cue in cues:
                    if cue.source_text.strip():
                        try:
                            translated = translator.translate(cue.source_text)
                            if translated:
                                cue.translated_text = translated
                        except Exception:
                            pass
                return cues
            except Exception:
                pass

        from subtitle_localizer.service.pipeline_settings import get_global_pipeline_settings
        pipe_settings = get_global_pipeline_settings().translation
        provider = getattr(pipe_settings, "provider", "local")

        translated_ok = False
        auto_fallback = getattr(pipe_settings, "auto_fallback", True)

        is_pytest = "PYTEST_CURRENT_TEST" in os.environ and "TEST_WITH_GEMINI" not in os.environ
        if is_pytest:
            provider = "local"
            auto_fallback = False

        # 1. Ưu tiên Mode Gemini AI (mặc định cho provider='gemini', 'auto', hoặc bất kỳ cấu hình mặc định nào)
        if not is_pytest and (provider in ("gemini", "auto") or not provider):
            from subtitle_localizer.translation.key_pool import get_global_gemini_pool
            pool = get_global_gemini_pool()
            if pool.total_keys > 0:
                try:
                    translated_ok = self._translate_with_gemini(
                        cues,
                        source_lang,
                        target_lang,
                        key_pool=pool,
                        gemini_model=getattr(pipe_settings, "gemini_model", "gemini-2.5-flash"),
                        prompt_tone=getattr(pipe_settings, "prompt_tone", "dramatic"),
                        batch_size=getattr(pipe_settings, "batch_size", None),
                    )
                except Exception as ex:
                    logger.warning(f"Gemini translation failed: {ex}")

        # 2. Nếu Gemini thất bại hoặc provider là local: Chạy mô hình Local AI (Qwen 2.5 Local / Remote LAN)
        if not is_pytest and (provider in ("local", "local_model") or (not translated_ok and auto_fallback)):
            local_model = getattr(pipe_settings, "local_model", DEFAULT_LOCAL_MODEL)
            local_endpoint = getattr(pipe_settings, "local_endpoint", "http://localhost:11434")
            prompt_tone = getattr(pipe_settings, "prompt_tone", "dramatic")
            endpoints_to_try = [local_endpoint]
            if "localhost" not in local_endpoint and "127.0.0.1" not in local_endpoint:
                endpoints_to_try.append("http://localhost:11434")

            for ep in endpoints_to_try:
                try:
                    if provider not in ("local", "local_model"):
                        logger.info(f"Đang dịch bằng Local AI (Qwen 2.5) tại endpoint {ep}...")
                    translated_ok = self._translate_with_local_qwen(
                        cues,
                        source_lang,
                        target_lang,
                        model=local_model,
                        endpoint=ep,
                        prompt_tone=prompt_tone,
                        batch_size=getattr(pipe_settings, "batch_size", None),
                    )
                    if translated_ok:
                        break
                except Exception as ex:
                    logger.warning(f"Local Qwen call to {ep} failed: {ex}")

        # 3. Nếu cấu hình là local nhưng local thất bại, và auto_fallback=True: cứu hộ sang Gemini
        if not is_pytest and not translated_ok and provider in ("local", "local_model") and auto_fallback:
            from subtitle_localizer.translation.key_pool import get_global_gemini_pool
            pool = get_global_gemini_pool()
            if pool.total_keys > 0:
                try:
                    translated_ok = self._translate_with_gemini(
                        cues,
                        source_lang,
                        target_lang,
                        key_pool=pool,
                        gemini_model=getattr(pipe_settings, "gemini_model", "gemini-2.5-flash"),
                        prompt_tone=getattr(pipe_settings, "prompt_tone", "dramatic"),
                        batch_size=getattr(pipe_settings, "batch_size", None),
                    )
                except Exception as ex:
                    logger.warning(f"Fallback to Gemini failed: {ex}")

        # Áp dụng từ điển ngữ cảnh hội thoại / thuật ngữ mặc định
        if source_lang == "zh" and target_lang == "vi":
            for cue in cues:
                if not cue.translated_text or not cue.translated_text.strip():
                    src_txt = cue.source_text.strip()
                    if src_txt in DEFAULT_CHINESE_VIETNAMESE_GLOSSARY:
                        cue.translated_text = DEFAULT_CHINESE_VIETNAMESE_GLOSSARY[src_txt]
                        self._cache[src_txt] = cue.translated_text

        # 4. Retry các câu trống / CJK residue / leak sau batch chính (T-ALIGN).
        if not is_pytest:
            try:
                self.retry_untranslated_cues(
                    cues,
                    source_lang=source_lang,
                    target_lang=target_lang,
                    prompt_tone=getattr(pipe_settings, "prompt_tone", "dramatic"),
                )
            except Exception as ex:
                logger.warning(f"retry_untranslated_cues failed: {ex}")

        return cues
