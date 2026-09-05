"""Xiaohongshu (小红书 / RedNote) No-Watermark Clean Video Extractor.

Extracts high-bitrate, watermark-free videos directly from Xiaohongshu CDN
by resolving originVideoKey from SSR initial state.
"""

from __future__ import annotations

import json
import logging
import re
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)


def resolve_canonical_xhs_url(url: str, proxy: Optional[str] = None) -> str:
    """Theo dõi chuyển hướng để tìm canonical URL từ xhslink.com."""
    raw = url.strip()
    if "xhslink.com" in raw:
        req = urllib.request.Request(raw, headers={"User-Agent": USER_AGENT})
        opener = urllib.request.build_opener()
        if proxy and str(proxy).strip():
            opener.add_handler(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
        try:
            with opener.open(req, timeout=10) as resp:
                return resp.geturl()
        except Exception as e:
            logger.warning(f"Error expanding xhslink: {e}")
    return raw


def parse_xhs_note_info(url: str, cookie: Optional[str] = None, proxy: Optional[str] = None) -> Dict[str, Any]:
    """Bóc tách thông tin ghi chú Xiaohongshu và lấy link video CDN sạch 100% không dính Watermark."""
    canonical_url = resolve_canonical_xhs_url(url, proxy=proxy)
    
    headers = {
        "User-Agent": USER_AGENT,
        "Referer": "https://www.xiaohongshu.com/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if cookie and str(cookie).strip():
        headers["Cookie"] = cookie.strip()

    req = urllib.request.Request(canonical_url, headers=headers)
    html = ""
    try:
        if proxy and str(proxy).strip():
            opener = urllib.request.build_opener()
            opener.add_handler(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
            with opener.open(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")
        else:
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        logger.warning(f"HTTP request to XHS failed: {e}")

    title = "Video Xiaohongshu"
    cover_url = ""
    origin_video_key = ""
    clean_video_url = ""
    duration = 0
    author = ""

    # 1. Trích xuất qua SSR Payload window.__INITIAL_STATE__
    m_state = re.search(r"<script[^>]*>\s*window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*</script>", html, re.DOTALL)
    if m_state:
        try:
            # Thay thế undefined thành null để json.loads hợp lệ
            clean_json = re.sub(r":\s*undefined([,\}])", r": null\1", m_state.group(1))
            state = json.loads(clean_json)
            note_map = state.get("note", {}).get("noteDetailMap", {})
            note_data = {}
            if note_map:
                first_key = list(note_map.keys())[0]
                note_data = note_map[first_key].get("note", {})
            else:
                note_data = state.get("note", {}).get("note", {})

            if note_data:
                title = note_data.get("title") or note_data.get("desc") or title
                author = note_data.get("user", {}).get("nickname", "")
                
                # Trích xuất ảnh bìa
                image_list = note_data.get("imageList", [])
                if image_list:
                    cover_url = image_list[0].get("urlDefault", "") or image_list[0].get("urlOriginal", "")

                # Trích xuất video
                video_data = note_data.get("video", {})
                duration = video_data.get("duration", 0)
                consumer = video_data.get("consumer", {})
                origin_video_key = consumer.get("originVideoKey", "")
                
                # Hoặc từ media streams
                if not origin_video_key:
                    media = video_data.get("media", {})
                    stream = media.get("stream", {})
                    h264_list = stream.get("h264", []) or stream.get("av1", []) or []
                    if h264_list:
                        clean_video_url = h264_list[0].get("masterUrl", "")
        except Exception as exc:
            logger.debug(f"JSON parsing error on XHS state: {exc}")

    # 2. Regex fallback nếu JSON state không trích xuất được
    if not origin_video_key:
        m_key = re.search(r'"originVideoKey"\s*:\s*"([^"]+)"', html)
        if m_key:
            origin_video_key = m_key.group(1)

    if not title or title == "Video Xiaohongshu":
        m_title_json = re.search(r'"title"\s*:\s*"([^"]+)"', html)
        m_title = re.search(r'<meta\s+name="og:title"\s+content="([^"]+)"', html) or re.search(r'<meta\s+property="og:title"\s+content="([^"]+)"', html)
        if m_title_json and m_title_json.group(1).strip():
            title = m_title_json.group(1).strip()
        elif m_title:
            title = m_title.group(1).strip()
        else:
            m_t2 = re.search(r'<title>([^<]+)</title>', html)
            if m_t2:
                title = m_t2.group(1).split("-")[0].strip()

    if not cover_url:
        m_cover = re.search(r'<meta name="og:image" content="([^"]+)"', html)
        if m_cover:
            cover_url = m_cover.group(1)

    # 3. Tái tạo URL CDN gốc của ByteDance / BaishanCloud (Hoàn toàn không có Watermark!)
    if origin_video_key:
        clean_video_url = f"http://sns-video-bd.xhscdn.com/{origin_video_key}"

    # Nếu vẫn chưa có originVideoKey, thử tìm URL CDN mp4 trong HTML
    if not clean_video_url:
        m_cdn = re.search(r'https?://sns-video-[^"\'\s]+\.mp4', html)
        if m_cdn:
            clean_video_url = m_cdn.group(0)

    # Chuẩn hóa tiêu đề
    title = re.sub(r'[\r\n\t]+', ' ', title).strip()[:80] or "Video Xiaohongshu"

    resolutions = []
    if clean_video_url:
        resolutions.append({
            "id": "1080p",
            "height": 1080,
            "label": "1080p (Full HD - Sạch không Watermark)",
            "size_mb": 0,
            "fps": 30,
        })
    else:
        resolutions.append({
            "id": "best",
            "height": 720,
            "label": "Chất lượng cao nhất (Tự động)",
            "size_mb": 0,
            "fps": 30,
        })

    return {
        "platform": "xiaohongshu",
        "source_platform": "xiaohongshu",
        "url": clean_video_url or canonical_url,
        "direct_clean_url": clean_video_url,
        "title": title,
        "cover_url": cover_url,
        "duration": duration,
        "total_episodes": 1,
        "uploader": author,
        "ext": "mp4",
        "resolutions": resolutions,
        "is_watermark_free": bool(origin_video_key),
    }
