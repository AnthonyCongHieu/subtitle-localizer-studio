from __future__ import annotations

import asyncio
import logging
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from subtitle_localizer.domain.models import SubtitleCueV1
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
    """
    Xác định TTS Provider tối ưu nhất từ thông tin giọng đọc và provider mong muốn.
    Tôn trọng preferred_provider nếu client gửi lên rõ ràng, trừ khi phát hiện mâu thuẫn rõ ràng với voice.
    """
    pref = (preferred_provider or "").strip().lower()
    v = (voice or "").strip()

    # 1. Phát hiện mâu thuẫn hoặc nhận diện chính xác theo catalog
    if is_gemini_voice(v):
        return "gemini"
    if is_capcut_voice(v):
        return "capcut"
    if is_edge_voice(v):
        return "edge"

    # 2. Nếu giọng chưa nằm trong catalog đã biết (custom voice), tôn trọng provider chỉ định
    if pref in ("capcut", "gemini", "edge"):
        return pref

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

    for attempt in range(max_retries):
        try:
            communicate = edge_tts.Communicate(clean_text, actual_voice, rate=rate)
            audio_chunks = bytearray()
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio":
                    audio_chunks.extend(chunk.get("data", b""))

            if len(audio_chunks) > 0:
                return bytes(audio_chunks)
            raise RuntimeError("Edge-TTS trả về luồng âm thanh rỗng")
        except Exception as e:
            if attempt == max_retries - 1:
                logger.warning(f"Thử lại Edge-TTS thất bại sau {max_retries} lần: {e}")
                return b""
            await asyncio.sleep(0.5 * (attempt + 1))

    return b""


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
    clean_text = text.strip()
    if not clean_text:
        return b""

    # Tự động giải quyết Provider chính xác từ tên giọng đọc và provider chỉ định
    prov = resolve_tts_provider(voice, preferred_provider=provider)

    audio_data: bytes = b""

    if prov == "capcut":
        try:
            client = CapCutTTSClient()
            audio_data = await client.synthesize(clean_text, voice=voice, rate=rate)
        except Exception as ex:
            logger.warning(
                f"CapCut TTS gặp lỗi ({ex}). Tự động Fallback sang Microsoft Edge-TTS..."
            )
            audio_data = await _synthesize_edge_tts(clean_text, voice="vi-VN-NamMinhNeural", rate=rate, max_retries=max_retries)

    elif prov == "gemini":
        try:
            client = GeminiTTSClient()
            audio_data = await client.synthesize(clean_text, voice=voice, style=prompt_style)
        except Exception as ex:
            logger.warning(
                f"Gemini TTS gặp lỗi ({ex}). Tự động Fallback sang Microsoft Edge-TTS..."
            )
            audio_data = await _synthesize_edge_tts(clean_text, voice="vi-VN-NamMinhNeural", rate=rate, max_retries=max_retries)

    else:
        # Mặc định Edge-TTS
        audio_data = await _synthesize_edge_tts(clean_text, voice=voice, rate=rate, max_retries=max_retries)

    # Nếu sau tất cả vẫn chưa có audio và provider không phải edge, thử fallback edge một lần cuối
    if not audio_data and prov != "edge":
        logger.warning(f"Không nhận được audio từ {prov}. Fallback khẩn cấp sang Edge-TTS...")
        audio_data = await _synthesize_edge_tts(clean_text, voice="vi-VN-NamMinhNeural", rate=rate, max_retries=max_retries)

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


