"""Module tích hợp CapCut / ByteDance TTS (Text-to-Speech) Cloud API.

Cơ chế:
- Pure Python 100% không phụ thuộc DLL/C++ binaries.
- Mô phỏng Guest Device Identity (không cần tài khoản, mật khẩu hay cookie).
- Tự động ký request với thuật toán bảo mật CapCut PC (sign MD5, x-ss-stub, x-tt-trace-id, RSA PKCS#1 v1.5 SSML sign).
- Trích xuất luồng âm thanh MP3 trực tiếp từ CDN ByteDance.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import random
import secrets
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import urllib.request
import urllib.error
from urllib.parse import urlencode

logger = logging.getLogger(__name__)

BASE_URL = "https://editor-api-sg.capcutapi.com"

# Public key RSA được trích xuất từ CapCut Desktop để mã hóa payload SSML
TTS_SIGN_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmTd34Lw4b7IuldSXh/zY
CMla+ITdGG5TeWz6ad+OySd4r+IrY45AoqrYUxhQ2dl+7z+i7r/5vEa8rr39BYfB
8AGMQLmZA8HmgpWBsqrn/V6daUALkKnkLb70Fn32CJigIuGXAYqxUdGuI340aC+0
v5Es3puJsHyzf01/AelE4Cdc6bZhQrASJLBh8R3BQToYClmDVSDUQk28o8sl/guA
Z4n303Vj+6Siv1HayPCdV6kpVVnMBAG4+umUbwGmn132N3fgpzLarFF3XyWmS1zh
D/J07iM/rP8GDO9IskHNHd2phrO0G6KzrcFAnTBHjVv+hCBEfzN/no3FNA9AuC36
mwIDAQAB
-----END PUBLIC KEY-----"""

DEFAULT_DEVICE: Dict[str, str] = {
    "aid": "359289",
    "app_name": "CapCut",
    "appvr": "8.7.0",
    "version_name": "8.7.0",
    "version_code": "8.7.0",
    "channel": "capcutpc_google",
    "device_platform": "mac",
    "device_type": "MacBookPro17,4",
    "device_brand": "MacBookPro17,4",
    "os_version": "15.7.4",
    "device_id": "76471456455646328721",
    "iid": "76471456455646328721",
    "region": "VN",
    "loc": "VN",
    "lan": "vi-VN",
    "pf": "3",
    "tdid": "76471456455646328721",
}

_CAPCUT_VOICES_FILE = Path(__file__).resolve().parent / "capcut_voices.json"

