from __future__ import annotations

import asyncio
import logging
import os
import random
import re
import subprocess
import tempfile
import unicodedata
import weakref
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.reconstruction.builder import normalize_sequential_cues
from subtitle_localizer.dubbing.capcut_tts import (
    CAPCUT_VOICE_CATALOG,
    CapCutTTSClient,
    _RESOURCE_ID_MAP,
)
from subtitle_localizer.dubbing.gemini_tts import GEMINI_VOICE_CATALOG, GeminiTTSClient

logger = logging.getLogger(__name__)

EDGE_VOICE_CATALOG: List[Dict[str, Any]] = [
    # --- 🇻🇳 TIẾNG VIỆT ---
    {
        "voice_id": "vi-VN-NamMinhNeural",
        "display_name": "Nam Minh (Truyền cảm)",
        "lang": "vi",
        "gender": "male",
        "description": "Giọng nam trầm ấm, phát âm chuẩn đài tiếng nói, phù hợp phim kịch tính và truyện ngắn.",
        "tags": ["Nam truyền cảm", "Chuẩn đài", "Kịch tính"],
    },
    {
        "voice_id": "vi-VN-HoaiMyNeural",
        "display_name": "Hoài My (Dịu dàng)",
        "lang": "vi",
        "gender": "female",
        "description": "Giọng nữ trong trẻo, nhẹ nhàng, tự nhiên, phù hợp vlog đời sống, tâm lý và ẩm thực.",
        "tags": ["Nữ dịu dàng", "Đời sống", "Tâm lý"],
    },

    # --- 🇬🇧 ENGLISH (US, UK, AU, CA, IN) ---
    {
        "voice_id": "en-US-JennyNeural",
        "display_name": "Jenny (US Female Expressive)",
        "lang": "en",
        "gender": "female",
        "description": "Standard American female voice with lifelike conversational warmth and clarity.",
        "tags": ["American", "Conversational", "Warm"],
    },
    {
        "voice_id": "en-US-GuyNeural",
        "display_name": "Guy (US Male Professional)",
        "lang": "en",
        "gender": "male",
        "description": "Professional American male broadcast voice for news, explainers and recaps.",
        "tags": ["American", "News", "Professional"],
    },
    {
        "voice_id": "en-US-AriaNeural",
        "display_name": "Aria (US Female Dynamic)",
        "lang": "en",
        "gender": "female",
        "description": "Dynamic, clear American female narrator suited for energetic storytelling.",
        "tags": ["Dynamic", "Narrator", "Clear"],
    },
    {
        "voice_id": "en-US-ChristopherNeural",
        "display_name": "Christopher (US Male Deep)",
        "lang": "en",
        "gender": "male",
        "description": "Deep and soothing American male storytelling voice.",
        "tags": ["Deep", "Storytelling", "Soothing"],
    },
    {
        "voice_id": "en-US-EricNeural",
        "display_name": "Eric (US Male Youth)",
        "lang": "en",
        "gender": "male",
        "description": "Upbeat and friendly young American male voice.",
        "tags": ["American", "Young", "Friendly"],
    },
    {
        "voice_id": "en-US-MichelleNeural",
        "display_name": "Michelle (US Female Crisp)",
        "lang": "en",
        "gender": "female",
        "description": "Crisp and clear conversational American female voice.",
        "tags": ["American", "Crisp", "Conversational"],
    },
    {
        "voice_id": "en-US-RogerNeural",
        "display_name": "Roger (US Male Story)",
        "lang": "en",
        "gender": "male",
        "description": "Warm and mature American male narrator voice.",
        "tags": ["American", "Narrator", "Mature"],
    },
    {
        "voice_id": "en-US-SteffanNeural",
        "display_name": "Steffan (US Male Casual)",
        "lang": "en",
        "gender": "male",
        "description": "Casual, natural everyday American male voice.",
        "tags": ["American", "Casual", "Natural"],
    },
    {
        "voice_id": "en-US-AvaNeural",
        "display_name": "Ava (US Female Bright)",
        "lang": "en",
        "gender": "female",
        "description": "Bright, expressive modern American female voice.",
        "tags": ["American", "Bright", "Modern"],
    },
    {
        "voice_id": "en-US-AndrewNeural",
        "display_name": "Andrew (US Male Warm)",
        "lang": "en",
        "gender": "male",
        "description": "Warm, trustworthy American male conversational voice.",
        "tags": ["American", "Trustworthy", "Warm"],
    },
    {
        "voice_id": "en-US-EmmaNeural",
        "display_name": "Emma (US Female Gentle)",
        "lang": "en",
        "gender": "female",
        "description": "Gentle and articulate American female narrator.",
        "tags": ["American", "Gentle", "Articulate"],
    },
    {
        "voice_id": "en-US-BrianNeural",
        "display_name": "Brian (US Male News)",
        "lang": "en",
        "gender": "male",
        "description": "Confident and authoritative newsreader voice.",
        "tags": ["American", "Confident", "News"],
    },
    {
        "voice_id": "en-GB-RyanNeural",
        "display_name": "Ryan (British Male Classic)",
        "lang": "en",
        "gender": "male",
        "description": "Classic British English male voice for documentary and literature.",
        "tags": ["British", "Classic", "Documentary"],
    },
    {
        "voice_id": "en-GB-SoniaNeural",
        "display_name": "Sonia (British Female Elegant)",
        "lang": "en",
        "gender": "female",
        "description": "Elegant and articulate British female voice.",
        "tags": ["British", "Elegant", "Articulate"],
    },
    {
        "voice_id": "en-GB-LibbyNeural",
        "display_name": "Libby (British Female Crisp)",
        "lang": "en",
        "gender": "female",
        "description": "Crisp and friendly British storytelling voice.",
        "tags": ["British", "Crisp", "Storytelling"],
    },
    {
        "voice_id": "en-GB-ThomasNeural",
        "display_name": "Thomas (British Male Polite)",
        "lang": "en",
        "gender": "male",
        "description": "Polite and calm British English narrator.",
        "tags": ["British", "Calm", "Polite"],
    },
    {
        "voice_id": "en-GB-MaisieNeural",
        "display_name": "Maisie (British Female Cheerful)",
        "lang": "en",
        "gender": "female",
        "description": "Cheerful and energetic British young female voice.",
        "tags": ["British", "Cheerful", "Young"],
    },
    {
        "voice_id": "en-AU-NatashaNeural",
        "display_name": "Natasha (Australian Female)",
        "lang": "en",
        "gender": "female",
        "description": "Natural and friendly Australian female voice.",
        "tags": ["Australian", "Natural", "Friendly"],
    },
    {
        "voice_id": "en-AU-WilliamMultilingualNeural",
        "display_name": "William (Australian Male)",
        "lang": "en",
        "gender": "male",
        "description": "Warm Australian English male voice.",
        "tags": ["Australian", "Warm", "Narrator"],
    },
    {
        "voice_id": "en-CA-ClaraNeural",
        "display_name": "Clara (Canadian Female)",
        "lang": "en",
        "gender": "female",
        "description": "Clear Canadian English female voice.",
        "tags": ["Canadian", "Clear", "Friendly"],
    },
    {
        "voice_id": "en-CA-LiamNeural",
        "display_name": "Liam (Canadian Male)",
        "lang": "en",
        "gender": "male",
        "description": "Natural Canadian English male voice.",
        "tags": ["Canadian", "Natural", "Narrator"],
    },
    {
        "voice_id": "en-IN-NeerjaNeural",
        "display_name": "Neerja (Indian English Female)",
        "lang": "en",
        "gender": "female",
        "description": "Standard Indian English female broadcast voice.",
        "tags": ["Indian", "Broadcast", "Female"],
    },
    {
        "voice_id": "en-IN-PrabhatNeural",
        "display_name": "Prabhat (Indian English Male)",
        "lang": "en",
        "gender": "male",
        "description": "Clear Indian English male narrator.",
        "tags": ["Indian", "Clear", "Male"],
    },

    # --- 🇨🇳 TRUNG QUỐC (MANDARIN, TAIWAN, CANTONESE) ---
    {
        "voice_id": "zh-CN-XiaoxiaoNeural",
        "display_name": "Hiểu Hiểu (Xiaoxiao - Nữ truyền cảm)",
        "lang": "zh",
        "gender": "female",
        "description": "Giọng nữ phổ thông Trung Quốc nổi tiếng nhất, cực kỳ truyền cảm cho kể chuyện.",
        "tags": ["Tiếng Trung", "Nữ truyền cảm", "Audiobook"],
    },
    {
        "voice_id": "zh-CN-YunxiNeural",
        "display_name": "Vân Hi (Yunxi - Nam drama kịch tính)",
        "lang": "zh",
        "gender": "male",
        "description": "Giọng nam thanh niên sống động, biểu cảm cao, thích hợp phim ngắn và drama.",
        "tags": ["Tiếng Trung", "Nam thanh niên", "Drama"],
    },
    {
        "voice_id": "zh-CN-YunjianNeural",
        "display_name": "Vân Kiện (Yunjian - Nam điện ảnh)",
        "lang": "zh",
        "gender": "male",
        "description": "Giọng nam trầm ấm, hùng tráng, hoàn hảo cho trailer phim điện ảnh và tài liệu lịch sử.",
        "tags": ["Tiếng Trung", "Nam trầm", "Điện ảnh"],
    },
    {
        "voice_id": "zh-CN-YunyangNeural",
        "display_name": "Vân Dương (Yunyang - Nam thời sự)",
        "lang": "zh",
        "gender": "male",
        "description": "Giọng nam phát thanh viên chuyên nghiệp, nghiêm túc và mạch lạc.",
        "tags": ["Tiếng Trung", "Phát thanh", "Thời sự"],
    },
    {
        "voice_id": "zh-CN-XiaoyiNeural",
        "display_name": "Hiểu Y (Xiaoyi - Nữ dịu dàng)",
        "lang": "zh",
        "gender": "female",
        "description": "Giọng nữ trẻ trung, trong sáng, phù hợp vlog và tóm tắt truyện tình cảm.",
        "tags": ["Tiếng Trung", "Nữ trong sáng", "Tình cảm"],
    },
    {
        "voice_id": "zh-CN-liaoning-XiaobeiNeural",
        "display_name": "Hiểu Bắc (Xiaobei - Hài hước Đông Bắc)",
        "lang": "zh",
        "gender": "female",
        "description": "Giọng nữ giọng địa phương Đông Bắc Trung Quốc hài hước, dí dỏm.",
        "tags": ["Đông Bắc", "Hài hước", "Độc lạ"],
    },
    {
        "voice_id": "zh-CN-shaanxi-XiaoniNeural",
        "display_name": "Hiểu Ni (Xiaoni - Thiểm Tây)",
        "lang": "zh",
        "gender": "female",
        "description": "Giọng nữ âm sắc Thiểm Tây đặc sắc cho các bộ phim bối cảnh cổ phong / nông thôn.",
        "tags": ["Thiểm Tây", "Cổ phong", "Dân dã"],
    },
    {
        "voice_id": "zh-TW-HsiaoChenNeural",
        "display_name": "Hiểu Chân (HsiaoChen - Đài Loan Nữ)",
        "lang": "zh",
        "gender": "female",
        "description": "Giọng nữ Đài Loan ngọt ngào, phát âm chuẩn phồn thể.",
        "tags": ["Đài Loan", "Ngọt ngào", "Phim thần tượng"],
    },
    {
        "voice_id": "zh-TW-YunJheNeural",
        "display_name": "Vân Triết (YunJhe - Đài Loan Nam)",
        "lang": "zh",
        "gender": "male",
        "description": "Giọng nam Đài Loan ấm áp, phong thái soái ca phim ngôn tình.",
        "tags": ["Đài Loan", "Nam soái ca", "Ngôn tình"],
    },
    {
        "voice_id": "zh-HK-HiuMaanNeural",
        "display_name": "Hiểu Mạn (HiuMaan - Quảng Đông Nữ)",
        "lang": "zh",
        "gender": "female",
        "description": "Giọng nữ tiếng Quảng Đông (Hồng Kông / TVB) thanh lịch, tự nhiên.",
        "tags": ["Hồng Kông", "Tiếng Quảng", "TVB"],
    },
    {
        "voice_id": "zh-HK-WanLungNeural",
        "display_name": "Vân Long (WanLung - Quảng Đông Nam)",
        "lang": "zh",
        "gender": "male",
        "description": "Giọng nam tiếng Quảng Đông chuẩn Hồng Kông kinh điển cho phim TVB kiếm hiệp.",
        "tags": ["Hồng Kông", "Tiếng Quảng", "Kiếm hiệp"],
    },

    # --- 🇯🇵 NHẬT BẢN ---
    {
        "voice_id": "ja-JP-NanamiNeural",
        "display_name": "Nanami (Nữ Anime Tươi Sáng)",
        "lang": "ja",
        "gender": "female",
        "description": "Giọng nữ tiếng Nhật trong trẻo, dễ thương, chuẩn phong cách anime Nhật Bản.",
        "tags": ["Tiếng Nhật", "Anime", "Dễ thương"],
    },
    {
        "voice_id": "ja-JP-KeitaNeural",
        "display_name": "Keita (Nam Thanh Niên Nhật)",
        "lang": "ja",
        "gender": "male",
        "description": "Giọng nam tiếng Nhật trẻ trung, tự nhiên, thích hợp manga recap và phim điện ảnh.",
        "tags": ["Tiếng Nhật", "Nam trẻ trung", "Manga"],
    },

    # --- 🇰🇷 HÀN QUỐC ---
    {
        "voice_id": "ko-KR-SunHiNeural",
        "display_name": "SunHi (Nữ K-Drama Tình Cảm)",
        "lang": "ko",
        "gender": "female",
        "description": "Giọng nữ tiếng Hàn dịu dàng, sâu lắng, chuẩn diễn viên phim truyền hình Hàn Quốc.",
        "tags": ["Tiếng Hàn", "K-Drama", "Tình cảm"],
    },
    {
        "voice_id": "ko-KR-InJoonNeural",
        "display_name": "InJoon (Nam K-Drama Trầm Ấm)",
        "lang": "ko",
        "gender": "male",
        "description": "Giọng nam tiếng Hàn lịch thiệp, ấm áp, thích hợp thuyết minh phim tình cảm K-Drama.",
        "tags": ["Tiếng Hàn", "Lãng mạn", "Trầm ấm"],
    },
    {
        "voice_id": "ko-KR-HyunsuMultilingualNeural",
        "display_name": "Hyunsu (Nam Hàn Đa Ngữ)",
        "lang": "ko",
        "gender": "male",
        "description": "Giọng nam tiếng Hàn hiện đại, phát âm sắc nét và tự nhiên.",
        "tags": ["Tiếng Hàn", "Hiện đại", "Tự nhiên"],
    },

    # --- 🇫🇷 PHÁP & 🇩🇪 ĐỨC & 🇪🇸 TÂY BAN NHA ---
    {
        "voice_id": "fr-FR-DeniseNeural",
        "display_name": "Denise (French Female)",
        "lang": "fr",
        "gender": "female",
        "description": "Elegant Parisian French female voice.",
        "tags": ["French", "Elegant", "Paris"],
    },
    {
        "voice_id": "fr-FR-HenriNeural",
        "display_name": "Henri (French Male)",
        "lang": "fr",
        "gender": "male",
        "description": "Warm, articulate French male voice.",
        "tags": ["French", "Warm", "Narrator"],
    },
    {
        "voice_id": "de-DE-KatjaNeural",
        "display_name": "Katja (German Female)",
        "lang": "de",
        "gender": "female",
        "description": "Clear and professional German female broadcast voice.",
        "tags": ["German", "Professional", "Clear"],
    },
    {
        "voice_id": "de-DE-ConradNeural",
        "display_name": "Conrad (German Male)",
        "lang": "de",
        "gender": "male",
        "description": "Authoritative German male storytelling voice.",
        "tags": ["German", "Authoritative", "Narrator"],
    },
    {
        "voice_id": "es-ES-ElviraNeural",
        "display_name": "Elvira (Spanish Female)",
        "lang": "es",
        "gender": "female",
        "description": "Expressive European Spanish female voice.",
        "tags": ["Spanish", "Expressive", "European"],
    },
    {
        "voice_id": "es-ES-AlvaroNeural",
        "display_name": "Alvaro (Spanish Male)",
        "lang": "es",
        "gender": "male",
        "description": "Warm Spanish male storytelling voice.",
        "tags": ["Spanish", "Warm", "Narrator"],
    },
    {
        "voice_id": "th-TH-PremwadeeNeural",
        "display_name": "Premwadee (Thai Female)",
        "lang": "th",
        "gender": "female",
        "description": "Gentle and melodious Thai female voice.",
        "tags": ["Thai", "Melodious", "Female"],
    },
    {
        "voice_id": "th-TH-NiwatNeural",
        "display_name": "Niwat (Thai Male)",
        "lang": "th",
        "gender": "male",
        "description": "Calm and natural Thai male narrator.",
        "tags": ["Thai", "Calm", "Male"],
    },
    {
        "voice_id": "id-ID-GadisNeural",
        "display_name": "Gadis (Indonesian Female)",
        "lang": "id",
        "gender": "female",
        "description": "Clear and natural Indonesian female voice.",
        "tags": ["Indonesian", "Natural", "Female"],
    },
    {
        "voice_id": "id-ID-ArdiNeural",
        "display_name": "Ardi (Indonesian Male)",
        "lang": "id",
        "gender": "male",
        "description": "Friendly Indonesian male narrator.",
        "tags": ["Indonesian", "Friendly", "Male"],
    },
]

