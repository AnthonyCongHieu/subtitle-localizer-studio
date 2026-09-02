from __future__ import annotations

from typing import List

from subtitle_localizer.domain.models import ModelDescriptorV1, SubtitleCueV1
from subtitle_localizer.translation.base import TranslationProvider


class MockTranslationProvider(TranslationProvider):
    """Provider dịch giả lập phục vụ unit testing và tích hợp không cần mạng/GPU."""

    def __init__(self) -> None:
        self.is_loaded = False
        self._dict = {
            "你好世界": "Xin chào thế giới",
            "这是一个中文字幕测试": "Đây là bài kiểm tra phụ đề tiếng Trung",
            "你好，欢迎使用 Subtitle Localizer": "Xin chào, chào mừng bạn đến với Subtitle Localizer",
            "これは日本語の字幕テストです": "Đây là bài kiểm tra phụ đề tiếng Nhật",
            "こんにちは、世界": "Xin chào thế giới (tiếng Nhật)",
            "이것은 한국어 자막 테스트입니다": "Đây là bài kiểm tra phụ đề tiếng Hàn",
            "안녕하세요": "Xin chào (tiếng Hàn)",
            "This is an English test": "Đây là bài kiểm tra tiếng Anh",
            "Hello world and welcome": "Xin chào thế giới và chào mừng",
        }

    def get_descriptor(self) -> ModelDescriptorV1:
        return ModelDescriptorV1(
            id="mock-translator",
            source_url="https://github.com/subtitle-localizer/mock-translator",
            version_or_commit="v1.0.0",
            sha256="0" * 64,
            format="mock",
            license="MIT",
            languages=["zh", "ja", "ko", "en", "vi"],
            runtime="python",
        )

    def load(self) -> None:
        self.is_loaded = True

    def unload(self) -> None:
        self.is_loaded = False

    def translate_cues(
        self,
        cues: List[SubtitleCueV1],
        source_lang: str = "zh",
        target_lang: str = "vi",
    ) -> List[SubtitleCueV1]:
        lang_labels = {"zh": "Trung", "ja": "Nhat", "ko": "Han", "en": "Anh"}
        lang_label = lang_labels.get(source_lang, source_lang)
        for cue in cues:
            translated = self._dict.get(cue.source_text.strip())
            if not translated:
                # Fallback: dich mo phong voi nhan ngon ngu
                translated = f"[Ban dich {lang_label}->Viet]: {cue.source_text}"
            cue.translated_text = translated
        return cues
