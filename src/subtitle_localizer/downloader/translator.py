"""
translator.py - Dịch thuật tự động song ngữ (Google Translate gtx & Local Cache)
Hỗ trợ:
- Dịch từ khóa tiếng Việt sang tiếng Trung để tìm kiếm Bilibili
- Dịch hàng loạt tiêu đề video tiếng Trung sang tiếng Việt để hiển thị song ngữ
"""

import os
import json
import re
import urllib.request
import urllib.parse
from typing import List, Dict, Optional
from pathlib import Path

TRANSLATION_CACHE_FILE = Path(__file__).resolve().parent / "translation_cache.json"

_cache: Dict[str, str] = {}


def load_translation_cache() -> Dict[str, str]:
    global _cache
    if TRANSLATION_CACHE_FILE.exists():
        try:
            data = json.loads(TRANSLATION_CACHE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                _cache = data
                return _cache
        except Exception:
            pass
    _cache = {}
    return _cache


def save_translation_cache(cache_dict: Dict[str, str]) -> None:
    try:
        TRANSLATION_CACHE_FILE.write_text(
            json.dumps(cache_dict, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:
        pass


def clear_translation_cache() -> None:
    global _cache
    _cache = {}
    if TRANSLATION_CACHE_FILE.exists():
        try:
            TRANSLATION_CACHE_FILE.unlink(missing_ok=True)
        except Exception:
            pass


load_translation_cache()


def translate_text(text: str, target_lang: str = "zh-CN", timeout: float = 6.0) -> str:
    """Dịch một đoạn văn bản ngắn sang ngôn ngữ mục tiêu."""
    raw = str(text or "").strip()
    if not raw or target_lang.lower() in ("none", "raw"):
        return raw

    cache_key = f"{target_lang}:{raw}"
    if cache_key in _cache:
        return _cache[cache_key]

    try:
        url = "https://translate.googleapis.com/translate_a/single"
        params = {
            "client": "gtx",
            "sl": "auto",
            "tl": target_lang,
            "dt": "t",
            "q": raw,
        }
        query = urllib.parse.urlencode(params)
        req = urllib.request.Request(
            f"{url}?{query}",
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            translated_parts = []
            if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                for part in data[0]:
                    if part and len(part) > 0 and part[0]:
                        translated_parts.append(part[0])
            res = "".join(translated_parts).strip()
            if res:
                _cache[cache_key] = res
                save_translation_cache(_cache)
                return res
    except Exception:
        pass

    return raw


def translate_titles_batch(
    titles: List[str], target_lang: str = "vi", timeout: float = 8.0
) -> List[str]:
    """Dịch hàng loạt danh sách tiêu đề video sang ngôn ngữ đích trong 1 request duy nhất."""
    if not titles or target_lang.lower() in ("none", "raw"):
        return titles

    uncached_indices = []
    results = [""] * len(titles)

    for i, t in enumerate(titles):
        clean_t = str(t or "").strip()
        cache_key = f"{target_lang}:{clean_t}"
        if cache_key in _cache:
            results[i] = _cache[cache_key]
        else:
            uncached_indices.append(i)

    if not uncached_indices:
        return results

    # Gom các tiêu đề cần dịch vào 1 payload được đánh số thứ tự
    combined_lines = [f"[{k}] {titles[k]}" for k in uncached_indices]
    combined_text = "\n".join(combined_lines)

    try:
        url = "https://translate.googleapis.com/translate_a/single"
        params = {
            "client": "gtx",
            "sl": "auto",
            "tl": target_lang,
            "dt": "t",
        }
        post_data = urllib.parse.urlencode({"q": combined_text}).encode("utf-8")
        req_url = f"{url}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(
            req_url,
            data=post_data,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            translated_combined = ""
            if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
                for part in data[0]:
                    if part and len(part) > 0 and part[0]:
                        translated_combined += part[0]

            lines = translated_combined.strip().split("\n")
            line_map = {}
            for line in lines:
                m = re.match(r"^\[(\d+)\]\s*(.*)$", line.strip())
                if m:
                    idx = int(m.group(1))
                    val = m.group(2).strip()
                    line_map[idx] = val

            for k in uncached_indices:
                if k in line_map and line_map[k]:
                    val = line_map[k]
                    results[k] = val
                    _cache[f"{target_lang}:{titles[k]}"] = val
                else:
                    # Fallback dịch lẻ nếu phân tách dòng bị lệch
                    val = translate_text(titles[k], target_lang)
                    results[k] = val

            save_translation_cache(_cache)
            return results
    except Exception:
        # Fallback dịch lẻ từng tiêu đề
        for k in uncached_indices:
            results[k] = translate_text(titles[k], target_lang)
        return results
