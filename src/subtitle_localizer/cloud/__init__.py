"""Cloud-based Subtitle Extraction Adapters:
- Google Gemini 2.5 Flash Video VLM
- CapCut / ByteDance Smart Bridge
- Groq Cloud Whisper Large-v3 LPU
"""

from subtitle_localizer.cloud.gemini_vlm import GeminiVideoVlmExtractor
from subtitle_localizer.cloud.capcut_bridge import CapCutBridgeExtractor
from subtitle_localizer.cloud.groq_whisper import GroqWhisperExtractor

__all__ = [
    "GeminiVideoVlmExtractor",
    "CapCutBridgeExtractor",
    "GroqWhisperExtractor",
]
