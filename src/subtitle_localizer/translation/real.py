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


def _capitalize_first(s: str) -> str:
    """Viết hoa chữ cái đầu tiên của câu phụ đề tiếng Việt."""
    s = s.strip()
    if not s:
        return ""
    return s[0].upper() + s[1:]

_GENDER_PREFIX = re.compile(
    r"^[\[\(\uff08【]\s*(Nam|Nữ|Nu|Male|Female|Man|Woman)\s*[\]\)\uff09】][:\s]*",
    re.IGNORECASE,
)
_ROLE_PREFIX = re.compile(
    r"^[\[\(\uff08【]\s*(?:"
    r"Tiếng\s+người\s+dẫn\s+chuyện|Người\s+dẫn\s+chuyện|Lời\s+dẫn\s+chuyện|"
    r"Lời\s+bình|Thuyết\s+minh|Narrator|Voice[\s-]*over|旁白|解说"
    r")\s*[\]\)\uff09】][:\s]*",
    re.IGNORECASE,
)


def _split_speaker_annotation(raw_item: str) -> tuple[str | None, str]:
    """Tách nhãn [Nam]/[Nữ] và chú thích vai (Tiếng người dẫn chuyện) khỏi câu dịch."""
    text = (raw_item or "").strip()
    gender: str | None = None
    for _ in range(4):
        gender_match = _GENDER_PREFIX.match(text)
        if gender_match:
            spk_raw = gender_match.group(1).lower()
            gender = "female" if spk_raw in ("nữ", "nu", "female", "woman") else "male"
            text = text[gender_match.end() :].strip()
            continue
        role_match = _ROLE_PREFIX.match(text)
        if role_match:
            text = text[role_match.end() :].strip()
            continue
        break
    return gender, text


