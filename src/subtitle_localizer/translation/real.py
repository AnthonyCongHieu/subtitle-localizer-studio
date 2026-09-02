from __future__ import annotations

from typing import Dict, List

from subtitle_localizer.domain.models import ModelDescriptorV1, SubtitleCueV1
from subtitle_localizer.translation.base import TranslationProvider


class RealTranslationProvider(TranslationProvider):
    """Provider dịch thuật trực tiếp sử dụng Google Translator (qua deep-translator)."""

    def __init__(self) -> None:
        self.is_loaded = False
        self._cache: Dict[str, str] = {}

    def get_descriptor(self) -> ModelDescriptorV1:
        return ModelDescriptorV1(
            id="google-translator-real",
            source_url="https://pypi.org/project/deep-translator/",
            version_or_commit="v1.9.1",
            sha256="0" * 64,
            format="api",
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
        if not cues:
            return cues

        try:
            from deep_translator import GoogleTranslator
        except ImportError as error:
            raise RuntimeError("deep-translator is not installed") from error

        src = "zh-CN" if source_lang == "zh" else source_lang
        tgt = "vi" if target_lang == "vi" else target_lang
        translator = GoogleTranslator(source=src, target=tgt)

        for cue in cues:
            text = cue.source_text.strip()
            if not text:
                continue

            if text in self._cache:
                cue.translated_text = self._cache[text]
                continue

            try:
                translated = translator.translate(text)
            except Exception as error:
                raise RuntimeError(f"Translation failed: {error}") from error
            if not translated or not translated.strip():
                raise RuntimeError("Translation provider returned empty text")
            self._cache[text] = translated
            cue.translated_text = translated

        return cues