# Danh mục giọng CapCut dự phòng tối thiểu nếu thiếu file JSON
_FALLBACK_CAPCUT_VOICE_CATALOG: List[Dict[str, Any]] = [
    # --- TIẾNG VIỆT ---
    {
        "voice_id": "BV075_streaming",
        "display_name": "Thanh Niên Tự Tin",
        "lang": "vi",
        "gender": "male",
        "description": "Giọng nam năng động, tự tin, phát âm chuẩn, phù hợp review phim và truyện tranh.",
        "tags": ["Nam sôi nổi", "Review phim", "TikTok Hot"],
        "resource_id": "7102355803792740865",
    },
    {
        "voice_id": "BV074_streaming",
        "display_name": "Cô Gái Hoạt Ngôn",
        "lang": "vi",
        "gender": "female",
        "description": "Giọng nữ hoạt bát, tươi sáng, biểu cảm tốt, rất cuốn hút người xem.",
        "tags": ["Nữ trẻ trung", "Kể chuyện", "TikTok Hot"],
        "resource_id": "7102355709945188865",
    },
    {
        "voice_id": "BV421_vivn_streaming",
        "display_name": "Nhỏ Ngọt Ngào",
        "lang": "vi",
        "gender": "female",
        "description": "Giọng nữ nhẹ nhàng, ngọt ngào, ấm áp, phù hợp tâm sự, vlog và tóm tắt phim tình cảm.",
        "tags": ["Nữ ngọt ngào", "Tâm sự", "Truyền cảm"],
        "resource_id": "7252594014782755330",
    },
    {
        "voice_id": "BV562_streaming",
        "display_name": "Mai (Thuyết Minh)",
        "lang": "vi",
        "gender": "female",
        "description": "Giọng nữ thanh lịch, phát âm chuẩn đài truyền hình, thuyết minh tài liệu chuyên nghiệp.",
        "tags": ["Nữ thanh lịch", "Thuyết minh", "Chuẩn đài"],
        "resource_id": "7483736254694035984",
    },
    {
        "voice_id": "vi_female_huong",
        "display_name": "Giọng Nữ Phổ Thông (Hương)",
        "lang": "vi",
        "gender": "female",
        "description": "Giọng nữ phổ thông miền Bắc, rõ ràng, dễ nghe, phù hợp tin tức tổng hợp.",
        "tags": ["Nữ phổ thông", "Tin tức", "Miền Bắc"],
        "resource_id": "7264854897953083905",
    },
    {
        "voice_id": "BV560_streaming",
        "display_name": "Alex Đại Đế",
        "lang": "vi",
        "gender": "male",
        "description": "Giọng nam trầm ấm, quyền uy, cực kỳ phù hợp phim hành động, khoa học viễn tưởng.",
        "tags": ["Nam trầm", "Hành động", "Kịch tính"],
        "resource_id": "7483736167565758992",
    },
    {
        "voice_id": "BV075_streaming_vibrato_dsp",
        "display_name": "Việt Méo (Hài Hước)",
        "lang": "vi",
        "gender": "male",
        "description": "Giọng rung ngân độc lạ, hài hước, giải trí cao độ cho meme và clip ngắn.",
        "tags": ["Hài hước", "Parody", "Độc lạ"],
        "resource_id": "7569450639810465040",
    },
    {
        "voice_id": "BV074_streaming_dsp",
        "display_name": "Giọng Bé Nhí Nhảnh",
        "lang": "vi",
        "gender": "female",
        "description": "Giọng trẻ em dễ thương, ngộ nghĩnh, dùng cho nội dung thiếu nhi hoạt hình.",
        "tags": ["Trẻ em", "Hoạt hình", "Dễ thương"],
        "resource_id": "7550087831092251920",
    },
    {
        "voice_id": "multi_female_peiqi_uranus_bigtts",
        "display_name": "Giọng Gái Mới Lớn",
        "lang": "vi",
        "gender": "female",
        "description": "Giọng nữ trẻ trung, điệu đà, phong cách Gen Z năng động.",
        "tags": ["Gen Z", "Điệu đà", "Nữ sinh"],
        "resource_id": "7637458789033151751",
    },
    {
        "voice_id": "multi_female_tianmeijieshuo_uranus_bigtts",
        "display_name": "Nữ Thuyết Minh Ngọt Ngào",
        "lang": "vi",
        "gender": "female",
        "description": "Giọng nữ thuyết minh chuyên nghiệp cho các phim ngắn, drama gia đình.",
        "tags": ["Thuyết minh", "Drama", "Kể chuyện"],
        "resource_id": "7637460417295469832",
    },
    # --- ENGLISH ---
    {
        "voice_id": "ICL_en_male_philosopher_dsp",
        "display_name": "Narrator (Cinematic Deep)",
        "lang": "en",
        "gender": "male",
        "description": "Deep, authoritative cinematic narrator voice. Perfect for movie recaps and documentaries.",
        "tags": ["Cinematic", "Deep", "Narrator"],
        "resource_id": "7525722920161725712",
    },
    {
        "voice_id": "DiT_en_female_jessie",
        "display_name": "Jessie (TikTok Viral)",
        "lang": "en",
        "gender": "female",
        "description": "The iconic, upbeat viral female TikTok voice recognized worldwide.",
        "tags": ["TikTok Iconic", "Viral", "Upbeat"],
        "resource_id": "7564325260414160129",
    },
    {
        "voice_id": "en_male_deadpool",
        "display_name": "Deadpool (Witty & Comic)",
        "lang": "en",
        "gender": "male",
        "description": "Sarcastic, humorous, energetic voice full of attitude and personality.",
        "tags": ["Comic", "Sarcastic", "Hero"],
        "resource_id": "7231025912261644802",
    },
    {
        "voice_id": "en_female_emotional_moon_bigtts",
        "display_name": "Emotional Drama",
        "lang": "en",
        "gender": "female",
        "description": "Highly expressive female voice with dramatic nuances and emotional range.",
        "tags": ["Emotional", "Drama", "Storytelling"],
        "resource_id": "7114563483257016833",
    },
    {
        "voice_id": "en_female_soothing_mars_bigtts",
        "display_name": "Female Teacher (Soothing)",
        "lang": "en",
        "gender": "female",
        "description": "Warm, gentle, clear and soothing educational storytelling voice.",
        "tags": ["Soothing", "Warm", "Educational"],
        "resource_id": "7526754143369760016",
    },
    {
        "voice_id": "en_us_002",
        "display_name": "EN US Standard Male",
        "lang": "en",
        "gender": "male",
        "description": "Clean, broadcast-grade standard American male voice.",
        "tags": ["Standard", "Broadcast", "American"],
        "resource_id": "7130515992936976897",
    },
    {
        "voice_id": "en_female_sherry",
        "display_name": "Sherry (Natural Chat)",
        "lang": "en",
        "gender": "female",
        "description": "Casual, friendly conversational American female voice.",
        "tags": ["Casual", "Friendly", "Natural"],
        "resource_id": "7278146554844680706",
    },
]


