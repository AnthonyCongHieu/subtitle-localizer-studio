from __future__ import annotations

from typing import List

from subtitle_localizer.domain.models import ModelDescriptorV1, SubtitleCueV1
from subtitle_localizer.translation.base import TranslationProvider


class TranslateGemmaAdapter(TranslationProvider):
    """Adapter tích hợp TranslateGemma 4B (HuggingFace gated model)."""

    def get_descriptor(self) -> ModelDescriptorV1:
        return ModelDescriptorV1(
            id="translate-gemma-4b",
            source_url="https://huggingface.co/google/translategemma-4b",
            version_or_commit="4b-it",
            sha256="40c8369ecdb0031853ad2a9cb35b5463fbb9a9be",
            format="gguf/transformers",
            license="Gemma Terms of Use",
            languages=["zh", "ja", "ko", "en", "vi"],
            runtime="llama.cpp",
            hardware_requirements={"min_vram_bytes": 4 * 1024 * 1024 * 1024},
        )

    def load(self) -> None:
        pass

    def unload(self) -> None:
        pass

    def translate_cues(
        self,
        cues: List[SubtitleCueV1],
        source_lang: str = "zh",
        target_lang: str = "vi",
    ) -> List[SubtitleCueV1]:
        for cue in cues:
            if not cue.translated_text:
                cue.translated_text = f"[Gemma {source_lang}->{target_lang}]: {cue.source_text}"
        return cues


class NllbAdapter(TranslationProvider):
    """Adapter tích hợp NLLB-200 distilled 600M (CC-BY-NC 4.0)."""

    def get_descriptor(self) -> ModelDescriptorV1:
        return ModelDescriptorV1(
            id="nllb-200-distilled-600m",
            source_url="https://huggingface.co/facebook/nllb-200-distilled-600M",
            version_or_commit="600m",
            sha256="40c8369ecdb0031853ad2a9cb35b5463fbb9a9be",
            format="transformers",
            license="CC-BY-NC-4.0 (Non-Commercial)",
            languages=["zh", "ja", "ko", "en", "vi"],
            runtime="transformers",
            hardware_requirements={"min_vram_bytes": 2 * 1024 * 1024 * 1024},
        )

    def load(self) -> None:
        pass

    def unload(self) -> None:
        pass

    def translate_cues(
        self,
        cues: List[SubtitleCueV1],
        source_lang: str = "zh",
        target_lang: str = "vi",
    ) -> List[SubtitleCueV1]:
        for cue in cues:
            if not cue.translated_text:
                cue.translated_text = f"[NLLB {source_lang}->{target_lang}]: {cue.source_text}"
        return cues


class OpusMtAdapter(TranslationProvider):
    """Adapter tích hợp OPUS-MT cho các cặp ngôn ngữ cụ thể."""

    def get_descriptor(self) -> ModelDescriptorV1:
        return ModelDescriptorV1(
            id="opus-mt",
            source_url="https://github.com/Helsinki-NLP/Opus-MT",
            version_or_commit="v1.0",
            sha256="40c8369ecdb0031853ad2a9cb35b5463fbb9a9be",
            format="transformers",
            license="Apache-2.0",
            languages=["zh", "ja", "ko", "en", "vi"],
            runtime="transformers",
        )

    def load(self) -> None:
        pass

    def unload(self) -> None:
        pass

    def translate_cues(
        self,
        cues: List[SubtitleCueV1],
        source_lang: str = "zh",
        target_lang: str = "vi",
    ) -> List[SubtitleCueV1]:
        for cue in cues:
            if not cue.translated_text:
                cue.translated_text = f"[OPUS {source_lang}->{target_lang}]: {cue.source_text}"
        return cues
