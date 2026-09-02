from __future__ import annotations

from typing import Dict, Optional

from subtitle_localizer.translation.adapters import (
    NllbAdapter,
    OpusMtAdapter,
    TranslateGemmaAdapter,
)
from subtitle_localizer.translation.base import TranslationProvider
from subtitle_localizer.translation.mock import MockTranslationProvider


class TranslationRegistry:
    """Registry quản lý các Translation Providers trong hệ thống."""

    def __init__(self) -> None:
        self._providers: Dict[str, TranslationProvider] = {}
        self.register("mock", MockTranslationProvider())
        self.register("gemma", TranslateGemmaAdapter())
        self.register("nllb", NllbAdapter())
        self.register("opus", OpusMtAdapter())

    def register(self, name: str, provider: TranslationProvider) -> None:
        self._providers[name] = provider

    def get_provider(self, name: str) -> Optional[TranslationProvider]:
        return self._providers.get(name)

    def get_provider_for_pair(self, source_lang: str, target_lang: str = "vi") -> TranslationProvider:
        # Mặc định trả về MockTranslationProvider hoặc Gemma / NLLB theo cấu hình
        return self._providers.get("mock", MockTranslationProvider())