TTS_CATALOG: Dict[str, List[Dict[str, Any]]] = {
    "edge": EDGE_VOICE_CATALOG,
    "capcut": CAPCUT_VOICE_CATALOG,
    "gemini": GEMINI_VOICE_CATALOG,
}


def get_tts_catalog() -> Dict[str, List[Dict[str, Any]]]:
    """Trả về danh mục giọng đọc đầy đủ của toàn bộ các Provider trong Studio."""
    return TTS_CATALOG


AVAILABLE_VOICES: Dict[str, str] = {
    "nam": "vi-VN-NamMinhNeural",
    "nu": "vi-VN-HoaiMyNeural",
    "nam_mien_bac": "vi-VN-NamMinhNeural",
    "nu_mien_bac": "vi-VN-HoaiMyNeural",
    "nam_mien_nam": "vi-VN-NamMinhNeural",
    "nu_mien_nam": "vi-VN-HoaiMyNeural",
    "male": "vi-VN-NamMinhNeural",
    "female": "vi-VN-HoaiMyNeural",
    "vi-VN-NamMinhNeural": "vi-VN-NamMinhNeural",
    "vi-VN-HoaiMyNeural": "vi-VN-HoaiMyNeural",
    "default": "vi-VN-NamMinhNeural",
}


_GEMINI_VOICE_IDS: set[str] = {v["voice_id"] for v in GEMINI_VOICE_CATALOG if "voice_id" in v}
_GEMINI_VOICE_IDS_LOWER: set[str] = {v.lower() for v in _GEMINI_VOICE_IDS}
_GEMINI_KNOWN_PERSONAS: set[str] = {
    "puck", "kore", "zephyr", "fenrir", "aoede", "sulafat", "charon", "enceladus",
    "leda", "orus", "despina", "algenib", "callirrhoe", "eurydice", "hermes",
    "jupiter", "ganymede", "triton", "proteus", "titan",
}

_CAPCUT_VOICE_IDS: set[str] = {v["voice_id"] for v in CAPCUT_VOICE_CATALOG if "voice_id" in v}
_CAPCUT_VOICE_IDS_LOWER: set[str] = {v.lower() for v in _CAPCUT_VOICE_IDS}

_EDGE_VOICE_IDS: set[str] = {v["voice_id"] for v in EDGE_VOICE_CATALOG if "voice_id" in v}
_EDGE_VOICE_IDS_LOWER: set[str] = {v.lower() for v in _EDGE_VOICE_IDS}

_CAPCUT_PREFIXES = (
    "BV", "vi_female_huong", "ICL_", "DiT_", "en_us_", "zh_",
    "en_male_", "en_female_", "multi_", "id_"
)
_CAPCUT_SUBSTRINGS = (
    "_uranus_", "_bigtts", "_streaming", "_dsp", "_mars_",
    "_moon_", "_wvae_"
)


def is_gemini_voice(voice: Optional[str]) -> bool:
    """Kiểm tra xem mã giọng có thuộc danh mục Google Gemini AI Speech hay không."""
    if not voice:
        return False
    v = voice.strip()
    return (
        v in _GEMINI_VOICE_IDS
        or v.lower() in _GEMINI_VOICE_IDS_LOWER
        or v.lower() in _GEMINI_KNOWN_PERSONAS
    )


def is_capcut_voice(voice: Optional[str]) -> bool:
    """Kiểm tra xem mã giọng có thuộc danh mục ByteDance / CapCut TTS hay không."""
    if not voice:
        return False
    v = voice.strip()
    if (
        v in _RESOURCE_ID_MAP
        or v in _CAPCUT_VOICE_IDS
        or v.lower() in _CAPCUT_VOICE_IDS_LOWER
        or v in ("th", "en")
    ):
        return True
    lower = v.lower()
    if any(sub in lower for sub in _CAPCUT_SUBSTRINGS):
        return True
    if any(v.startswith(pfx) for pfx in _CAPCUT_PREFIXES):
        return True
    return False


def is_edge_voice(voice: Optional[str]) -> bool:
    """Kiểm tra xem mã giọng có thuộc danh mục Microsoft Edge Neural TTS hay không."""
    if not voice:
        return False
    v = voice.strip()
    if v in _EDGE_VOICE_IDS or v.lower() in _EDGE_VOICE_IDS_LOWER or v in AVAILABLE_VOICES:
        return True
    if "-" in v and "neural" in v.lower():
        return True
    return False


def resolve_tts_provider(voice: Optional[str], preferred_provider: Optional[str] = None) -> str:
    """Ưu tiên provider được cấu hình; chỉ suy luận từ voice khi chưa chỉ định."""
    pref = (preferred_provider or "").strip().lower()
    if pref in ("capcut", "gemini", "edge"):
        return pref

    v = (voice or "").strip()
    if is_gemini_voice(v):
        return "gemini"
    if is_capcut_voice(v):
        return "capcut"
    return "edge"


