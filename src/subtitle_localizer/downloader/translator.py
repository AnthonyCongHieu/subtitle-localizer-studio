"""Local title translation compatibility helpers.

Network Google Translate was removed. Callers receive the original text when
no local translation service is wired into the downloader path.
"""

import os
import json
import re
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
    """Return source text; Google Translate network fallback is disabled."""
    raw = str(text or "").strip()
    if not raw or target_lang.lower() in ("none", "raw"):
        return raw

    cache_key = f"{target_lang}:{raw}"
    if cache_key in _cache:
        return _cache[cache_key]

    # Translation is handled by the pipeline's local Ollama provider.
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

    # Downloader no longer performs network translation; local pipeline owns it.
    for k in uncached_indices:
        results[k] = str(titles[k] or "").strip()
    return results
