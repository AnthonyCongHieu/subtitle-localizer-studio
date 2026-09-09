"""Cloud-based Subtitle Extraction Adapters:
- Google Gemini 2.5 Flash Video VLM
- CapCut / ByteDance Smart Bridge
"""

from subtitle_localizer.cloud.gemini_vlm import GeminiVideoVlmExtractor
from subtitle_localizer.cloud.capcut_bridge import CapCutBridgeExtractor

__all__ = [
    "GeminiVideoVlmExtractor",
    "CapCutBridgeExtractor",
]