def detect_voice_provider(voice: Optional[str]) -> str:
    """Tự động nhận diện TTS Provider (capcut, gemini, edge) từ tên mã giọng đọc."""
    return resolve_tts_provider(voice, preferred_provider=None)


def clean_subtitle_text(text: str) -> str:
    """
    Làm sạch phụ đề thoại:
    - Loại bỏ các chú thích âm thanh, nhạc nền trong ngoặc đơn/ngoặc vuông: (Nhạc), [Tiếng súng], （音乐）, 【Nhạc dạo】
    - Loại bỏ các hành động trong dấu sao: *cười lớn*, *hành động*, *thở dài*
    - Loại bỏ các ký hiệu nốt nhạc: ♪, ♫, ♬, ♩, ♭, ♮, ♯, §
    - Loại bỏ các dòng chỉ có dấu câu hoặc ký tự rác: ..., ——, !!!, ~~~
    - Giữ nguyên số học (1.500.000), văn bản tiếng Việt, Trung, Anh, Nhật, Hàn.
    """
    if not text:
        return ""

    # 1. Loại bỏ âm thanh/chú thích trong các loại ngoặc tròn và ngoặc vuông (kể cả fullwidth Á Đông)
    s = re.sub(r"[\(\（\[【〔][^\)\）\]】〕]*[\)\）\]】〕]", " ", text)

    # 2. Loại bỏ hành động trong dấu sao: *cười*, *khóc*
    s = re.sub(r"\*[^*]+\*", " ", s)

    # 3. Loại bỏ ký hiệu nốt nhạc và ký tự tượng thanh
    s = re.sub(r"[♪♫♬♩♭♮♯§~∼]+", " ", s)

    # 4. Thu gọn khoảng trắng thừa
    s = re.sub(r"\s+", " ", s).strip()

    # 5. Dọn dẹp dấu câu mồ côi ở đầu câu sau khi cắt ngoặc (ví dụ: "(Nhạc) , hôm nay" -> "hôm nay")
    s = re.sub(r"^[\s,;:!\?\.\-]+", "", s).strip()

    # 6. Nếu sau khi làm sạch chỉ còn toàn dấu câu, dấu gạch, dấu chấm, dấu phẩy không chứa chữ/số thì trả về rỗng
    # Hỗ trợ chữ cái Latin/Việt, số, chữ Hán (CJK), Kana, Hangul
    if not re.search(r"[\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]", s):
        return ""

    return s



def _cjk_ratio_text(text: str) -> float:
    cleaned = "".join(ch for ch in (text or "") if not ch.isspace())
    if not cleaned:
        return 0.0
    cjk = sum(1 for ch in cleaned if "一" <= ch <= "鿿")
    return cjk / len(cleaned)


def resolve_tts_spoken_text(
    cue,
    *,
    prefer_translated: bool = True,
) -> str:
    """Pick TTS text that matches Vietnamese dubbing language.

    Ignores stale CJK/English spoken_text leftovers from earlier failed adapts.
    """
    style = cue.style if isinstance(getattr(cue, "style", None), dict) else {}
    translated = clean_subtitle_text(str(getattr(cue, "translated_text", "") or ""))
    source = clean_subtitle_text(str(getattr(cue, "source_text", "") or ""))
    spoken = clean_subtitle_text(str(style.get("spoken_text") or ""))

    def _usable_vi(text: str) -> bool:
        if not text:
            return False
        if _cjk_ratio_text(text) >= 0.3:
            return False
        return True

    if spoken and _usable_vi(spoken):
        return spoken
    if prefer_translated and _usable_vi(translated):
        return translated
    if _usable_vi(source):
        return source
    return translated or ""

def normalize_tts_text(text: str) -> str:
    """Làm sạch subtitle, chuẩn hóa Unicode và loại ký tự không hợp lệ trong XML 1.0."""
    cleaned = clean_subtitle_text(unicodedata.normalize("NFC", str(text or "")))
    return "".join(
        char
        for char in cleaned
        if char in "\t\n\r"
        or 0x20 <= ord(char) <= 0xD7FF
        or 0xE000 <= ord(char) <= 0xFFFD
        or 0x10000 <= ord(char) <= 0x10FFFF
    ).strip()


def calculate_slot_stretch(
    speech_duration: float,
    slot_duration: float,
    min_rate: float = 1.0,
    max_rate: float = 1.45,
) -> float:
    """
    Tính toán tốc độ co giãn tự động để khớp thời lượng cue.
    Nếu thời lượng phát âm vượt quá slot thời gian, tăng tốc độ đọc từ 1.0x đến max_rate (mặc định 1.45x).
    Nếu thời lượng phát âm đã nhỏ hơn hoặc bằng slot, giữ nguyên 1.0x để câu thoại tự nhiên.
    """
    if slot_duration <= 0.05 or speech_duration <= 0.05:
        return 1.0

    if speech_duration <= slot_duration:
        return 1.0

    ratio = speech_duration / slot_duration
    return round(float(np.clip(ratio, min_rate, max_rate)), 3)


def time_stretch_pcm(
    samples: np.ndarray,
    speed_factor: float,
    sample_rate: int = 44100,
) -> np.ndarray:
    """
    Co giãn thời gian âm thanh PCM bằng bộ lọc atempo của FFmpeg (giữ nguyên cao độ).
    speed_factor: hệ số tốc độ (1.00 -> 1.45).
    """
    if len(samples) == 0 or abs(speed_factor - 1.0) < 0.02:
        return samples

    speed = float(np.clip(speed_factor, 0.5, 2.0))

    clipped = np.clip(samples, -1.0, 1.0)
    int_samples = (clipped * 32767.0).astype(np.int16)
    raw_bytes = int_samples.tobytes()

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "s16le",
        "-ar",
        str(sample_rate),
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-filter:a",
        f"atempo={speed:.4f}",
        "-f",
        "s16le",
        "pipe:1",
    ]
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    out_bytes, _ = proc.communicate(input=raw_bytes)
    if not out_bytes:
        return samples

    res_int = np.frombuffer(out_bytes, dtype=np.int16)
    return res_int.astype(np.float32) / 32768.0


def available_voiceover_slot(cue: SubtitleCueV1, next_cue: SubtitleCueV1 | None, mode: str) -> float:
    """Return the stretch target for a cue.

    Single-voice narration uses the time until the next cue so CapCut's ~200ms
    end padding cannot spill into the following line.
    """
    slot = max(0.0, float(cue.end_pts) - float(cue.start_pts))
    if next_cue is None:
        return slot
    until_next = float(next_cue.start_pts) - float(cue.start_pts)
    if mode != "multi" and until_next > 0.05:
        return until_next
    return slot


def fade_trim_pcm(
    samples: np.ndarray,
    max_samples: int,
    fade_ms: float = 20.0,
    sample_rate: int = 44100,
) -> np.ndarray:
    """Clip PCM to max_samples and fade the tail to avoid a click."""
    if max_samples <= 0:
        return samples[:0]
    if len(samples) <= max_samples:
        return samples
    trimmed = np.array(samples[:max_samples], dtype=np.float32, copy=True)
    fade_samples = min(len(trimmed), int(sample_rate * max(0.0, fade_ms) / 1000.0))
    if fade_samples > 1:
        trimmed[-fade_samples:] *= np.linspace(1.0, 0.0, fade_samples, dtype=np.float32)
    return trimmed


def mix_voice_pcm(
    master: np.ndarray,
    pcm: np.ndarray,
    start_sample: int,
    *,
    mode: str = "single",
    next_start_sample: int | None = None,
    allow_overlap: bool | None = None,
) -> np.ndarray:
    """Place one cue onto the master buffer.

    Overlap/additive mix is allowed only when allow_overlap=True.
    If allow_overlap is None, legacy behavior is used: multi => overlap, single => trim.
    """
    if len(pcm) == 0:
        return master
    start_sample = max(0, int(start_sample))
    placed = np.asarray(pcm, dtype=np.float32)
    mode_n = normalize_dubbing_mode(mode)
    can_overlap = bool(allow_overlap) if allow_overlap is not None else (mode_n == "multi")
    if (not can_overlap) and next_start_sample is not None:
        placed = fade_trim_pcm(placed, max(0, int(next_start_sample) - start_sample))
        if len(placed) == 0:
            return master
    end_sample = start_sample + len(placed)
    if end_sample > len(master):
        master = np.pad(master, (0, end_sample - len(master)), mode="constant")
    master[start_sample:end_sample] += placed
    return master


# CapCut returns transient 1000/system-busy when parallel task creation is too
# aggressive. Keep its cloud queue single-flight; Edge/Gemini remain concurrent.
_PROVIDER_CONCURRENCY_LIMITS = {"edge": 1, "capcut": 1, "gemini": 4}
_PROVIDER_PACING_SECONDS = {"edge": 0.10, "capcut": 0.50, "gemini": 0.0}
_PROVIDER_SEMAPHORES: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, Dict[str, asyncio.Semaphore]]" = weakref.WeakKeyDictionary()


def _provider_semaphore(provider: str) -> asyncio.Semaphore:
    """Return the event-loop-local limiter for real calls to one TTS provider."""
    loop = asyncio.get_running_loop()
    semaphores = _PROVIDER_SEMAPHORES.get(loop)
    if semaphores is None:
        semaphores = {
            name: asyncio.Semaphore(limit)
            for name, limit in _PROVIDER_CONCURRENCY_LIMITS.items()
        }
        _PROVIDER_SEMAPHORES[loop] = semaphores
    return semaphores[provider]


async def _run_provider_call(provider: str, operation: Any) -> Any:
    """Run a provider operation under its global per-event-loop concurrency cap."""
    async with _provider_semaphore(provider):
        result = await operation()
        pacing = _PROVIDER_PACING_SECONDS[provider]
        if pacing > 0:
            await asyncio.sleep(pacing)
        return result


async def _synthesize_edge_tts(
    text: str,
    voice: str = "vi-VN-NamMinhNeural",
    rate: str = "+0%",
    max_retries: int = 3,
) -> bytes:
    """Sinh file âm thanh từ văn bản bằng Microsoft Edge Neural TTS."""
    import edge_tts

    clean_text = text.strip()
    if not clean_text:
        return b""

    actual_voice = AVAILABLE_VOICES.get(voice, voice)
    if actual_voice not in ("vi-VN-NamMinhNeural", "vi-VN-HoaiMyNeural") and not ("-" in actual_voice and "Neural" in actual_voice):
        actual_voice = "vi-VN-NamMinhNeural"

    attempts = max(1, int(max_retries))
    for attempt in range(attempts):
        try:
            communicate = edge_tts.Communicate(clean_text, actual_voice, rate=rate)
            audio_chunks = bytearray()
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio":
                    data = chunk.get("data", b"")
                    if not isinstance(data, (bytes, bytearray)):
                        raise RuntimeError("Edge-TTS trả về chunk âm thanh không hợp lệ")
                    audio_chunks.extend(data)

            if len(audio_chunks) > 0:
                return bytes(audio_chunks)
            raise RuntimeError("Edge-TTS trả về luồng âm thanh rỗng")
        except (ValueError, TypeError) as error:
            logger.warning(
                "Edge-TTS từ chối tham số voice=%s rate=%s: %s: %s",
                actual_voice, rate, type(error).__name__, error,
            )
            return b""
        except Exception as error:
            if attempt == attempts - 1:
                logger.warning(
                    "Edge-TTS thất bại sau %d lần (voice=%s, rate=%s, %s): %s",
                    attempts, actual_voice, rate, type(error).__name__, error,
                )
                return b""
            delay = (0.75 * (2 ** attempt)) + random.uniform(0.0, 0.35)
            await asyncio.sleep(delay)

    return b""