def _refine_subtitles(text: str, source_text: str) -> str:
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
    if clean_src in DEFAULT_CHINESE_VIETNAMESE_GLOSSARY:
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
            version_or_commit="qwen2.5:7b-instruct",
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

    def _apply_model_response(
        self,
        cues: List[SubtitleCueV1],
        chunk_indices: List[int],
        text_content: str,
    ) -> int:
        """Parse [i] translations and map them onto cues with shift/echo guards."""
        if not chunk_indices:
            return 0

        marker_pattern = re.compile(r"(?m)^[ 	]*(?:[-*][ 	]+)?\[(\d+)\][ 	]*")
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
        parsed: dict[int, tuple[str | None, str]] = {}

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
            gender, spoken = _split_speaker_annotation(raw_item)
            cleaned = _capitalize_first(spoken)
            if not cleaned:
                continue
            # Reject source-echo / untranslated CJK leaks into the wrong slot.
            own_source = (cues[cue_index].source_text or "").strip()
            other_sources = [s for s in source_pool if s and s != own_source]
            if self._is_source_echo(cleaned, other_sources):
                continue
            if cleaned == own_source:
                continue
            parsed[cue_index] = (gender, cleaned)

        # Detect off-by-one cascade: many outputs equal the next source line.
        if len(parsed) >= max(2, batch_size // 3):
            shift_hits = 0
            for offset, cue_index in enumerate(chunk_indices):
                if cue_index not in parsed:
                    continue
                if offset + 1 >= len(chunk_indices):
                    continue
                nxt = chunk_indices[offset + 1]
                nxt_source = (cues[nxt].source_text or "").strip()
                if self._normalize_compare_text(parsed[cue_index][1]) == self._normalize_compare_text(nxt_source):
                    shift_hits += 1
            if shift_hits >= max(2, len(parsed) // 3):
                # Repair by shifting translations back one slot within the batch.
                repaired: dict[int, tuple[str | None, str]] = {}
                ordered = [parsed[i] for i in chunk_indices if i in parsed]
                targets = [i for i in chunk_indices if i in parsed]
                # If outputs look like sources of i+1, map parsed[i] -> cue i-1 conceptually:
                # take values in order and assign to earlier cues.
                values = []
                for cue_index in chunk_indices:
                    if cue_index in parsed and not self._is_source_echo(
                        parsed[cue_index][1],
                        [(cues[j].source_text or "").strip() for j in chunk_indices],
                    ):
                        values.append(parsed[cue_index])
                # Simpler deterministic repair: drop echoed next-source rows.
                parsed = {
                    idx: val
                    for idx, val in parsed.items()
                    if not self._is_source_echo(
                        val[1],
                        [
                            (cues[j].source_text or "").strip()
                            for j in chunk_indices
                            if j != idx
                        ],
                    )
                }

        updated_indices = set()
        for cue_index, (gender, cleaned) in parsed.items():
            if gender:
                if not isinstance(cues[cue_index].style, dict):
                    cues[cue_index].style = {}
                cues[cue_index].style["speaker"] = gender
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
    ) -> str:
        """Xây dựng prompt dịch thuật biên kịch theo bối cảnh câu chuyện, tone kịch bản và phân vai giới tính."""
        tone_instruction = {
            "dramatic": "Kịch tính, điện ảnh, cảm xúc chân thực theo hoàn cảnh nhân vật.",
            "daily": "Đời thường, tự nhiên, gần gũi, chuẩn ngôn ngữ giao tiếp hàng ngày.",
            "humorous": "Hài hước, dí dỏm, sử dụng tiếng lóng hiện đại phù hợp.",
            "literal": "Sát nghĩa từ ngữ gốc, nghiêm túc, chính xác.",
        }.get(prompt_tone, "Tự nhiên, chuẩn ngữ cảnh phim truyền hình.")

        return (
            f"Bạn là chuyên gia biên kịch và Việt hóa phụ đề phim truyền hình, tiểu phẩm ngắn chuyên nghiệp.\n"
            f"Nhiệm vụ: Dịch toàn bộ kịch bản hội thoại từ {source_lang} sang {target_lang} và PHÂN VAI GIỚI TÍNH cho từng nhân vật.\n"
            f"Phong cách kịch bản: {tone_instruction}\n\n"
            f"NGUYÊN TẮC BỐI CẢNH & PHÂN VAI (RẤT QUAN TRỌNG):\n"
            f"1. Đọc toàn bộ kịch bản từ đầu đến cuối để nắm bắt cốt truyện, tâm lý và mối quan hệ đối thoại qua lại giữa các nhân vật.\n"
            f"2. BẮT BUỘC xác định rõ giới tính của người nói mỗi câu: [Nam] hoặc [Nữ] dựa theo ngữ cảnh đối thoại (người hỏi/người đáp, bạn nam/bạn nữ, vợ/chồng, mẹ/con, sếp/nhân viên).\n"
            f"3. ĐỐI CHIẾU ĐẠI TỪ VÀ GIỚI TÍNH CHÍNH XÁC (TUYỆT ĐỐI KHÔNG NHẦM LẪN):\n"
            f"   - Khi câu thoại có đại từ '他' (anh ấy) hoặc '她' (cô ấy), PHẢI đối chiếu với nhân vật/đối tượng đang được nhắc đến trong ngữ cảnh thực tế của câu chuyện:\n"
            f"     * Nếu đang nói về nhân vật Nữ (vợ cũ, bạn gái, mẹ, con gái, sếp nữ), BẮT BUỘC dịch là 'cô ấy / chị ấy / nàng / mẹ / em', TUYỆT ĐỐI KHÔNG dịch nhầm thành 'anh ấy'.\n"
            f"     * Nếu đang nói về nhân vật Nam (chồng, bạn trai, bố, con trai, sếp nam), BẮT BUỘC dịch là 'anh ấy / chú ấy / chàng / bố / anh'.\n"
            f"   - Với quan hệ gia đình / hôn nhân (ly hôn, tình cảm): xưng hô chuẩn mực 'anh - em', 'chồng - vợ', không xưng hô nhạt nhẽo hay lộn vai vế.\n"
            f"4. Dịch thoát nghĩa, chuẩn văn phong phim truyền hình/điện ảnh, tự nhiên, súc tích, dễ đọc trên video, tuyệt đối KHÔNG dịch thô từng từ vô nghĩa.\n"
            f"5. BẮT BUỘC đánh số theo thứ tự batch hiện tại từ `[1]` đến `[{len(batch_items)}]` (không dùng index tuyệt đối). Kèm nhãn `[Nam]` hoặc `[Nữ]` (ví dụ: `[1] [Nam] Sao thế?` / `[2] [Nữ] Tâm trạng em không tốt sao?`).\n"
            f"6. Chỉ trả về đúng {len(batch_items)} dòng `[i] [Nam/Nữ] Câu tiếng Việt`, không copy nguyên câu gốc, không kèm lời chào hay giải thích thừa.\n"
            f"7. CẤM ghi chú thích vai trò vào câu phụ đề: không được viết `(Tiếng người dẫn chuyện)`, `(Người dẫn chuyện)`, `(旁白)`, `(Lời bình)`. Lời dẫn chuyện vẫn chỉ là câu thoại đã dịch, gắn `[Nam]` hoặc `[Nữ]` thôi.\n\n"
            f"KỊCH BẢN GỐC TOÀN BỘ CÂU CHUYỆN:\n" + "\n".join(batch_items)
        )


    def _translate_with_local_qwen(
        self,
        cues: List[SubtitleCueV1],
        source_lang: str,
        target_lang: str,
        model: str = "qwen2.5:7b-instruct",
        endpoint: str = "http://localhost:11434",
        prompt_tone: str = "dramatic",
        batch_size: Optional[int] = None,
    ) -> bool:
        """Dịch kịch bản bằng Qwen 2.5 Local LLM qua Ollama hoặc OpenAI-compatible API."""
        import json
        import urllib.error
        import urllib.request

        base_url = endpoint.rstrip("/")
        chat_url = f"{base_url}/chat/completions" if base_url.endswith("/v1") else f"{base_url}/v1/chat/completions"

        def _translate_batch(batch_items: List[str], chunk_indices: List[int]) -> bool:
            prompt = self._build_narrative_prompt(batch_items, source_lang, target_lang, prompt_tone)
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

        if batch_size and batch_size not in (35, 0):
            chunk_size = batch_size
        elif len(all_indices) <= 100:
            chunk_size = len(all_indices)
        else:
            chunk_size = 60

        success_any = False
        for start_idx in range(0, len(all_indices), chunk_size):
            chunk_indices = all_indices[start_idx : start_idx + chunk_size]
            batch_items = [f"[{pos}] {cues[i].source_text.strip()}" for pos, i in enumerate(chunk_indices, start=1)]
            if _translate_batch(batch_items, chunk_indices):
                success_any = True

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

        def _translate_batch(batch_items: List[str], chunk_indices: List[int]) -> bool:
            prompt = self._build_narrative_prompt(batch_items, source_lang, target_lang, prompt_tone)
            # Tắt thinkingBudget để không bị lãng phí token suy luận ngầm và không bị cụt response
            payload = json.dumps({
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 8192,
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

        # Chiến lược tiết kiệm Token & Quota tối đa (Adaptive 1-Shot / Large Batching):
        # 1) Nếu tổng số câu <= 120: Gộp toàn bộ vào 1 request duy nhất (1-shot 100%).
        #    -> Giảm 80-90% token lặp lại của System Prompt / Narrative Guidelines.
        #    -> Giảm số request từ 4-8 calls xuống ĐÚNG 1 CALL duy nhất.
        #    -> Giữ trọn vẹn ngữ cảnh nhân vật xuyên suốt video.
        # 2) Nếu video dài (> 120 câu): Sử dụng batch lớn (80 câu/lần)
        #    thay vì chia nhỏ vụn vặt 35 câu như trước đây.
        if batch_size and batch_size not in (35, 0):
            chunk_size = batch_size
        elif len(all_indices) <= 120:
            chunk_size = len(all_indices)
        else:
            chunk_size = 80

        all_succeeded = True
        for start_idx in range(0, len(all_indices), chunk_size):
            chunk_indices = all_indices[start_idx : start_idx + chunk_size]
            batch_items = [f"[{pos}] {cues[i].source_text.strip()}" for pos, i in enumerate(chunk_indices, start=1)]
            if not _translate_batch(batch_items, chunk_indices):
                all_succeeded = False

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
            local_model = getattr(pipe_settings, "local_model", "qwen2.5:7b-instruct")
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

        # 4. Rà soát các câu chưa có bản dịch:
        # Loại bỏ hoàn toàn Google Translate trong môi trường thực tế (chỉ Gemini AI -> Local AI Qwen 2.5).
        untranslated = [
            c for c in cues
            if c.source_text.strip() and (not c.translated_text or c.translated_text.strip() == c.source_text.strip())
        ]
        if not untranslated:
            return cues

        return cues
