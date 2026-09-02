from __future__ import annotations

import re
from typing import Dict, Optional, Tuple


class GlossaryPreserver:
    """Bảo toàn thuật ngữ, tên riêng và các con số không bị dịch sai lệch."""

    def __init__(self, terms: Optional[Dict[str, str]] = None) -> None:
        self.terms = terms or {}

    def protect_entities(self, text: str) -> Tuple[str, Dict[str, str]]:
        placeholders: Dict[str, str] = {}
        result = text

        # 1. Bảo vệ thuật ngữ glossary đã đăng ký
        for i, (term, _) in enumerate(self.terms.items()):
            if term in result:
                ph = f"__TERM_{i}__"
                placeholders[ph] = term
                result = result.replace(term, ph)

        # 2. Bảo vệ các số nguyên và số thực
        num_matches = list(re.finditer(r"\b\d+(?:\.\d+)?\b", result))
        for j, match in enumerate(num_matches):
            val = match.group(0)
            ph = f"__NUM_{j}__"
            placeholders[ph] = val
            # Replace từng lần từ cuối lên đầu hoặc match chính xác
            result = result.replace(val, ph, 1)

        return result, placeholders

    def restore_entities(self, text: str, placeholders: Dict[str, str], use_target_term: bool = False) -> str:
        result = text
        for ph, val in placeholders.items():
            if ph.startswith("__TERM_") and use_target_term:
                # Dùng bản dịch glossary nếu được yêu cầu
                target_val = self.terms.get(val, val)
                result = result.replace(ph, target_val)
            else:
                result = result.replace(ph, val)
        return result