async def _synthesize_windows_sapi(text: str) -> bytes:
    """Generate local WAV/MP3 through Windows SAPI when cloud TTS is down."""
    import base64

    if os.name != "nt":
        return b""
    clean_text = normalize_tts_text(text)
    if not clean_text:
        return b""
    with tempfile.TemporaryDirectory(prefix="subtitle-sapi-") as temp_dir:
        root = Path(temp_dir)
        encoded_file = root / "text.b64"
        wav_file = root / "speech.wav"
        mp3_file = root / "speech.mp3"
        encoded_file.write_text(
            base64.b64encode(clean_text.encode("utf-8")).decode("ascii"),
            encoding="ascii",
        )
        script = (
            "$ErrorActionPreference='Stop';"
            "Add-Type -AssemblyName System.Speech;"
            "$b=[IO.File]::ReadAllText($args[0]);"
            "$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b));"
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
            "$s.SetOutputToWaveFile($args[1]);$s.Speak($t);$s.Dispose();"
        )
        try:
            result = await asyncio.to_thread(
                subprocess.run,
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script,
                 str(encoded_file), str(wav_file)],
                capture_output=True,
                timeout=45,
                check=False,
            )
            if result.returncode != 0 or not wav_file.exists() or wav_file.stat().st_size == 0:
                return b""
            result = await asyncio.to_thread(
                subprocess.run,
                ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(wav_file), str(mp3_file)],
                capture_output=True,
                timeout=45,
                check=False,
            )
            if result.returncode != 0 or not mp3_file.exists():
                return b""
            return mp3_file.read_bytes()
        except (OSError, subprocess.SubprocessError):
            return b""


def parse_speaking_rate(rate: str | float | None) -> float:
    """Chuyển '+30%', '-10%', '1.15' thành hệ số tốc độ đọc (0.5 -> 2.0)."""
    if rate is None:
        return 1.0
    if isinstance(rate, (int, float)):
        value = float(rate)
        if value <= 0:
            return 1.0
        if value <= 2.5:
            return max(0.5, min(2.0, value))
        return max(0.5, min(2.0, value / 100.0))
    raw = str(rate).strip().replace("%", "")
    if not raw:
        return 1.0
    try:
        if raw.startswith("+"):
            return max(0.5, min(2.0, 1.0 + float(raw[1:] or 0) / 100.0))
        if raw.startswith("-"):
            return max(0.5, min(2.0, 1.0 - float(raw[1:] or 0) / 100.0))
        value = float(raw)
        if value <= 0:
            return 1.0
        if value <= 2.5:
            return max(0.5, min(2.0, value))
        return max(0.5, min(2.0, value / 100.0))
    except ValueError:
        return 1.0


def apply_speaking_rate_to_audio(audio_data: bytes, rate: str | float | None, sample_rate: int = 44100) -> bytes:
    """Áp tốc độ đọc lên MP3 (dùng cho Gemini TTS không có tham số rate gốc)."""
    factor = parse_speaking_rate(rate)
    if not audio_data or abs(factor - 1.0) < 0.02:
        return audio_data
    pcm = _decode_mp3_to_pcm(audio_data, sample_rate=sample_rate)
    if len(pcm) == 0:
        return audio_data
    stretched = time_stretch_pcm(pcm, speed_factor=factor, sample_rate=sample_rate)
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as handle:
        temp_path = Path(handle.name)
    try:
        _encode_pcm_to_mp3(stretched, temp_path, sample_rate=sample_rate)
        encoded = temp_path.read_bytes()
        return encoded or audio_data
    except Exception:
        return audio_data
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except Exception:
            pass

async def synthesize_text(
    text: str,
    voice: str = "vi-VN-NamMinhNeural",
    output_path: Optional[Path | str] = None,
    rate: str = "+0%",
    max_retries: int = 3,
    provider: str = "edge",
    prompt_style: str = "dramatic",
) -> bytes:
    """
    Sinh file âm thanh từ văn bản hỗ trợ Multi-Provider (Edge-TTS, CapCut, Gemini).
    Tự động kích hoạt Fallback sang Edge-TTS nếu Provider ngoài gặp sự cố mạng/quota.
    """
    clean_text = normalize_tts_text(text)
    if not clean_text:
        return b""

    prov = resolve_tts_provider(voice, preferred_provider=provider)
    voice = normalize_voice_for_provider(voice, prov)
    audio_data: bytes = b""
    primary_error: Exception | None = None

    try:
        if prov == "capcut":
            async def _capcut_call() -> bytes:
                client = CapCutTTSClient()
                return await client.synthesize(clean_text, voice=voice, rate=rate)

            audio_data = await _run_provider_call("capcut", _capcut_call)
        elif prov == "gemini":
            async def _gemini_call() -> bytes:
                client = GeminiTTSClient()
                generated = await client.synthesize(clean_text, voice=voice, style=prompt_style)
                return apply_speaking_rate_to_audio(generated, rate)

            audio_data = await _run_provider_call("gemini", _gemini_call)
        else:
            async def _edge_call() -> bytes:
                return await _synthesize_edge_tts(
                    clean_text, voice=voice, rate=rate, max_retries=max_retries
                )

            audio_data = await _run_provider_call("edge", _edge_call)
    except Exception as error:
        primary_error = error

    if prov != "edge" and not audio_data:
        reason = (
            f"{type(primary_error).__name__}: {primary_error}"
            if primary_error is not None
            else "provider trả về audio rỗng"
        )
        logger.warning(
            "%s TTS thất bại (%s). Fallback một lần sang Microsoft Edge-TTS...",
            prov.capitalize(), reason,
        )

        async def _edge_fallback() -> bytes:
            return await _synthesize_edge_tts(
                clean_text,
                voice="vi-VN-NamMinhNeural",
                rate=rate,
                max_retries=max_retries,
            )

        audio_data = await _run_provider_call("edge", _edge_fallback)

    if not audio_data:
        logger.warning("Không nhận được audio từ %s/Edge-TTS; thử Windows SAPI cục bộ.", prov)
        audio_data = await _synthesize_windows_sapi(clean_text)

    if audio_data and output_path:
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(audio_data)

    return audio_data


def _decode_mp3_to_pcm(mp3_data: bytes, sample_rate: int = 44100) -> np.ndarray:
    """Giải mã dữ liệu MP3 thành mảng numpy PCM float32 [-1.0, 1.0] đơn kênh (mono)."""
    if not mp3_data:
        return np.array([], dtype=np.float32)

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-f",
        "s16le",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "pipe:1",
    ]
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    raw_pcm, _ = proc.communicate(input=mp3_data)
    if not raw_pcm:
        return np.array([], dtype=np.float32)

    int_samples = np.frombuffer(raw_pcm, dtype=np.int16)
    return int_samples.astype(np.float32) / 32768.0


def validate_non_silent_pcm(
    samples: Any,
    *,
    silence_threshold: float = 1e-4,
) -> np.ndarray:
    """Return finite mono float32 PCM, or raise when it is empty or silent."""
    try:
        pcm = np.asarray(samples, dtype=np.float32).reshape(-1)
    except (TypeError, ValueError) as error:
        raise ValueError("Dữ liệu PCM không hợp lệ.") from error
    if pcm.size == 0:
        raise ValueError("Dữ liệu PCM rỗng.")
    if not bool(np.all(np.isfinite(pcm))):
        raise ValueError("Dữ liệu PCM chứa mẫu không hữu hạn.")
    peak = float(np.max(np.abs(pcm)))
    if peak <= max(0.0, float(silence_threshold)):
        raise ValueError("Dữ liệu PCM chỉ chứa im lặng.")
    return pcm


def decode_and_validate_audio(
    audio_data: bytes,
    *,
    sample_rate: int = 44100,
    silence_threshold: float = 1e-4,
) -> np.ndarray:
    """Decode MP3/audio bytes and return validated, non-silent mono PCM."""
    if not isinstance(audio_data, (bytes, bytearray)) or not audio_data:
        raise ValueError("Dữ liệu âm thanh rỗng hoặc không hợp lệ.")
    try:
        pcm = _decode_mp3_to_pcm(bytes(audio_data), sample_rate=sample_rate)
    except Exception as error:
        raise ValueError("Không thể giải mã dữ liệu âm thanh sang PCM.") from error
    try:
        return validate_non_silent_pcm(pcm, silence_threshold=silence_threshold)
    except ValueError as error:
        raise ValueError(f"Âm thanh giải mã không hợp lệ: {error}") from error


def is_valid_speech_audio(
    audio_or_pcm: Any,
    *,
    sample_rate: int = 44100,
    silence_threshold: float = 1e-4,
) -> bool:
    """Return whether encoded audio bytes or PCM contain finite audible speech data."""
    try:
        if isinstance(audio_or_pcm, (bytes, bytearray)):
            decode_and_validate_audio(
                bytes(audio_or_pcm),
                sample_rate=sample_rate,
                silence_threshold=silence_threshold,
            )
        else:
            validate_non_silent_pcm(
                audio_or_pcm, silence_threshold=silence_threshold
            )
    except (TypeError, ValueError, OSError, subprocess.SubprocessError):
        return False
    return True


def _encode_pcm_to_mp3(
    samples: np.ndarray,
    output_path: Path | str,
    sample_rate: int = 44100,
) -> Path:
    """Mã hóa mảng numpy PCM float32 thành file MP3 chất lượng cao qua FFmpeg."""
    out = Path(output_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    # Chống clipping âm thanh
    clipped = np.clip(samples, -1.0, 1.0)
    int_samples = (clipped * 32767.0).astype(np.int16)
    raw_bytes = int_samples.tobytes()

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "s16le",
        "-ar",
        str(sample_rate),
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        str(out),
    ]
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    _, err = proc.communicate(input=raw_bytes)
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg MP3 encode failed: {err.decode('utf-8', errors='ignore')}")

    return out



def normalize_dubbing_mode(mode: str | None) -> str:
    """Chuẩn hoá alias mode UI/backend về 'single' | 'multi'."""
    raw = str(mode or "single").strip().lower()
    if raw in {"multi", "gender_multi", "multi_speaker", "multi-voice", "cast"}:
        return "multi"
    return "single"


_CROWD_PATTERNS = [
    r"qu[aâ][nñ]n?\s*ch[uú]ng",
    r"\bđám\s*đông\b",
    r"\bcrowd\b",
    r"\bwalla\b",
    r"\bextras?\b",
    r"đồng\s*thanh",
    r"mọi\s*người\s*hô",
    r"众人",
    r"齐声",
    r"群众",
]

_SPEAKER_ID_TAG = re.compile(
    r"[\[\(\uff08【]\s*((?:nam|nữ|nu|male|female)\s*\d+|[a-zA-ZÀ-ỹ0-9_\-]{2,32}|mẹ|bố|ba|chị|anh|em|ông|bà|narrator|dẫn\s*chuyện)\s*[\]\)\uff09】]",
    re.IGNORECASE,
)


