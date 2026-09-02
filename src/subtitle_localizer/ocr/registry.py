from __future__ import annotations

from typing import Dict, Optional

from subtitle_localizer.ocr.base import OcrProvider
from subtitle_localizer.ocr.mock import MockOcrProvider
from subtitle_localizer.ocr.paddle import PaddleOcrAdapter


class OcrRegistry:
    """Registry quản lý tất cả OCR providers đã đăng ký trong hệ thống."""

    def __init__(self) -> None:
        self._providers: Dict[str, OcrProvider] = {}
        # Đăng ký sẵn mock và paddle adapters
        self.register("mock", MockOcrProvider())
        self.register("paddle-zh", PaddleOcrAdapter(model_version="v6", language="ch"))
        self.register("paddle-ja", PaddleOcrAdapter(model_version="v6", language="japan"))
        self.register("paddle-ko", PaddleOcrAdapter(model_version="v5", language="korean"))
        self.register("paddle-en", PaddleOcrAdapter(model_version="v6", language="en"))

    def register(self, name: str, provider: OcrProvider) -> None:
        self._providers[name] = provider

    def get_provider(self, name: str) -> Optional[OcrProvider]:
        return self._providers.get(name)

    def get_provider_for_language(self, language: str) -> OcrProvider:
        mapping = {
            "zh": "paddle-zh",
            "ja": "paddle-ja",
            "ko": "paddle-ko",
            "en": "paddle-en",
        }
        provider_name = mapping.get(language, "mock")
        return self._providers.get(provider_name, self._providers.get("mock", MockOcrProvider()))
