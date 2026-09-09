from __future__ import annotations

from typing import Dict, Optional

from subtitle_localizer.ocr.base import OcrProvider
from subtitle_localizer.ocr.paddle import PaddleOcrAdapter
from subtitle_localizer.ocr.rapid import RapidOcrProvider


class OcrRegistry:
    """Registry quản lý tất cả OCR providers đã đăng ký trong hệ thống."""

    def __init__(self) -> None:
        self._providers: Dict[str, OcrProvider] = {}
        # Đăng ký sẵn rapidocr và paddle adapters thực tế
        self.register("rapidocr", RapidOcrProvider())
        self.register("paddle-zh", PaddleOcrAdapter(model_version="v5-mobile", language="ch"))
        self.register("paddle-ja", PaddleOcrAdapter(model_version="v5-mobile", language="japan"))
        self.register("paddle-ko", PaddleOcrAdapter(model_version="v5", language="korean"))
        self.register("paddle-en", PaddleOcrAdapter(model_version="v5-mobile", language="en"))

    def register(self, name: str, provider: OcrProvider) -> None:
        self._providers[name] = provider

    def get_provider(self, name: str) -> Optional[OcrProvider]:
        return self._providers.get(name)

    def get_provider_for_language(self, language: str, preferred: str = "rapidocr") -> OcrProvider:
        normalized = (language or "zh").lower()
        key = preferred if preferred in self._providers else None
        if key is None and preferred == "paddle":
            key = f"paddle-{normalized}" if f"paddle-{normalized}" in self._providers else "paddle-zh"
        provider = self._providers.get(key or "rapidocr")
        if provider is None:
            raise RuntimeError("No production OCR provider is registered")
        return provider

    def get_fallback_for_language(self, language: str, preferred: str = "rapidocr") -> OcrProvider:
        provider = self.get_provider_for_language(language, preferred=preferred)
        if provider is None:
            raise RuntimeError("No RapidOCR fallback provider is registered")
        return provider