def is_skip_tts_role(role: str | None) -> bool:
    return str(role or "").strip().lower() in {"crowd", "extra", "extras", "walla", "background"}


def cues_truly_overlap(a: SubtitleCueV1, b: SubtitleCueV1, min_overlap: float = 0.05) -> bool:
    """True when two cues overlap on the timeline by more than min_overlap seconds."""
    start = max(float(a.start_pts), float(b.start_pts))
    end = min(float(a.end_pts), float(b.end_pts))
    return (end - start) > min_overlap


def estimate_speech_seconds(text: str, base_rate: float = 1.0) -> float:
    """Ước lượng thời lượng nói tiếng Việt theo số tiếng/token."""
    cleaned = clean_subtitle_text(text or "")
    if not cleaned:
        return 0.0
    tokens = re.findall(r"[A-Za-zÀ-ỹ0-9]+|[\u4e00-\u9fff]", cleaned)
    # ~3.3 tiếng/sec ở tốc độ tự nhiên cho VI narration ngắn
    natural = max(0.35, len(tokens) / 3.3)
    rate = max(0.5, min(2.0, float(base_rate or 1.0)))
    return natural / rate



def has_explicit_speaker_id(cue: SubtitleCueV1, text: str = "") -> bool:
    """True when speaker_id comes from style or translation/character tags."""
    style = cue.style if isinstance(getattr(cue, "style", None), dict) else {}
    if str(style.get("speaker_id") or style.get("character_id") or "").strip():
        return True
    raw = f"{cue.source_text} {cue.translated_text} {text}".strip()
    return bool(_SPEAKER_ID_TAG.search(raw))


_VI_FILLER_RE = re.compile(
    r"\b(?:à|ừ|ờ|nhỉ|nhé|ạ|thì|mà|đã|đang|sẽ|những|các|rất|quá|hết\s+sức|thật\s+sự|thật\s+ra|có\s+lẽ|một\s+cách)\b",
    re.IGNORECASE,
)
_VI_SHORTEN_MAP: List[tuple[str, str]] = [
    (r"\bkhông\s+thể\b", "không"),
    (r"\bkhông\s+được\b", "đừng"),
    (r"\bcó\s+phải\s+không\b", "phải không"),
    (r"\bngay\s+lập\s+tức\b", "ngay"),
    (r"\btrong\s+trường\s+hợp\b", "nếu"),
    (r"\bchúng\s+ta\s+sẽ\b", "ta"),
    (r"\bchúng\s+ta\b", "ta"),
    (r"\bchúng\s+tôi\b", "tôi"),
    (r"\bcùng\s+nhau\b", "cùng"),
    (r"\bđi\s+đến\b", "đến"),
    (r"\bđể\s+không\s+bị\b", "tránh"),
    (r"\bvà\s+thật\s+sự\b", "và"),
]


def compress_vietnamese_for_speech(text: str, aggressiveness: int = 1) -> str:
    """Deterministic VI compression for dubbing duration budget (no LLM)."""
    s = clean_subtitle_text(text or "")
    if not s:
        return ""
    s = re.sub(r"[\(\[（【].*?[\)\]）】]", " ", s)
    if aggressiveness >= 1:
        s = _VI_FILLER_RE.sub(" ", s)
        for pat, repl in _VI_SHORTEN_MAP:
            s = re.sub(pat, repl, s, flags=re.IGNORECASE)
    if aggressiveness >= 2:
        s = re.sub(
            r"\b(?:hết\s+sức|cẩn\s+thận|nhẹ\s+nhàng|thật\s+lòng|hoàn\s+toàn|tuyệt\s+đối)\b",
            " ",
            s,
            flags=re.IGNORECASE,
        )
        s = re.sub(r"\s*,\s*", " ", s)
    if aggressiveness >= 3:
        tokens = re.findall(r"[A-Za-zÀ-ỹ0-9]+|[\u4e00-\u9fff]|[,.!?;:…]", s)
        keep = max(3, int(len(tokens) * 0.7))
        s = " ".join(tokens[:keep])
    s = re.sub(r"\s+", " ", s).strip(" ,;:-")
    return s or clean_subtitle_text(text or "")


def adapt_spoken_text_for_slot(
    text: str,
    slot_sec: float,
    base_rate: float = 1.0,
    soft_stretch: float = 1.20,
    hard_stretch: float = 1.45,
) -> tuple[str, Dict[str, Any]]:
    """Adapt VI spoken script to fit a time slot before TTS/stretch.

    Returns (spoken_text, meta) where meta may include adapted/timing_warning.
    """
    original = clean_subtitle_text(text or "")
    meta: Dict[str, Any] = {
        "adapted": False,
        "timing_warning": "",
        "original_est": 0.0,
        "spoken_est": 0.0,
        "slot_sec": float(slot_sec or 0.0),
        "aggressiveness": 0,
    }
    if not original:
        return "", meta
    # Do not invent spaced-CJK spoken_text for Vietnamese TTS pipelines.
    if _cjk_ratio_text(original) >= 0.3:
        meta["timing_warning"] = "hard"
        return "", meta

    rate = max(0.5, min(2.0, float(base_rate or 1.0)))
    soft = max(1.0, float(soft_stretch or 1.2))
    hard = max(soft, float(hard_stretch or 1.45))
    slot = max(0.05, float(slot_sec or 0.0))

    est0 = estimate_speech_seconds(original, rate)
    meta["original_est"] = est0
    if est0 <= slot * soft:
        meta["spoken_est"] = est0
        return original, meta

    best = original
    best_est = est0
    for aggr in (1, 2, 3):
        candidate = compress_vietnamese_for_speech(original, aggressiveness=aggr)
        if not candidate:
            continue
        est = estimate_speech_seconds(candidate, rate)
        if est < best_est or len(candidate) < len(best):
            best, best_est = candidate, est
        meta["aggressiveness"] = aggr
        if est <= slot * soft:
            break
        if est <= slot * hard and aggr >= 2:
            break

    # Final token-budget trim if still over hard stretch ceiling
    if best_est > slot * hard:
        target_tokens = max(3, int(slot * hard * rate * 3.3))
        tokens = re.findall(r"[A-Za-zÀ-ỹ0-9]+|[\u4e00-\u9fff]", best)
        if len(tokens) > target_tokens:
            best = " ".join(tokens[:target_tokens])
            best_est = estimate_speech_seconds(best, rate)
            meta["aggressiveness"] = max(int(meta.get("aggressiveness") or 0), 4)

    spoken = best
    meta["spoken_est"] = best_est
    meta["adapted"] = spoken != original
    if best_est > slot * hard:
        meta["timing_warning"] = "hard"
    elif best_est > slot * soft:
        meta["timing_warning"] = "soft"
    else:
        meta["timing_warning"] = ""
    return spoken, meta


def assign_turn_taking_speaker_ids(cues: List[SubtitleCueV1], mode: str = "multi") -> List[SubtitleCueV1]:
    """Fill missing speaker_id using adjacency turn-taking for same-gender accuracy."""
    mode_n = normalize_dubbing_mode(mode)
    if mode_n != "multi" or not cues:
        return cues

    ordered = sorted(cues, key=lambda c: (float(c.start_pts), float(c.end_pts), str(c.cue_id)))
    last_gender: Optional[str] = None
    last_id: Optional[str] = None
    last_end: Optional[float] = None
    last_by_gender: Dict[str, str] = {}
    counters: Dict[str, int] = {"male": 0, "female": 0, "unknown": 0}
    short_gap = 1.8

    def _alloc(gender: str) -> str:
        g = gender if gender in counters else "unknown"
        counters[g] = int(counters.get(g, 0)) + 1
        prefix = "nam" if g == "male" else ("nu" if g == "female" else "spk")
        return f"{prefix}_{counters[g]}"

    for cue in ordered:
        if not isinstance(cue.style, dict):
            cue.style = {}
        text = (cue.translated_text or cue.source_text or "").strip()
        identity = detect_speaker_identity(cue, text)
        role = identity.get("speaker_role") or "main"
        gender = identity.get("speaker") or "unknown"

        if is_skip_tts_role(role):
            cue.style.setdefault("speaker_role", role)
            cue.style.setdefault("speaker", gender)
            cue.style.setdefault("speaker_id", identity.get("speaker_id") or "crowd")
            last_gender, last_id, last_end = gender, cue.style["speaker_id"], float(cue.end_pts)
            continue

        if has_explicit_speaker_id(cue, text):
            sid = str(cue.style.get("speaker_id") or identity.get("speaker_id") or "").strip() or _alloc(gender)
            cue.style["speaker_id"] = sid
            cue.style.setdefault("speaker", gender)
            cue.style.setdefault("speaker_role", role)
            last_by_gender[gender] = sid
            last_gender, last_id, last_end = gender, sid, float(cue.end_pts)
            continue

        gap = None if last_end is None else max(0.0, float(cue.start_pts) - float(last_end))
        if last_gender == gender and last_id and gap is not None and gap <= short_gap:
            sid = last_id
        elif gender in last_by_gender and last_gender != gender and (gap is None or gap <= 3.0):
            sid = last_by_gender[gender]
        else:
            sid = _alloc(gender)

        cue.style["speaker_id"] = sid
        cue.style["speaker"] = gender
        cue.style.setdefault("speaker_role", role)
        last_by_gender[gender] = sid
        last_gender, last_id, last_end = gender, sid, float(cue.end_pts)

    return cues


def _stable_index(key: str, modulus: int) -> int:
    if modulus <= 0:
        return 0
    acc = 0
    for ch in key:
        acc = (acc * 131 + ord(ch)) % 2_147_483_647
    return acc % modulus


def detect_speaker_identity(cue: SubtitleCueV1, text: str) -> Dict[str, str]:
    """Trả về speaker/gender, speaker_id, speaker_role cho một cue."""
    style = cue.style if isinstance(getattr(cue, "style", None), dict) else {}
    role = str(style.get("speaker_role") or style.get("role") or "").strip().lower()
    speaker_id = str(style.get("speaker_id") or style.get("character_id") or "").strip()
    gender = str(style.get("speaker") or "").strip().lower()

    raw_combined = f"{cue.source_text} {cue.translated_text} {text}".strip()
    lower_combined = raw_combined.lower()

    if not role:
        for pat in _CROWD_PATTERNS:
            if re.search(pat, lower_combined, flags=re.IGNORECASE):
                role = "crowd"
                break
    if not role and re.search(r"\[(?:quần\s*chúng|đám\s*đông|crowd|walla|众人|齐声)\]", lower_combined):
        role = "crowd"
    if not role:
        role = "main"

    if not speaker_id:
        tag = _SPEAKER_ID_TAG.search(raw_combined)
        if tag:
            speaker_id = re.sub(r"\s+", "_", tag.group(1).strip().lower())
    if not speaker_id and role == "crowd":
        speaker_id = "crowd"
    if not speaker_id:
        # fallback identity by gender bucket; still better than collapsing all males
        gender_guess = detect_cue_speaker(cue, text, default="unknown", allow_heuristic=True)
        speaker_id = f"{gender_guess or 'unknown'}_default"

    if gender in {"female", "nu", "nữ", "woman", "girl"}:
        gender = "female"
    elif gender in {"male", "nam", "man", "boy"}:
        gender = "male"
    elif gender in {"unknown", "other"}:
        gender = "unknown"
    else:
        gender = detect_cue_speaker(cue, text, default="unknown", allow_heuristic=True)

    if role == "crowd" and not str(style.get("speaker_id") or "").strip():
        speaker_id = "crowd"

    return {
        "speaker": gender or "unknown",
        "speaker_id": speaker_id or "unknown_default",
        "speaker_role": role or "main",
    }