def detect_cue_speaker(cue: SubtitleCueV1, text: str) -> str:
    """
    Xác định nhân vật / vai người nói (male hoặc female) cho từng câu phụ đề:
    1. Kiểm tra thuộc tính style['speaker'] nếu đã được phân vai sẵn.
    2. Kiểm tra tiền tố nhân vật: [Nam], [Nữ], [Anh], [Em], (Nam), (Nữ), [Mẹ], [Bố], v.v.
    3. Phân tích ngữ cảnh đại từ xưng hô trong câu thoại tiếng Việt.
    Mặc định trả về 'male' nếu không phát hiện đặc thù nữ.
    """
    if hasattr(cue, "style") and isinstance(cue.style, dict):
        spk = str(cue.style.get("speaker", "")).lower()
        if spk in ("female", "nu", "nữ", "woman", "girl"):
            return "female"
        if spk in ("male", "nam", "man", "boy"):
            return "male"

    raw_combined = f"{cue.source_text} {cue.translated_text} {text}".lower()

    # Nhận diện thẻ phân vai rõ ràng
    female_prefixes = [
        r"\[nữ\]", r"\(nữ\)", r"nữ\s*:", r"\[cô gái\]", r"\[mẹ\]", r"\[chị\]",
        r"\[bà\]", r"\[em gái\]", r"\[tiểu thư\]", r"\[hoàng hậu\]", r"\[công chúa\]"
    ]
    male_prefixes = [
        r"\[nam\]", r"\(nam\)", r"nam\s*:", r"\[chàng trai\]", r"\[bố\]", r"\[ba\]",
        r"\[anh\]", r"\[ông\]", r"\[em trai\]", r"\[thiếu gia\]", r"\[hoàng đế\]", r"\[hoàng tử\]"
    ]

    for pat in female_prefixes:
        if re.search(pat, raw_combined):
            return "female"
    for pat in male_prefixes:
        if re.search(pat, raw_combined):
            return "male"

    # Phân tích đại từ xưng hô trong câu tiếng Việt
    lower_vi = text.lower()
    female_indicators = [
        r"\banh ơi\b", r"\banh à\b", r"\banh nhé\b", r"\bem đây\b", r"\bem biết\b",
        r"\bem không\b", r"\bem xin lỗi\b", r"\bem yêu anh\b", r"\bem thích anh\b",
        r"\bmẹ bảo\b", r"\bchị bảo\b"
    ]
    male_indicators = [
        r"\bem ơi\b", r"\bem à\b", r"\bem nhé\b", r"\banh đây\b", r"\banh biết\b",
        r"\banh không\b", r"\banh xin lỗi\b", r"\banh yêu em\b", r"\banh thích em\b",
        r"\bbố bảo\b", r"\bba bảo\b"
    ]

    f_score = sum(1 for pat in female_indicators if re.search(pat, lower_vi))
    m_score = sum(1 for pat in male_indicators if re.search(pat, lower_vi))

    if f_score > m_score:
        return "female"
    elif m_score > f_score:
        return "male"

    return "male"


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
) -> Path:
    """
    Sinh toàn bộ giọng thuyết minh cho các câu phụ đề theo đúng mốc thời gian start_pts của video.
    Hỗ trợ 2 chế độ:
    - 'single': 1 giọng đọc duy nhất xuyên suốt (phù hợp Review phim, đọc truyện).
    - 'multi': Lồng tiếng phân vai nhiều người (thoại nam đọc giọng Nam, thoại nữ đọc giọng Nữ).
    Tự động lọc rác thoại và co giãn thời lượng (Slot Time-Stretching 1.0x -> 1.45x).
    """
    valid_cues: List[tuple[SubtitleCueV1, str]] = []
    for c in cues:
        raw_text = (c.translated_text or c.source_text).strip()
        cleaned = clean_subtitle_text(raw_text)
        if cleaned:
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

    # Tổng hợp âm thanh song song có kiểm soát (Concurrency Semaphore) để tăng tốc độ 4x
    sem = asyncio.Semaphore(max(1, min(batch_size, 4)))
    completed_count = 0
    total_valid = len(valid_cues)

    async def _fetch_single(i: int, c: SubtitleCueV1, text: str):
        nonlocal completed_count
        target_v = voice
        if mode == "multi":
            speaker = detect_cue_speaker(c, text)
            target_v = voice_female if speaker == "female" else voice_male
        async with sem:
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

    for idx, cue, cleaned_text, mp3_res in results:
        if not mp3_res:
            logger.warning(f"Bỏ qua câu {cue.cue_id} do không nhận được audio")
            continue

        pcm_samples = _decode_mp3_to_pcm(mp3_res, sample_rate=sample_rate)
        if len(pcm_samples) == 0:
            continue

        # Co giãn khớp slot thời gian (Slot Time-Stretching 1.0x -> 1.45x)
        speech_dur = len(pcm_samples) / sample_rate
        slot_dur = max(0.0, cue.end_pts - cue.start_pts)
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

        # Tính vị trí mẫu bắt đầu trong master buffer
        start_sample = max(0, int(cue.start_pts * sample_rate))
        end_sample = start_sample + len(pcm_samples)

        # Mở rộng buffer nếu câu thoại vượt quá thời lượng ban đầu
        if end_sample > len(master_buffer):
            extra = end_sample - len(master_buffer)
            master_buffer = np.pad(master_buffer, (0, extra), mode="constant")

        # Đặt mẫu âm thanh vào timeline
        master_buffer[start_sample:end_sample] += pcm_samples

    # Chuẩn hóa chống vỡ tiếng (Anti-clipping soft peak normalization) khi có nhiều nhân vật nói đè lên nhau
    if len(master_buffer) > 0:
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
) -> Dict[str, Any]:
    """
    Sinh giọng đọc thuyết minh cho riêng 1 câu phụ đề (Single Cue TTS) và
    vá trực tiếp (splice) vào file master voiceover MP3 của dự án.
    Nếu file master chưa tồn tại, tự động khởi tạo master buffer và đặt câu vào đúng mốc start_pts.
    """
    out_path = Path(output_path).resolve()
    raw_text = (target_cue.translated_text or target_cue.source_text).strip()
    cleaned_text = clean_subtitle_text(raw_text)
    if not cleaned_text:
        raise ValueError(f"Câu phụ đề {target_cue.cue_id} không có nội dung văn bản hợp lệ để lồng tiếng.")

    logger.info(f"Đang sinh giọng TTS câu đơn {target_cue.cue_id} [{voice}] qua [{provider}]...")
    mp3_res = await synthesize_text(
        cleaned_text,
        voice=voice,
        rate=rate,
        provider=provider,
        prompt_style=prompt_style,
    )
    if not mp3_res:
        raise ValueError(f"Không nhận được dữ liệu âm thanh từ dịch vụ TTS cho câu {target_cue.cue_id}.")

    if cue_output_path:
        c_path = Path(cue_output_path).resolve()
        c_path.parent.mkdir(parents=True, exist_ok=True)
        c_path.write_bytes(mp3_res)

    pcm_samples = _decode_mp3_to_pcm(mp3_res, sample_rate=sample_rate)
    if len(pcm_samples) == 0:
        raise ValueError("Không thể giải mã âm thanh câu phụ đề sang PCM.")

    # Co giãn khớp slot thời gian (1.0x -> 1.45x)
    speech_dur = len(pcm_samples) / sample_rate
    slot_dur = max(0.0, target_cue.end_pts - target_cue.start_pts)
    speed_factor = calculate_slot_stretch(
        speech_dur, slot_dur, min_rate=1.0, max_rate=max_stretch_rate
    )
    if speed_factor > 1.02:
        pcm_samples = time_stretch_pcm(pcm_samples, speed_factor=speed_factor, sample_rate=sample_rate)

    # Nạp master buffer hiện có hoặc tạo mới
    if out_path.exists() and out_path.stat().st_size > 1024:
        try:
            master_buffer = _decode_mp3_to_pcm(out_path.read_bytes(), sample_rate=sample_rate)
        except Exception:
            master_buffer = np.array([], dtype=np.float32)
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

    # Mã hóa và lưu lại file MP3 master
    _encode_pcm_to_mp3(master_buffer, out_path, sample_rate=sample_rate)
    logger.info(f"Đã vá thành công âm thanh câu {target_cue.cue_id} vào {out_path.name}")

    return {
        "status": "completed",
        "cue_id": target_cue.cue_id,
        "voice": voice,
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

