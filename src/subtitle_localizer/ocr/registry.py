from __future__ import annotations

from typing import Dict, Optional

from subtitle_localizer.ocr.base import OcrProvider
from subtitle_localizer.ocr.mock import MockOcrProvider
from subtitle_localizer.ocr.paddle import PaddleOcrAdapter
from subtitle_localizer.ocr.rapid import RapidOcrProvider


class OcrRegistry:
    """Registry quản lý tất cả OCR providers đã đăng ký trong hệ thống."""

    def __init__(self) -> None:
        self._providers: Dict[str, OcrProvider] = {}
        # Đăng ký sẵn mock, rapidocr và paddle adapters
        self.register("mock", MockOcrProvider())
        self.register("rapidocr", RapidOcrProvider())
        self.register("paddle-zh", PaddleOcrAdapter(model_version="v6", language="ch"))
        self.register("paddle-ja", PaddleOcrAdapter(model_version="v6", language="japan"))
        self.register("paddle-ko", PaddleOcrAdapter(model_version="v5", language="korean"))
        self.register("paddle-en", PaddleOcrAdapter(model_version="v6", language="en"))

    def register(self, name: str, provider: OcrProvider) -> None:
        self._providers[name] = provider

    def get_provider(self, name: str) -> Optional[OcrProvider]:
        return self._providers.get(name)

    def get_provider_for_language(self, language: str) -> OcrProvider:
        provider = self._providers.get("rapidocr")
        if provider is None:
            raise RuntimeError("No production OCR provider is registered")
        return provider