_PROVIDER_DEFAULT_VOICES: Dict[str, Dict[str, str]] = {
    "edge": {
        "male": "vi-VN-NamMinhNeural",
        "female": "vi-VN-HoaiMyNeural",
    },
    "capcut": {
        "male": "BV075_streaming",
        "female": "BV074_streaming",
    },
    "gemini": {
        "male": "Puck",
        "female": "Kore",
    },
}


def _voice_matches_provider(voice: Optional[str], provider: str) -> bool:
    if not voice:
        return False
    if provider == "capcut":
        return is_capcut_voice(voice)
    if provider == "gemini":
        return is_gemini_voice(voice)
    return is_edge_voice(voice)


def _voice_gender(voice: Optional[str]) -> str:
    value = str(voice or "").strip().lower()
    for item in list(EDGE_VOICE_CATALOG) + list(CAPCUT_VOICE_CATALOG) + list(GEMINI_VOICE_CATALOG):
        if str(item.get("voice_id") or "").strip().lower() == value:
            gender = str(item.get("gender") or "").lower()
            return gender if gender in ("male", "female") else "male"
    return "female" if any(token in value for token in ("female", "hoaimy", "kore", "nu")) else "male"


def normalize_voice_for_provider(voice: Optional[str], provider: str, gender: Optional[str] = None) -> str:
    provider_n = resolve_tts_provider(None, preferred_provider=provider)
    value = str(voice or "").strip()
    if _voice_matches_provider(value, provider_n):
        return value
    selected_gender = gender if gender in ("male", "female") else _voice_gender(value)
    return _PROVIDER_DEFAULT_VOICES[provider_n][selected_gender]


def default_voice_pools(provider: str = "edge") -> Dict[str, List[str]]:
    """Pool giọng theo giới tính, chỉ lấy từ provider đang được cấu hình."""
    provider_n = resolve_tts_provider(None, preferred_provider=provider)
    catalogs = {
        "edge": EDGE_VOICE_CATALOG,
        "capcut": CAPCUT_VOICE_CATALOG,
        "gemini": GEMINI_VOICE_CATALOG,
    }
    male: List[str] = []
    female: List[str] = []
    for item in catalogs[provider_n]:
        vid = str(item.get("voice_id") or "").strip()
        gender = str(item.get("gender") or "").strip().lower()
        if not vid:
            continue
        if gender == "female" and vid not in female:
            female.append(vid)
        elif gender == "male" and vid not in male:
            male.append(vid)
    defaults = _PROVIDER_DEFAULT_VOICES[provider_n]
    if defaults["male"] not in male:
        male.insert(0, defaults["male"])
    if defaults["female"] not in female:
        female.insert(0, defaults["female"])
    return {"male": male, "female": female}


def assign_voice_for_cue(
    cue: SubtitleCueV1,
    *,
    mode: str,
    voice: str,
    voice_male: str,
    voice_female: str,
    provider: str = "edge",
    female_pool: List[str] | None = None,
    male_pool: List[str] | None = None,
    text: str | None = None,
) -> str:
    """Chọn voice_id cho cue; cùng gender nhưng khác speaker_id -> giọng khác nhau."""
    mode_n = normalize_dubbing_mode(mode)
    spoken = text if text is not None else (cue.translated_text or cue.source_text or "")
    style = cue.style if isinstance(getattr(cue, "style", None), dict) else {}
    override = str(style.get("voice_id") or "").strip()
    if override and _voice_matches_provider(override, provider):
        return override
    if mode_n != "multi":
        return normalize_voice_for_provider(voice, provider)

    identity = detect_speaker_identity(cue, spoken)
    if is_skip_tts_role(identity["speaker_role"]):
        return ""

    gender = identity["speaker"]
    speaker_id = identity["speaker_id"]
    pools = default_voice_pools(provider)
    normalized_male = normalize_voice_for_provider(voice_male, provider, "male")
    normalized_female = normalize_voice_for_provider(voice_female, provider, "female")
    males = [
        candidate
        for candidate in list(male_pool or pools["male"])
        if _voice_matches_provider(candidate, provider)
    ]
    females = [
        candidate
        for candidate in list(female_pool or pools["female"])
        if _voice_matches_provider(candidate, provider)
    ]
    if normalized_male and normalized_male not in males:
        males.insert(0, normalized_male)
    elif normalized_male:
        males = [normalized_male] + [v for v in males if v != normalized_male]
    if normalized_female and normalized_female not in females:
        females.insert(0, normalized_female)
    elif normalized_female:
        females = [normalized_female] + [v for v in females if v != normalized_female]

    if gender == "female":
        pool = females or [voice_female or voice]
    elif gender == "male":
        pool = males or [voice_male or voice]
    else:
        # unknown: prefer configured single voice, else male pool first
        return normalize_voice_for_provider(voice, provider) or (males[0] if males else normalized_female)

    if not pool:
        return normalized_female if gender == "female" else normalized_male
    return pool[_stable_index(speaker_id, len(pool))]


def resolve_cue_voice(
    cue: SubtitleCueV1,
    text: str,
    *,
    mode: str,
    voice: str,
    voice_male: str,
    voice_female: str,
    provider: str = "edge",
    female_pool: List[str] | None = None,
    male_pool: List[str] | None = None,
) -> str:
    return assign_voice_for_cue(
        cue,
        mode=mode,
        voice=voice,
        voice_male=voice_male,
        voice_female=voice_female,
        provider=provider,
        female_pool=female_pool,
        male_pool=male_pool,
        text=text,
    )


def required_voices_count(cues: List[SubtitleCueV1], mode: str = "single") -> int:
    mode_n = normalize_dubbing_mode(mode)
    if mode_n != "multi":
        return 1
    ids = set()
    for cue in cues:
        text = (cue.translated_text or cue.source_text or "").strip()
        identity = detect_speaker_identity(cue, text)
        if is_skip_tts_role(identity["speaker_role"]):
            continue
        style = cue.style if isinstance(getattr(cue, "style", None), dict) else {}
        has_identity = bool(style.get("speaker_id") or style.get("speaker") or clean_subtitle_text(text))
        if not has_identity:
            continue
        ids.add(identity["speaker_id"])
    return max(1, len(ids))


def detect_cue_speaker(
    cue: SubtitleCueV1,
    text: str,
    default: str = "unknown",
    allow_heuristic: bool = True,
) -> str:
    """
    Xác định giới tính người nói cho cue.
    Ưu tiên style.speaker -> tag -> heuristic đại từ.
    default='unknown' để tránh ép male âm thầm; truyền default='male' nếu cần tương thích cũ.
    """
    if hasattr(cue, "style") and isinstance(cue.style, dict):
        spk = str(cue.style.get("speaker", "")).lower()
        if spk in ("female", "nu", "nữ", "woman", "girl"):
            return "female"
        if spk in ("male", "nam", "man", "boy"):
            return "male"
        if spk in ("unknown", "other"):
            return "unknown"

    raw_combined = f"{cue.source_text} {cue.translated_text} {text}".lower()

    female_prefixes = [
        r"\[nữ(?:\d+)?\]", r"\(nữ(?:\d+)?\)", r"nữ\s*:", r"\[cô gái\]", r"\[mẹ\]", r"\[chị\]",
        r"\[bà\]", r"\[em gái\]", r"\[tiểu thư\]", r"\[hoàng hậu\]", r"\[công chúa\]",
    ]
    male_prefixes = [
        r"\[nam(?:\d+)?\]", r"\(nam(?:\d+)?\)", r"nam\s*:", r"\[chàng trai\]", r"\[bố\]", r"\[ba\]",
        r"\[anh\]", r"\[ông\]", r"\[em trai\]", r"\[thiếu gia\]", r"\[hoàng đế\]", r"\[hoàng tử\]",
    ]

    for pat in female_prefixes:
        if re.search(pat, raw_combined):
            return "female"
    for pat in male_prefixes:
        if re.search(pat, raw_combined):
            return "male"

    if not allow_heuristic:
        return default

    lower_vi = (text or "").lower()
    female_indicators = [
        r"\banh ơi\b", r"\banh à\b", r"\banh nhé\b", r"\bem đây\b", r"\bem biết\b",
        r"\bem không\b", r"\bem xin lỗi\b", r"\bem yêu anh\b", r"\bem thích anh\b",
        r"\bmẹ bảo\b", r"\bchị bảo\b",
    ]
    male_indicators = [
        r"\bem ơi\b", r"\bem à\b", r"\bem nhé\b", r"\banh đây\b", r"\banh biết\b",
        r"\banh không\b", r"\banh xin lỗi\b", r"\banh yêu em\b", r"\banh thích em\b",
        r"\bbố bảo\b", r"\bba bảo\b",
    ]

    f_score = sum(1 for pat in female_indicators if re.search(pat, lower_vi))
    m_score = sum(1 for pat in male_indicators if re.search(pat, lower_vi))
    if f_score > m_score:
        return "female"
    if m_score > f_score:
        return "male"
    return default