def _load_capcut_catalog() -> List[Dict[str, Any]]:
    """Tải danh mục 127 giọng đầy đủ từ capcut_voices.json hoặc dự phòng _FALLBACK_CAPCUT_VOICE_CATALOG."""
    if _CAPCUT_VOICES_FILE.exists():
        try:
            with open(_CAPCUT_VOICES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    return data
        except Exception as err:
            logger.warning("Không thể đọc file %s: %s", _CAPCUT_VOICES_FILE, err)
    return _FALLBACK_CAPCUT_VOICE_CATALOG


CAPCUT_VOICE_CATALOG: List[Dict[str, Any]] = _load_capcut_catalog()

# Map voice_id sang resource_id để tra cứu nhanh
_RESOURCE_ID_MAP: Dict[str, str] = {
    v["voice_id"]: v["resource_id"] for v in CAPCUT_VOICE_CATALOG if "resource_id" in v
}
_VOICE_INFO_MAP: Dict[str, Dict[str, Any]] = {
    str(v.get("voice_id") or ""): v for v in CAPCUT_VOICE_CATALOG if v.get("voice_id")
}

_SSML_LOCALES: Dict[str, str] = {
    "vi": "vi-VN",
    "en": "en-US",
    "zh": "zh-CN",
    "ja": "ja-JP",
    "th": "th-TH",
    "id": "id-ID",
    "fr": "fr-FR",
    "es": "es-ES",
    "de": "de-DE",
    "pt": "pt-BR",
    "ko": "ko-KR",
}


class CapCutTTSRequestError(RuntimeError):
    """Lỗi provider xác định, không nên retry cùng một request."""


def _is_success_ret(value: Any) -> bool:
    """Chấp nhận mã thành công dạng số hoặc chuỗi, nhưng không coi thiếu mã là thành công."""
    return value is not None and str(value).strip() == "0"


def _sanitize_xml_text(text: str) -> str:
    normalized = unicodedata.normalize("NFC", str(text or ""))
    return "".join(
        char
        for char in normalized
        if char in "\t\n\r"
        or 0x20 <= ord(char) <= 0xD7FF
        or 0xE000 <= ord(char) <= 0xFFFD
        or 0x10000 <= ord(char) <= 0x10FFFF
    )


def _ssml_locale(language: Any) -> str:
    raw = str(language or "").strip()
    if not raw:
        return "en-US"
    if "-" in raw:
        return raw
    return _SSML_LOCALES.get(raw.lower(), "en-US")


def _compact_json(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _make_x_ss_stub(body_text: str) -> str:
    return hashlib.md5(body_text.encode("utf-8")).hexdigest()


def _make_trace_id() -> str:
    seed = secrets.token_hex(16)
    return f"00-{seed}-{seed[:16]}-01"


def _escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _make_sign_header(url: str, appvr: str, device_time: str, tdid: str) -> str:
    path = url.split("?", 1)[0]
    sign_str = f"9e2c|{path[-7:]}|3|{appvr}|{device_time}|{tdid}|11ac"
    return hashlib.md5(sign_str.encode("utf-8")).hexdigest()


def _der_len(data: bytes, pos: int) -> Tuple[int, int]:
    first = data[pos]
    pos += 1
    if first < 0x80:
        return first, pos
    nbytes = first & 0x7F
    return int.from_bytes(data[pos : pos + nbytes], "big"), pos + nbytes


def _der_value(data: bytes, pos: int, tag: int) -> Tuple[bytes, int]:
    if data[pos] != tag:
        raise ValueError(f"Bad DER tag: expected 0x{tag:02x}, got 0x{data[pos]:02x}")
    length, pos = _der_len(data, pos + 1)
    return data[pos : pos + length], pos + length


def _der_int(data: bytes, pos: int) -> Tuple[int, int]:
    raw, pos = _der_value(data, pos, 0x02)
    return int.from_bytes(raw.lstrip(b"\x00"), "big"), pos


def _rsa_public_numbers_from_pem(pem: str) -> Tuple[int, int]:
    b64 = "".join(line for line in pem.splitlines() if not line.startswith("-----"))
    der = base64.b64decode(b64)
    outer, pos = _der_value(der, 0, 0x30)
    _, pos = _der_value(outer, 0, 0x30)
    bit_string, pos = _der_value(outer, pos, 0x03)
    rsa_seq, pos = _der_value(bit_string[1:], 0, 0x30)
    modulus, pos = _der_int(rsa_seq, 0)
    exponent, pos = _der_int(rsa_seq, pos)
    return modulus, exponent


def _rsa_encrypt_pkcs1v15(message: Union[str, bytes], pem: str = TTS_SIGN_PUBLIC_KEY_PEM) -> str:
    modulus, exponent = _rsa_public_numbers_from_pem(pem)
    key_len = (modulus.bit_length() + 7) // 8
    msg = message.encode("utf-8") if isinstance(message, str) else bytes(message)
    if len(msg) > key_len - 11:
        raise ValueError("Message too long for RSA PKCS#1 v1.5 padding")
    ps_len = key_len - len(msg) - 3
    ps = bytearray()
    while len(ps) < ps_len:
        chunk = secrets.token_bytes(ps_len - len(ps))
        ps.extend(b for b in chunk if b != 0)
    encoded = b"\x00\x02" + bytes(ps[:ps_len]) + b"\x00" + msg
    encrypted = pow(int.from_bytes(encoded, "big"), exponent, modulus).to_bytes(key_len, "big")
    return base64.b64encode(encrypted).decode("ascii")


def _make_tts_payload_sign(ssml: str, extra_info: Optional[str], device_id: str, app_id: str) -> str:
    ssml_md5 = hashlib.md5(ssml.encode("utf-8")).hexdigest()
    sign_input = f"appid:{app_id}&did:{device_id}&creditDisable:false&ssml:{ssml_md5}"
    if extra_info is not None:
        sign_input += f"&extraInfo:{extra_info}"
    return _rsa_encrypt_pkcs1v15(sign_input)


class CapCutTTSClient:
    """Client kết nối trực tiếp đám mây ByteDance CapCut TTS không cần tài khoản."""

    def __init__(self, endpoint: str = BASE_URL, device: Optional[Dict[str, str]] = None) -> None:
        self.endpoint = (endpoint or BASE_URL).rstrip("/")
        self.device = device or dict(DEFAULT_DEVICE)

    def resolve_voice_info(self, voice: str) -> Tuple[str, str, str]:
        """Chuẩn hóa voice_type, resource_id và locale ngôn ngữ tương ứng."""
        v = str(voice or "").strip()
        if v in _VOICE_INFO_MAP:
            item = _VOICE_INFO_MAP[v]
            return v, str(item["resource_id"]), _ssml_locale(item.get("lang"))
        # Thử tìm theo display_name
        v_lower = v.lower()
        for item in CAPCUT_VOICE_CATALOG:
            if str(item.get("display_name") or "").lower() == v_lower:
                return str(item["voice_id"]), str(item["resource_id"]), _ssml_locale(item.get("lang"))
        # Mặc định về Thanh Niên Tự Tin nếu không khớp
        default_v = "BV075_streaming"
        item = _VOICE_INFO_MAP.get(default_v, {})
        return (
            default_v,
            str(item.get("resource_id") or "7102355803792740865"),
            _ssml_locale(item.get("lang") or "vi"),
        )

    def build_tts_request(
        self,
        text: str,
        voice: str = "BV075_streaming",
        rate: str = "1.0",
    ) -> Tuple[str, Dict[str, str], str]:
        """Tạo URL, Headers và Request Body JSON cho tác vụ tạo giọng đọc mới."""
        voice_type, resource_id, ssml_locale = self.resolve_voice_info(voice)
        clean_rate = str(rate).replace("%", "").strip()
        try:
            # Chuyển đổi +10% -> 1.1 hoặc 1.0
            if clean_rate.startswith("+"):
                rate_val = 1.0 + float(clean_rate[1:]) / 100.0
                rate_str = f"{rate_val:.2f}"
            elif clean_rate.startswith("-"):
                rate_val = max(0.5, 1.0 - float(clean_rate[1:]) / 100.0)
                rate_str = f"{rate_val:.2f}"
            else:
                rate_str = str(float(clean_rate))
        except Exception:
            rate_str = "1.0"

        babi = {
            "feature_entrance": "editor",
            "feature_entrance_detail": "editor-feature-text_to_speech",
            "feature_key": "text_to_speech",
            "scenario": "video_editor",
        }

        escaped = _escape_xml(_sanitize_xml_text(text).strip())
        ssml = (
            f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{ssml_locale}">\n'
            f'    <voice name="{voice_type}" mock_tone_info="" platform="sami" '
            f'resource_id="{resource_id}" emotion="" emotion_scale="0" style="" role="" '
            f'moyin_emotion="" is_clone_tone="false" need_subtitle_timestamp="false">\n'
            f'        <prosody rate="{rate_str}">{escaped}</prosody>\n'
            f"    </voice>\n"
            f"</speak>"
        )

        extra_info = _compact_json({"benefit_info": {}})
        payload = {
            "audio_format": "mp3",
            "babi_param": _compact_json(babi),
            "credit_disable": False,
            "extra_info": extra_info,
            "need_merge_voice": False,
            "need_subtitle_timestamp": False,
            "scene": "text_to_speech",
            "ssml": ssml,
        }
        payload["sign"] = _make_tts_payload_sign(
            ssml, extra_info, self.device["device_id"], self.device["aid"]
        )

        body = {
            "bind_id": secrets.token_hex(16),
            "can_queue": True,
            "enter_from": "text_to_speech",
            "tasks": [
                {
                    "context": secrets.token_hex(16),
                    "payload": _compact_json(payload),
                    "req_key": "sami_text_to_speech",
                    "task_version": "v3",
                }
            ],
        }

        body_text = _compact_json(body)
        device_time = str(int(time.time()))
        query_params = {
            "app_name": self.device["app_name"],
            "device_type": self.device["device_type"],
            "os_version": self.device["os_version"],
            "channel": self.device["channel"],
            "version_name": self.device["version_name"],
            "device_brand": self.device.get("device_brand", self.device["device_type"]),
            "device_id": self.device["device_id"],
            "iid": self.device.get("iid", self.device["device_id"]),
            "version_code": self.device.get("version_code", self.device["version_name"]),
            "device_platform": self.device["device_platform"],
            "aid": self.device["aid"],
            "region": self.device["region"],
            "babi_param": _compact_json(babi),
        }
        path = "/lv/v1/common_task/new"
        url = f"{self.endpoint}{path}?{urlencode(query_params)}"

        headers = {
            "content-type": "application/json",
            "appvr": self.device["appvr"],
            "ch": self.device["channel"],
            "device-time": device_time,
            "lan": self.device["lan"],
            "loc": self.device["loc"],
            "pf": self.device.get("pf", "3"),
            "sign-ver": "1",
            "tdid": self.device["tdid"],
            "x-ss-stub": _make_x_ss_stub(body_text),
            "x-ss-dp": self.device["aid"],
            "x-khronos": device_time,
            "x-tt-trace-id": _make_trace_id(),
            "user-agent": "Cronet/TTNetVersion:1d7cc3b1 2025-07-16 QuicVersion:52c2b40d 2025-04-03",
            "accept-encoding": "gzip, deflate",
            "store-country-code": self.device.get("loc", "VN").lower(),
            "store-country-code-src": "did",
            "is-dispatch-us-ttp": "0",
            "is-app-region-us-ttp": "0",
            "app-sdk-version": self.device["appvr"],
            "appid": self.device["aid"],
            "sign": _make_sign_header(url, self.device["appvr"], device_time, self.device["tdid"]),
        }

        return url, headers, body_text

    def build_query_request(self, task_id: str, token: str) -> Tuple[str, Dict[str, str], str]:
        """Tạo URL, Headers và Request Body JSON để kiểm tra trạng thái tác vụ TTS."""
        body = {
            "tasks": [
                {
                    "bind_id": "",
                    "id": task_id,
                    "req_key": "sami_text_to_speech",
                    "task_version": "v3",
                    "token": token,
                }
            ]
        }
        body_text = _compact_json(body)
        device_time = str(int(time.time()))
        query_params = {
            "app_name": self.device["app_name"],
            "device_type": self.device["device_type"],
            "os_version": self.device["os_version"],
            "channel": self.device["channel"],
            "version_name": self.device["version_name"],
            "device_brand": self.device.get("device_brand", self.device["device_type"]),
            "device_id": self.device["device_id"],
            "iid": self.device.get("iid", self.device["device_id"]),
            "version_code": self.device.get("version_code", self.device["version_name"]),
            "device_platform": self.device["device_platform"],
            "aid": self.device["aid"],
        }
        path = "/lv/v1/common_task/query"
        url = f"{self.endpoint}{path}?{urlencode(query_params)}"

        headers = {
            "content-type": "application/json",
            "appvr": self.device["appvr"],
            "ch": self.device["channel"],
            "device-time": device_time,
            "lan": self.device["lan"],
            "loc": self.device["loc"],
            "pf": self.device.get("pf", "3"),
            "sign-ver": "1",
            "tdid": self.device["tdid"],
            "x-ss-stub": _make_x_ss_stub(body_text),
            "x-ss-dp": self.device["aid"],
            "x-khronos": device_time,
            "x-tt-trace-id": _make_trace_id(),
            "user-agent": "Cronet/TTNetVersion:1d7cc3b1 2025-07-16 QuicVersion:52c2b40d 2025-04-03",
            "accept-encoding": "gzip, deflate",
            "store-country-code": self.device.get("loc", "VN").lower(),
            "store-country-code-src": "did",
            "is-dispatch-us-ttp": "0",
            "is-app-region-us-ttp": "0",
            "app-sdk-version": self.device["appvr"],
            "appid": self.device["aid"],
            "sign": _make_sign_header(url, self.device["appvr"], device_time, self.device["tdid"]),
        }
        return url, headers, body_text

    @staticmethod
    def _provider_error(response: Dict[str, Any], prefix: str) -> CapCutTTSRequestError:
        code = next(
            (
                value
                for key in ("err_code", "error_code", "ret")
                if (value := response.get(key)) is not None
            ),
            "unknown",
        )
        message = response.get("err_msg") or response.get("errmsg") or response.get("message") or response
        return CapCutTTSRequestError(f"{prefix} ({code}): {message}")

    @staticmethod
    def _is_retryable_error(error: Exception) -> bool:
        if isinstance(error, CapCutTTSRequestError):
            message = str(error).lower()
            # CapCut code 1000 / "system busy" is transient capacity pressure.
            # Code 810 and invalid-text errors are deterministic and should not
            # be retried: they need a different text/provider.
            return "system busy" in message or "(1000)" in message or "err_code=1000" in message
        return isinstance(error, (TimeoutError, OSError, json.JSONDecodeError, urllib.error.URLError))

    async def _synthesize_once(
        self,
        text: str,
        voice: str = "BV075_streaming",
        rate: str = "1.0",
        timeout: float = 120.0,
    ) -> bytes:
        """Gửi yêu cầu sinh giọng đọc lên đám mây CapCut và tải về dữ liệu âm thanh MP3 (bytes)."""
        clean_text = text.strip()
        if not clean_text:
            return b""

        url_new, headers_new, body_new = self.build_tts_request(clean_text, voice=voice, rate=rate)

        # 1. Gửi tác vụ tạo TTS mới
        def _post_sync(target_url: str, target_headers: Dict[str, str], payload_data: str) -> Dict[str, Any]:
            import gzip
            req = urllib.request.Request(
                target_url,
                data=payload_data.encode("utf-8"),
                headers=target_headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                if len(raw) >= 2 and raw[:2] == b"\x1f\x8b":
                    try:
                        raw = gzip.decompress(raw)
                    except Exception:
                        pass
                return json.loads(raw.decode("utf-8"))

        create_res = await asyncio.to_thread(_post_sync, url_new, headers_new, body_new)
        if not _is_success_ret(create_res.get("ret")):
            raise self._provider_error(create_res, "CapCut TTS tạo task thất bại")

        tasks = (create_res.get("data") or {}).get("tasks") or []
        if not tasks:
            raise CapCutTTSRequestError(f"CapCut TTS không trả về task hợp lệ: {create_res}")
        if not isinstance(tasks[0], dict) or not tasks[0].get("id") or not tasks[0].get("token"):
            raise CapCutTTSRequestError(f"CapCut TTS trả về task thiếu id/token: {tasks[0]}")

        task_id = str(tasks[0]["id"])
        token = str(tasks[0]["token"])

        # 2. Vòng lặp thăm dò (polling) kết quả
        start_time = time.time()
        poll_interval = 0.5

        while time.time() - start_time < timeout:
            await asyncio.sleep(poll_interval)
            url_query, headers_query, body_query = self.build_query_request(task_id, token)
            query_res = await asyncio.to_thread(_post_sync, url_query, headers_query, body_query)
            if not _is_success_ret(query_res.get("ret")):
                raise self._provider_error(query_res, "CapCut TTS truy vấn task thất bại")

            q_tasks = (query_res.get("data") or {}).get("tasks") or []
            if not q_tasks:
                continue

            status = str(q_tasks[0].get("status") or "").strip().lower()
            if status in ("success", "succeed"):
                raw_payload = q_tasks[0].get("payload") or q_tasks[0].get("resp") or "{}"
                payload_dict = json.loads(raw_payload) if isinstance(raw_payload, str) else raw_payload

                # Lấy link tải audio MP3 từ TikTok CDN
                audio_subtitles = payload_dict.get("audio_subtitles") or []
                speech_url = None
                if audio_subtitles and isinstance(audio_subtitles, list):
                    speech_url = audio_subtitles[0].get("speech_url")

                audio_url = (
                    speech_url
                    or payload_dict.get("speaker_url")
                    or payload_dict.get("audio_url")
                    or payload_dict.get("url")
                    or (payload_dict.get("audio_urls") or [None])[0]
                )

                if audio_url:
                    # Tải file âm thanh từ ByteDance CDN
                    def _download_audio(d_url: str) -> bytes:
                        req_dl = urllib.request.Request(d_url, headers={"User-Agent": "Mozilla/5.0"})
                        with urllib.request.urlopen(req_dl, timeout=60) as r:
                            return r.read()

                    audio_bytes = await asyncio.to_thread(_download_audio, audio_url)
                    if audio_bytes:
                        return audio_bytes

                # Nếu dữ liệu trả về trực tiếp dạng base64 trong payload
                if "audio" in payload_dict and payload_dict["audio"]:
                    return base64.b64decode(payload_dict["audio"])

                raise CapCutTTSRequestError(
                    f"CapCut TTS thành công nhưng không tìm thấy dữ liệu âm thanh: {payload_dict}"
                )

            elif status in ("failed", "failure", "error"):
                raise self._provider_error(q_tasks[0], "CapCut TTS task báo lỗi")

        raise TimeoutError(f"CapCut TTS hết thời gian chờ ({timeout}s) cho task {task_id}")

    async def synthesize(
        self,
        text: str,
        voice: str = "BV075_streaming",
        rate: str = "1.0",
        timeout: float = 120.0,
        max_attempts: int = 2,
    ) -> bytes:
        """Sinh MP3 và retry một lần cho lỗi kết nối/phản hồi tạm thời."""
        attempts = max(1, int(max_attempts))
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                return await self._synthesize_once(text, voice=voice, rate=rate, timeout=timeout)
            except Exception as error:
                last_error = error
                if attempt + 1 >= attempts or not self._is_retryable_error(error):
                    raise
                delay = (0.5 * (2 ** attempt)) + random.uniform(0.0, 0.25)
                logger.warning(
                    "CapCut TTS lỗi tạm thời (%s), thử lại lần %d/%d sau %.2fs",
                    type(error).__name__, attempt + 2, attempts, delay,
                )
                await asyncio.sleep(delay)
        if last_error is not None:
            raise last_error
        return b""
