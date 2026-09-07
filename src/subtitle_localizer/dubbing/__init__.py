"""Dubbing package for neural voiceover and audio synthesis."""

from subtitle_localizer.dubbing.tts import (
    AVAILABLE_VOICES,
    calculate_slot_stretch,
    clean_subtitle_text,
    generate_timed_voiceover,
    generate_voiceover_sync,
    mix_voiceover_audio_only,
    mix_voiceover_into_video,
    synthesize_text,
    time_stretch_pcm,
)

__all__ = [
    "AVAILABLE_VOICES",
    "synthesize_text",
    "generate_timed_voiceover",
    "generate_voiceover_sync",
    "mix_voiceover_into_video",
    "mix_voiceover_audio_only",
    "clean_subtitle_text",
    "calculate_slot_stretch",
    "time_stretch_pcm",
]