async def generate_timed_voiceover(
    cues: List[SubtitleCueV1],
    voice: str = "vi-VN-NamMinhNeural",
    output_path: Path | str = "output_voiceover.mp3",
    total_duration: float = 0.0,
    sample_rate: int = 44100,
    batch_size: int = 5,
    max_stretch_rate: float = 1.45,
    export_cues_dir: Optional[Path | str] = None,
    rate: str = "+0%",
    mode: str = "single",  # "single" (1 người) | "multi" (nhiều người phân vai)
    voice_male: str = "vi-VN-NamMinhNeural",
    voice_female: str = "vi-VN-HoaiMyNeural",
    provider: str = "edge",
    prompt_style: str = "dramatic",
    progress_callback: Optional[Any] = None,
    auto_detect_speakers: bool = True,
) -> Path:
    """
    Sinh toàn bộ giọng thuyết minh cho các câu phụ đề theo đúng mốc thời gian start_pts của video.
    Hỗ trợ 2 chế độ:
    - 'single': 1 giọng đọc duy nhất xuyên suốt (phù hợp Review phim, đọc truyện).
    - 'multi': Lồng tiếng phân vai nhiều người (thoại nam đọc giọng Nam, thoại nữ đọc giọng Nữ).
    Tự động lọc rác thoại và co giãn thời lượng (Slot Time-Stretching 1.0x -> 1.45x).
    """
    provider = resolve_tts_provider(voice, preferred_provider=provider)
    voice = normalize_voice_for_provider(voice, provider)
    voice_male = normalize_voice_for_provider(voice_male, provider, "male")
    voice_female = normalize_voice_for_provider(voice_female, provider, "female")
    cues = normalize_sequential_cues(list(cues))
    mode = normalize_dubbing_mode(mode)
    # Stabilize same-gender casting before TTS (explicit ids preserved)
    assign_turn_taking_speaker_ids(cues, mode=mode)
    base_rate = parse_speaking_rate(rate)
    valid_cues: List[tuple[SubtitleCueV1, str]] = []
    for idx_c, c in enumerate(cues):
        style = c.style if isinstance(getattr(c, "style", None), dict) else {}
        # Prefer VI translated / usable spoken_text; never feed stale CJK spoken_text to VI TTS.
        spoken_raw = resolve_tts_spoken_text(c, prefer_translated=True)
        cleaned = clean_subtitle_text(spoken_raw)
        if not cleaned:
            continue
        identity = detect_speaker_identity(c, cleaned)
        if is_skip_tts_role(identity["speaker_role"]):
            logger.info(f"Bỏ qua TTS quần chúng/extra cho cue {c.cue_id}")
            continue
        # Persist identity onto cue style for downstream UI / single-cue redub
        if not isinstance(c.style, dict):
            c.style = {}
        c.style.setdefault("speaker", identity["speaker"])
        c.style.setdefault("speaker_id", identity["speaker_id"])
        c.style.setdefault("speaker_role", identity["speaker_role"])

        next_cue = cues[idx_c + 1] if idx_c + 1 < len(cues) else None
        slot_mode = mode
        if mode == "multi" and next_cue is not None:
            id_a = str((c.style or {}).get("speaker_id") or "")
            id_b = str((next_cue.style or {}).get("speaker_id") or "")
            if not (cues_truly_overlap(c, next_cue) and id_a and id_b and id_a != id_b):
                slot_mode = "single"
        slot_dur = available_voiceover_slot(c, next_cue, slot_mode)
        # Only auto-adapt when spoken_text was not manually provided
        existing_spoken = clean_subtitle_text(str(style.get("spoken_text") or ""))
        manual_spoken = bool(existing_spoken) and _cjk_ratio_text(existing_spoken) < 0.3
        if not manual_spoken:
            # Drop unusable stale spoken_text so adapt persists VI script.
            if existing_spoken and isinstance(c.style, dict):
                c.style.pop("spoken_text", None)
            adapted, adapt_meta = adapt_spoken_text_for_slot(
                cleaned,
                slot_sec=slot_dur,
                base_rate=base_rate,
                soft_stretch=1.20,
                hard_stretch=max_stretch_rate,
            )
            if adapted:
                cleaned = adapted
                c.style["spoken_text"] = adapted
            if adapt_meta.get("timing_warning"):
                c.style["timing_warning"] = adapt_meta["timing_warning"]
            elif "timing_warning" in c.style and not adapt_meta.get("adapted"):
                c.style.pop("timing_warning", None)
        if not auto_detect_speakers:
            # Keep explicit style labels only; avoid pronoun heuristic overrides later
            pass
        valid_cues.append((c, cleaned))

    if not valid_cues:
        raise ValueError("Không có câu phụ đề nào hợp lệ sau khi làm sạch để sinh giọng đọc thuyết minh")

    # Xác định tổng thời lượng âm thanh cần tạo
    max_cue_end = max((c.end_pts for c, _ in valid_cues), default=0.0)
    final_duration = max(float(total_duration), float(max_cue_end) + 2.0, 1.0)
    total_samples = int(final_duration * sample_rate)

    # Khởi tạo timeline âm thanh trống (silence)
    master_buffer = np.zeros(total_samples, dtype=np.float32)

    mode_label = "Phân vai Đa Nhân Vật (Nam/Nữ)" if mode == "multi" else f"Đơn Thoại 1 Giọng ({voice})"
    logger.info(
        f"Bắt đầu sinh thuyết minh TTS [{provider.upper()}] [{mode_label}] cho {len(valid_cues)} câu thoại (Tổng {final_duration:.1f}s)..."
    )

    cues_out_dir = Path(export_cues_dir).resolve() if export_cues_dir else None
    if cues_out_dir:
        cues_out_dir.mkdir(parents=True, exist_ok=True)

    # Giới hạn batch ngoài limiter theo provider để không tạo quá nhiều coroutine đang chờ.
    batch_sem = asyncio.Semaphore(max(1, int(batch_size)))
    completed_count = 0
    total_valid = len(valid_cues)

    async def _fetch_single(i: int, c: SubtitleCueV1, text: str):
        nonlocal completed_count
        if not auto_detect_speakers and isinstance(c.style, dict):
            # Freeze speaker label if provided; still allow speaker_id casting
            if not c.style.get("speaker"):
                c.style["speaker"] = "unknown"
        target_v = resolve_cue_voice(
            c,
            text,
            mode=mode,
            voice=voice,
            voice_male=voice_male,
            voice_female=voice_female,
            provider=provider,
        )
        if not target_v:
            completed_count += 1
            if progress_callback is not None:
                try:
                    progress_callback(completed_count, total_valid, text)
                except Exception:
                    pass
            return i, c, text, b""
        async with batch_sem:
            audio_bytes = await synthesize_text(
                text,
                voice=target_v,
                rate=rate,
                provider=provider,
                prompt_style=prompt_style,
            )
            completed_count += 1
            if progress_callback is not None:
                try:
                    progress_callback(completed_count, total_valid, text)
                except Exception:
                    pass
            return i, c, text, audio_bytes

    tasks = [_fetch_single(i, c, t) for i, (c, t) in enumerate(valid_cues)]
    results = await asyncio.gather(*tasks)
    results.sort(key=lambda r: r[0])

    successful_cues = 0
    for result_index, (idx, cue, cleaned_text, mp3_res) in enumerate(results):
        if not mp3_res:
            logger.warning(f"Bỏ qua câu {cue.cue_id} do không nhận được audio")
            continue

        try:
            pcm_samples = decode_and_validate_audio(mp3_res, sample_rate=sample_rate)
        except ValueError as error:
            logger.warning("Bỏ qua câu %s do audio không hợp lệ: %s", cue.cue_id, error)
            continue
        successful_cues += 1

        next_cue = results[result_index + 1][1] if result_index + 1 < len(results) else None
        # Co giãn khớp slot thời gian (Slot Time-Stretching 1.0x -> 1.45x)
        speech_dur = len(pcm_samples) / sample_rate
        slot_mode = mode
        if mode == "multi" and next_cue is not None:
            id_a = str((cue.style or {}).get("speaker_id") or "")
            id_b = str((next_cue.style or {}).get("speaker_id") or "")
            if not (cues_truly_overlap(cue, next_cue) and id_a and id_b and id_a != id_b):
                # Treat as non-overlap for slot budgeting to avoid false spill
                slot_mode = "single"
        slot_dur = available_voiceover_slot(cue, next_cue, slot_mode)
        speed_factor = calculate_slot_stretch(
            speech_dur, slot_dur, min_rate=1.0, max_rate=max_stretch_rate
        )

        if speed_factor > 1.02:
            pcm_samples = time_stretch_pcm(pcm_samples, speed_factor=speed_factor, sample_rate=sample_rate)
            logger.info(
                f"Co giãn khớp slot câu {cue.cue_id}: {speech_dur:.2f}s -> {len(pcm_samples)/sample_rate:.2f}s "
                f"(tốc độ {speed_factor:.2f}x, slot {slot_dur:.2f}s)"
            )

        # Xuất từng câu riêng biệt nếu được yêu cầu (chuẩn CapCut và phục vụ nút Nghe câu lẻ)
        if cues_out_dir:
            cue_filename = f"{idx+1:03d}_{cue.start_pts:05.2f}-{cue.end_pts:05.2f}.mp3"
            _encode_pcm_to_mp3(pcm_samples, cues_out_dir / cue_filename, sample_rate=sample_rate)
            # Lưu đồng thời theo mã cue_id để endpoint GET /api/v1/projects/{id}/cues/{cue_id}/audio phát tức thì
            _encode_pcm_to_mp3(pcm_samples, cues_out_dir / f"{cue.cue_id}.mp3", sample_rate=sample_rate)

        start_sample = max(0, int(cue.start_pts * sample_rate))
        next_start_sample = None if next_cue is None else max(0, int(next_cue.start_pts * sample_rate))
        allow_overlap = False
        if mode == "multi" and next_cue is not None and cues_truly_overlap(cue, next_cue):
            id_a = str((cue.style or {}).get("speaker_id") or "")
            id_b = str((next_cue.style or {}).get("speaker_id") or "")
            allow_overlap = bool(id_a and id_b and id_a != id_b)
        master_buffer = mix_voice_pcm(
            master_buffer,
            pcm_samples,
            start_sample,
            mode=mode,
            next_start_sample=next_start_sample,
            allow_overlap=allow_overlap,
        )

    if successful_cues == 0:
        raise ValueError("Không có câu TTS nào tạo được âm thanh hợp lệ; không xuất master im lặng.")

    # Chặn master rỗng/im lặng trước encode, rồi chuẩn hóa chống vỡ tiếng khi có thoại chồng.
    try:
        master_buffer = validate_non_silent_pcm(master_buffer)
    except ValueError as error:
        raise ValueError(f"Master voiceover không hợp lệ trước khi mã hóa: {error}") from error
    max_peak = float(np.max(np.abs(master_buffer)))
    if max_peak > 0.98:
        master_buffer = (master_buffer / max_peak) * 0.95

    # Xuất ra file MP3 đồng bộ
    out = _encode_pcm_to_mp3(master_buffer, output_path, sample_rate=sample_rate)
    logger.info(f"Đã xuất file âm thanh thuyết minh đồng bộ: {out}")
    return out


