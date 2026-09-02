from __future__ import annotations

from typing import Any, List

from subtitle_localizer.domain.models import ModelDescriptorV1, OcrObservationV1
from subtitle_localizer.ocr.base import OcrProvider


class MockOcrProvider(OcrProvider):
    """Provider giả lập phục vụ unit test và testing ngoại tuyến nhanh không cần tải weights."""

    def __init__(self) -> None:
        self.is_loaded = False
        self._sample_texts = {
            "zh": ["这是一个中文字幕测试", "你好，欢迎使用 Subtitle Localizer"],
            "ja": ["これは日本語の字幕テストです", "こんにちは、世界"],
            "ko": ["이것은 한국어 자막 테스트입니다", "안녕하세요"],
            "en": ["This is an English subtitle test", "Hello world and welcome"],
        }

    def get_descriptor(self) -> ModelDescriptorV1:
        return ModelDescriptorV1(
            id="mock-ocr",
            source_url="https://github.com/subtitle-localizer/mock-ocr",
            version_or_commit="v1.0.0",
            sha256="0" * 64,
            format="mock",
            license="MIT",
            languages=["zh", "ja", "ko", "en"],
            runtime="python",
        )

    def load(self) -> None:
        self.is_loaded = True

    def unload(self) -> None:
        self.is_loaded = False

    def recognize(
        self,
        crops: List[Any],
        pts_list: List[float],
        language: str = "zh",
    ) -> List[OcrObservationV1]:
        samples = self._sample_texts.get(language, self._sample_texts["en"])
        results: List[OcrObservationV1] = []

        for idx, pts in enumerate(pts_list):
            text = samples[idx % len(samples)]
            results.append(
                OcrObservationV1(
                    pts=pts,
                    boxes=[[0.1, 0.78, 0.9, 0.92]],
                    raw_text=text,
                    normalized_text=text.strip(),
                    confidence=0.96,
                    model_metadata={"provider": "mock-ocr", "language": language},
                )
            )

        return results