def generate_voiceover_sync(
    cues: List[SubtitleCueV1],
    voice: str = "vi-VN-NamMinhNeural",
    output_path: Path | str = "output_voiceover.mp3",
    total_duration: float = 0.0,
    max_stretch_rate: float = 1.45,
    export_cues_dir: Optional[Path | str] = None,
    rate: str = "+0%",
    mode: str = "single",
    voice_male: str = "vi-VN-NamMinhNeural",
    voice_female: str = "vi-VN-HoaiMyNeural",
    provider: str = "edge",
    prompt_style: str = "dramatic",
    auto_detect_speakers: bool = True,
) -> Path:
    """Wrapper đồng bộ để gọi từ luồng worker thông thường."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(
                    asyncio.run,
                    generate_timed_voiceover(
                        cues=cues,
                        voice=voice,
                        output_path=output_path,
                        total_duration=total_duration,
                        max_stretch_rate=max_stretch_rate,
                        export_cues_dir=export_cues_dir,
                        rate=rate,
                        mode=mode,
                        voice_male=voice_male,
                        voice_female=voice_female,
                        provider=provider,
                        prompt_style=prompt_style,
                        auto_detect_speakers=auto_detect_speakers,
                    ),
                ).result()
        else:
            return loop.run_until_complete(
                generate_timed_voiceover(
                    cues=cues,
                    voice=voice,
                    output_path=output_path,
                    total_duration=total_duration,
                    max_stretch_rate=max_stretch_rate,
                    export_cues_dir=export_cues_dir,
                    rate=rate,
                    mode=mode,
                    voice_male=voice_male,
                    voice_female=voice_female,
                    provider=provider,
                    prompt_style=prompt_style,
                    auto_detect_speakers=auto_detect_speakers,
                )
            )
    except RuntimeError:
        return asyncio.run(
            generate_timed_voiceover(
                cues=cues,
                voice=voice,
                output_path=output_path,
                total_duration=total_duration,
                max_stretch_rate=max_stretch_rate,
                export_cues_dir=export_cues_dir,
                rate=rate,
                mode=mode,
                voice_male=voice_male,
                voice_female=voice_female,
                provider=provider,
                prompt_style=prompt_style,
                auto_detect_speakers=auto_detect_speakers,
            )
        )


async def splice_cue_voiceover(
    cues: List[SubtitleCueV1],
    target_cue: SubtitleCueV1,
    voice: str = "vi-VN-NamMinhNeural",
    output_path: Path | str = "output_voiceover.mp3",
    cue_output_path: Optional[Path | str] = None,
    total_duration: float = 0.0,
    sample_rate: int = 44100,
    rate: str = "+0%",
    max_stretch_rate: float = 1.45,
    provider: str = "edge",
    prompt_style: str = "dramatic",
    mode: str = "single",
    voice_male: str = "vi-VN-NamMinhNeural",
    voice_female: str = "vi-VN-HoaiMyNeural",
    auto_detect_speakers: bool = True,
) -> Dict[str, Any]:
    """
    Sinh giọng đọc thuyết minh cho riêng 1 câu phụ đề (Single Cue TTS) và
    vá trực tiếp (splice) vào file master voiceover MP3 của dự án.
    Nếu file master chưa tồn tại, tự động khởi tạo master buffer và đặt câu vào đúng mốc start_pts.
    """
    out_path = Path(output_path).resolve()
    mode = normalize_dubbing_mode(mode)
    provider = resolve_tts_provider(voice, preferred_provider=provider)
    voice = normalize_voice_for_provider(voice, provider)
    voice_male = normalize_voice_for_provider(voice_male, provider, "male")
    voice_female = normalize_voice_for_provider(voice_female, provider, "female")
    # Keep casting consistent with full-timeline turn-taking when possible
    try:
        assign_turn_taking_speaker_ids(list(cues), mode=mode)
    except Exception:
        pass
    style = target_cue.style if isinstance(getattr(target_cue, "style", None), dict) else {}
    raw_text = resolve_tts_spoken_text(target_cue, prefer_translated=True)
    cleaned_text = clean_subtitle_text(raw_text)
    if not cleaned_text:
        raise ValueError(f"Câu phụ đề {target_cue.cue_id} không có nội dung văn bản hợp lệ để lồng tiếng.")

    identity = detect_speaker_identity(target_cue, cleaned_text)
    if is_skip_tts_role(identity["speaker_role"]):
        raise ValueError(f"Câu {target_cue.cue_id} thuộc quần chúng/extra — bỏ qua TTS.")
    if not isinstance(target_cue.style, dict):
        target_cue.style = {}
    if auto_detect_speakers or not target_cue.style.get("speaker"):
        target_cue.style["speaker"] = identity["speaker"]
    target_cue.style.setdefault("speaker_id", identity["speaker_id"])
    target_cue.style.setdefault("speaker_role", identity["speaker_role"])

    # Duration-budget spoken adaptation for single-cue redub
    base_rate = parse_speaking_rate(rate)
    slot_dur = max(0.05, float(target_cue.end_pts) - float(target_cue.start_pts))
    existing_spoken = clean_subtitle_text(str(style.get("spoken_text") or ""))
    manual_spoken = bool(existing_spoken) and _cjk_ratio_text(existing_spoken) < 0.3
    if not manual_spoken:
        if existing_spoken and isinstance(target_cue.style, dict):
            target_cue.style.pop("spoken_text", None)
        adapted, adapt_meta = adapt_spoken_text_for_slot(
            cleaned_text,
            slot_sec=slot_dur,
            base_rate=base_rate,
            soft_stretch=1.20,
            hard_stretch=max_stretch_rate,
        )
        if adapted:
            cleaned_text = adapted
            target_cue.style["spoken_text"] = adapted
        if adapt_meta.get("timing_warning"):
            target_cue.style["timing_warning"] = adapt_meta["timing_warning"]

    selected_voice = resolve_cue_voice(
        target_cue,
        cleaned_text,
        mode=mode,
        voice=voice,
        voice_male=voice_male,
        voice_female=voice_female,
        provider=provider,
    ) or voice

    logger.info(f"Đang sinh giọng TTS câu đơn {target_cue.cue_id} [{selected_voice}] mode={mode} qua [{provider}]...")
    mp3_res = await synthesize_text(
        cleaned_text,
        voice=selected_voice,
        rate=rate,
        provider=provider,
        prompt_style=prompt_style,
    )
    if not mp3_res:
        raise ValueError(f"Không nhận được dữ liệu âm thanh từ dịch vụ TTS cho câu {target_cue.cue_id}.")

    try:
        pcm_samples = decode_and_validate_audio(mp3_res, sample_rate=sample_rate)
    except ValueError as error:
        raise ValueError(f"Âm thanh câu phụ đề không hợp lệ: {error}") from error

    if cue_output_path:
        c_path = Path(cue_output_path).resolve()
        c_path.parent.mkdir(parents=True, exist_ok=True)
        c_path.write_bytes(mp3_res)

    # Co giãn khớp slot thời gian (1.0x -> 1.45x)
    speech_dur = len(pcm_samples) / sample_rate
    slot_dur = max(0.0, target_cue.end_pts - target_cue.start_pts)
    speed_factor = calculate_slot_stretch(
        speech_dur, slot_dur, min_rate=1.0, max_rate=max_stretch_rate
    )
    if speed_factor > 1.02:
        pcm_samples = time_stretch_pcm(pcm_samples, speed_factor=speed_factor, sample_rate=sample_rate)

    # Nạp master buffer hiện có hoặc tạo mới. Master đã tồn tại phải giải mã được
    # và có tín hiệu; không âm thầm ghi đè một file hỏng/im lặng.
    if out_path.exists():
        if out_path.stat().st_size == 0:
            raise ValueError("Master voiceover hiện có rỗng; từ chối splice để tránh mất dữ liệu.")
        try:
            master_buffer = decode_and_validate_audio(
                out_path.read_bytes(), sample_rate=sample_rate
            )
        except ValueError as error:
            raise ValueError(f"Master voiceover hiện có không hợp lệ: {error}") from error
    else:
        master_buffer = np.array([], dtype=np.float32)

    start_sample = int(target_cue.start_pts * sample_rate)
    needed_len = start_sample + len(pcm_samples) + int(sample_rate * 1.0)
    if len(cues) > 0:
        max_end = max((c.end_pts for c in cues), default=target_cue.end_pts)
        needed_len = max(needed_len, int((max_end + 2.0) * sample_rate))
    if total_duration > 0:
        needed_len = max(needed_len, int(total_duration * sample_rate))

    if len(master_buffer) < needed_len:
        pad_size = needed_len - len(master_buffer)
        master_buffer = np.pad(master_buffer, (0, pad_size), mode='constant')

    # Xóa âm thanh cũ trong khoảng slot thời gian của câu này để tránh bị đè tiếng (overwrite slot)
    slot_samples = int(max(slot_dur, len(pcm_samples) / sample_rate) * sample_rate)
    clear_end = min(len(master_buffer), start_sample + slot_samples)
    master_buffer[start_sample:clear_end] = 0.0

    # Vá âm thanh mới vào vị trí start_sample
    end_sample = start_sample + len(pcm_samples)
    master_buffer[start_sample:end_sample] = pcm_samples

    # Chặn master im lặng/non-finite trước khi mã hóa.
    try:
        master_buffer = validate_non_silent_pcm(master_buffer)
    except ValueError as error:
        raise ValueError(f"Master voiceover không hợp lệ sau khi splice: {error}") from error
    max_peak = float(np.max(np.abs(master_buffer)))
    if max_peak > 0.98:
        master_buffer = (master_buffer / max_peak) * 0.95

    # Mã hóa và lưu lại file MP3 master
    _encode_pcm_to_mp3(master_buffer, out_path, sample_rate=sample_rate)
    logger.info(f"Đã vá thành công âm thanh câu {target_cue.cue_id} vào {out_path.name}")

    return {
        "status": "completed",
        "cue_id": target_cue.cue_id,
        "voice": selected_voice,
        "mode": mode,
        "duration": len(pcm_samples) / sample_rate,
        "file_size": out_path.stat().st_size if out_path.exists() else 0,
    }


def mix_voiceover_into_video(
    video_path: Path | str,
    voiceover_path: Path | str,
    output_path: Path | str,
    ducking_volume: float = 0.25,
) -> Path:
    """
    Hòa trộn luồng thuyết minh với âm thanh gốc của video.
    Áp dụng hạ âm lượng nền gốc (ducking) để giọng đọc thuyết minh nổi bật, rõ ràng.
    """
    video = Path(video_path).resolve()
    voice = Path(voiceover_path).resolve()
    out = Path(output_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    if not video.exists():
        raise FileNotFoundError(f"Video gốc không tồn tại: {video}")
    if not voice.exists():
        raise FileNotFoundError(f"File thuyết minh không tồn tại: {voice}")

    # Bộ lọc FFmpeg:
    # [0:a]volume=ducking[bg]; [1:a]volume=1.2[vox]; [bg][vox]amix=inputs=2:duration=first:dropout_transition=2[aout]
    filter_complex = (
        f"[0:a]volume={ducking_volume}[bg];"
        f"[1:a]volume=1.2[vox];"
        f"[bg][vox]amix=inputs=2:duration=first:dropout_transition=2[aout]"
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-i",
        str(voice),
        "-filter_complex",
        filter_complex,
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(out),
    ]

    res = subprocess.run(cmd, capture_output=True)
    if res.returncode != 0:
        # Nếu video gốc không có track âm thanh, chỉ gắn track voiceover
        cmd_fallback = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(video),
            "-i",
            str(voice),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(out),
        ]
        res_fb = subprocess.run(cmd_fallback, capture_output=True)
        if res_fb.returncode != 0:
            raise RuntimeError(f"Hòa trộn audio thất bại: {res.stderr.decode('utf-8', errors='ignore')}")

    return out


def mix_voiceover_audio_only(
    video_path: Path | str,
    voiceover_path: Path | str,
    output_path: Path | str,
    ducking_volume: float = 0.25,
) -> Path:
    """
    Hòa trộn âm thanh nền gốc từ video với luồng voiceover thành file MP3 hoàn chỉnh.
    Áp dụng hạ âm lượng nền gốc (ducking) để giọng thuyết minh nổi bật, giữ lại tiếng động và nhạc nền.
    """
    video = Path(video_path).resolve()
    voice = Path(voiceover_path).resolve()
    out = Path(output_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    if not video.exists():
        raise FileNotFoundError(f"Video gốc không tồn tại: {video}")
    if not voice.exists():
        raise FileNotFoundError(f"File thuyết minh không tồn tại: {voice}")

    filter_complex = (
        f"[0:a]volume={ducking_volume}[bg];"
        f"[1:a]volume=1.2[vox];"
        f"[bg][vox]amix=inputs=2:duration=first:dropout_transition=2[aout]"
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-i",
        str(voice),
        "-filter_complex",
        filter_complex,
        "-map",
        "[aout]",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        str(out),
    ]

    res = subprocess.run(cmd, capture_output=True)
    if res.returncode != 0:
        cmd_fallback = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(voice),
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(out),
        ]
        res_fb = subprocess.run(cmd_fallback, capture_output=True)
        if res_fb.returncode != 0:
            raise RuntimeError(f"Xuất file hòa trộn audio thất bại: {res.stderr.decode('utf-8', errors='ignore')}")

    return out

