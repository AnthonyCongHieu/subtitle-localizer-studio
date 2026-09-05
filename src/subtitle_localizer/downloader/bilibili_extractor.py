"""Bilibili Wbi Signer, Video Stream Prober, and Searcher for Subtitle Localizer Studio.

Implements pure-Python Wbi signing, DASH stream quality probing,
and search without external dependencies.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
    61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
    36, 20, 34, 44, 52
]

QUALITY_LABELS = {
    127: "8K Ultra HD",
    120: "4K Ultra HD",
    116: "1080p60 (Full HD 60fps)",
    112: "1080p+ (Full HD Cao Cấp)",
    80: "1080p (Full HD)",
    64: "720p (HD)",
    32: "480p (SD)",
    16: "360p (Mượt)",
}


def get_mixin_key(orig: str) -> str:
    """Tạo mixin key từ img_key + sub_key."""
    return "".join([orig[i] for i in MIXIN_KEY_ENC_TAB])[:32]


def sign_wbi(params: Dict[str, Any], img_key: str, sub_key: str) -> Dict[str, Any]:
    """Ký số Wbi cho Bilibili API thuần Python."""
    mixin_key = get_mixin_key(img_key + sub_key)
    curr_time = int(time.time())
    signed_params = dict(params)
    signed_params["wts"] = curr_time
    sorted_params = dict(sorted(signed_params.items()))
    query = urllib.parse.urlencode({
        k: "".join(filter(lambda c: c not in "!'()*", str(v)))
        for k, v in sorted_params.items()
    })
    w_rid = hashlib.md5((query + mixin_key).encode("utf-8")).hexdigest()
    sorted_params["w_rid"] = w_rid
    return sorted_params


def fetch_wbi_keys(cookie: Optional[str] = None, proxy: Optional[str] = None) -> Tuple[str, str]:
    """Lấy img_key và sub_key từ /x/web-interface/nav."""
    url = "https://api.bilibili.com/x/web-interface/nav"
    headers = {"User-Agent": USER_AGENT, "Referer": "https://www.bilibili.com/"}
    if cookie:
        headers["Cookie"] = cookie.strip()
    
    req = urllib.request.Request(url, headers=headers)
    opener = urllib.request.build_opener()
    if proxy and str(proxy).strip():
        opener.add_handler(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))

    try:
        with opener.open(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            wbi_img = data.get("data", {}).get("wbi_img", {})
            img_url = wbi_img.get("img_url", "")
            sub_url = wbi_img.get("sub_url", "")
            img_key = img_url.rsplit("/", 1)[-1].split(".")[0]
            sub_key = sub_url.rsplit("/", 1)[-1].split(".")[0]
            if img_key and sub_key:
                return img_key, sub_key
    except Exception as e:
        logger.warning(f"Failed to fetch Bilibili Wbi keys: {e}")

    # Fallback keys dự phòng
    return "7cd084481338484ba0e08a3381b7382d", "499b6d6532464183ac370f633633d31f"


def extract_bvid(url_or_target: str) -> Optional[str]:
    """Trích xuất bvid (ví dụ BV1xx411c7mD) từ URL hoặc chuỗi ký tự."""
    m = re.search(r'(BV[0-9a-zA-Z]{10})', url_or_target)
    if m:
        return m.group(1)
    return None


def filter_videos_by_topic(
    videos: List[Dict[str, Any]],
    must_contain: Optional[str] = None,
    must_not_contain: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Lọc danh sách video theo từ khóa bắt buộc chứa và từ khóa loại trừ."""
    contain_words = [w.strip().lower() for w in (must_contain or "").split(",") if w.strip()]
    exclude_words = [w.strip().lower() for w in (must_not_contain or "").split(",") if w.strip()]

    if not contain_words and not exclude_words:
        return videos

    filtered = []
    for v in videos:
        title = (v.get("title") or "").lower()
        title_vi = (v.get("title_vi") or "").lower()
        desc = (v.get("description") or "").lower()
        author = (v.get("author") or "").lower()
        combined = f"{title} {title_vi} {desc} {author}"

        if contain_words:
            if not any(word in combined for word in contain_words):
                continue
        if exclude_words:
            if any(word in combined for word in exclude_words):
                continue
        filtered.append(v)
    return filtered


def search_bilibili_videos(
    keyword: str,
    cookie: Optional[str] = None,
    proxy: Optional[str] = None,
    page: int = 1,
    order: str = "totalrank",
    duration: int = 0,
    must_contain: Optional[str] = None,
    must_not_contain: Optional[str] = None,
    auto_translate: bool = True,
    translate_titles: bool = True,
) -> List[Dict[str, Any]]:
    """Tìm kiếm video trên Bilibili theo từ khóa sử dụng API chính thức có chữ ký Wbi."""
    kw = keyword.strip()
    if not kw:
        return []

    actual_kw = kw
    if auto_translate:
        try:
            from subtitle_localizer.downloader.translator import translate_text
            if re.search(r"[a-zA-Zà-ỹÀ-Ỹ]", kw):
                trans_kw = translate_text(kw, target_lang="zh-CN")
                if trans_kw and trans_kw.strip():
                    actual_kw = trans_kw.strip()
        except Exception:
            pass

    img_key, sub_key = fetch_wbi_keys(cookie=cookie, proxy=proxy)
    params: Dict[str, Any] = {
        "keyword": actual_kw,
        "search_type": "video",
        "page": page,
        "page_size": 20,
        "order": order or "totalrank",
    }
    if duration and duration in (1, 2, 3, 4):
        params["duration"] = duration

    signed = sign_wbi(params, img_key, sub_key)
    query_str = urllib.parse.urlencode(signed)
    api_url = f"https://api.bilibili.com/x/web-interface/wbi/search/type?{query_str}"

    headers = {
        "User-Agent": USER_AGENT,
        "Referer": "https://www.bilibili.com/",
        "Accept": "application/json",
    }
    if cookie and str(cookie).strip():
        headers["Cookie"] = cookie.strip()

    req = urllib.request.Request(api_url, headers=headers)
    opener = urllib.request.build_opener()
    if proxy and str(proxy).strip():
        opener.add_handler(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))

    results = []
    try:
        with opener.open(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("code") == 0:
                raw_list = data.get("data", {}).get("result", [])
                for item in raw_list:
                    clean_title = re.sub(r'<[^>]+>', '', item.get("title", "")).strip()
                    bvid = item.get("bvid", "")
                    pic = item.get("pic", "")
                    if pic.startswith("//"):
                        pic = f"https:{pic}"
                    
                    results.append({
                        "id": bvid,
                        "bvid": bvid,
                        "url": f"https://www.bilibili.com/video/{bvid}",
                        "title": clean_title,
                        "title_vi": clean_title,
                        "pic": pic,
                        "duration": item.get("duration", "00:00"),
                        "author": item.get("author", ""),
                        "play": item.get("play", 0),
                        "danmaku": item.get("danmaku", 0),
                        "pubdate": item.get("pubdate", 0),
                        "description": item.get("description", ""),
                        "platform": "bilibili",
                    })
    except Exception as e:
        logger.warning(f"Error searching Bilibili: {e}")

    if translate_titles and results:
        try:
            from subtitle_localizer.downloader.translator import translate_titles_batch
            raw_titles = [r["title"] for r in results]
            vi_titles = translate_titles_batch(raw_titles, target_lang="vi")
            for idx, r in enumerate(results):
                if idx < len(vi_titles) and vi_titles[idx]:
                    r["title_vi"] = vi_titles[idx]
        except Exception:
            pass

    results = filter_videos_by_topic(results, must_contain=must_contain, must_not_contain=must_not_contain)
    return results


def probe_bilibili_video_details(
    bvid_or_url: str,
    cookie: Optional[str] = None,
    proxy: Optional[str] = None,
) -> Dict[str, Any]:
    """Lấy chi tiết video Bilibili, danh sách tập/pages và các độ phân giải khả dụng."""
    bvid = extract_bvid(bvid_or_url)
    if not bvid:
        raise ValueError(f"Không tìm thấy BV id hợp lệ trong: {bvid_or_url}")

    headers = {
        "User-Agent": USER_AGENT,
        "Referer": "https://www.bilibili.com/",
        "Accept": "application/json",
    }
    if cookie and str(cookie).strip():
        headers["Cookie"] = cookie.strip()

    opener = urllib.request.build_opener()
    if proxy and str(proxy).strip():
        opener.add_handler(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))

    img_key, sub_key = fetch_wbi_keys(cookie=cookie, proxy=proxy)

    # 1. Gọi /x/web-interface/wbi/view với chữ ký Wbi để tránh lỗi 412
    view_params = {"bvid": bvid}
    signed_view = sign_wbi(view_params, img_key, sub_key)
    view_url = f"https://api.bilibili.com/x/web-interface/wbi/view?{urllib.parse.urlencode(signed_view)}"
    req_view = urllib.request.Request(view_url, headers=headers)
    with opener.open(req_view, timeout=12) as resp:
        view_data = json.loads(resp.read().decode("utf-8"))

    if view_data.get("code") != 0:
        raise ValueError(f"Không thể đọc thông tin video Bilibili ({bvid}): {view_data.get('message')}")

    data = view_data.get("data", {})
    title = data.get("title", bvid)
    pic = data.get("pic", "")
    if pic.startswith("//"):
        pic = f"https:{pic}"
    cid = data.get("cid")
    pages = data.get("pages", [])
    author = data.get("owner", {}).get("name", "")
    duration = data.get("duration", 0)

    # 2. Thẩm định độ phân giải khả dụng qua /x/player/wbi/playurl
    resolutions = []
    if cid:
        try:
            play_params = {
                "bvid": bvid,
                "cid": cid,
                "qn": 127,      # Yêu cầu chất lượng cao nhất khả dụng
                "fnval": 4048,  # DASH streams format
                "fourk": 1,
            }
            signed_play = sign_wbi(play_params, img_key, sub_key)
            play_url = f"https://api.bilibili.com/x/player/wbi/playurl?{urllib.parse.urlencode(signed_play)}"
            req_play = urllib.request.Request(play_url, headers=headers)
            with opener.open(req_play, timeout=12) as play_resp:
                play_data = json.loads(play_resp.read().decode("utf-8"))
            
            if play_data.get("code") == 0:
                p_data = play_data.get("data", {})
                accept_quality = p_data.get("accept_quality", [])
                accept_description = p_data.get("accept_description", [])
                
                # Ánh xạ chất lượng
                for qn, desc in zip(accept_quality, accept_description):
                    label = QUALITY_LABELS.get(qn, desc or f"Quality {qn}")
                    h = 1080
                    if qn >= 120:
                        h = 2160
                    elif qn >= 80:
                        h = 1080
                    elif qn >= 64:
                        h = 720
                    elif qn >= 32:
                        h = 480
                    else:
                        h = 360

                    resolutions.append({
                        "id": f"{h}p" if qn < 116 else f"{h}p60" if qn == 116 else f"{h}p",
                        "height": h,
                        "qn": qn,
                        "label": label,
                        "size_mb": 0,
                        "fps": 60 if qn == 116 else 30,
                    })
        except Exception as exc:
            logger.warning(f"Error probing Bilibili playurl: {exc}")

    if not resolutions:
        resolutions = [
            {"id": "best", "height": 1080, "label": "Chất lượng cao nhất (Tự động)", "size_mb": 0, "fps": 30},
            {"id": "1080p", "height": 1080, "label": "1080p (Full HD)", "size_mb": 0, "fps": 30},
            {"id": "720p", "height": 720, "label": "720p (HD)", "size_mb": 0, "fps": 30},
            {"id": "480p", "height": 480, "label": "480p (SD)", "size_mb": 0, "fps": 30},
            {"id": "360p", "height": 360, "label": "360p", "size_mb": 0, "fps": 30},
        ]

    return {
        "platform": "bilibili",
        "source_platform": "bilibili",
        "url": f"https://www.bilibili.com/video/{bvid}",
        "bvid": bvid,
        "cid": cid,
        "title": title,
        "cover_url": pic,
        "duration": duration,
        "total_episodes": len(pages) if len(pages) > 1 else 1,
        "episodes": pages,
        "uploader": author,
        "ext": "mp4",
        "resolutions": resolutions,
    }


def search_youtube_videos(
    keyword: str,
    max_results: int = 16,
    proxy: Optional[str] = None,
    must_contain: Optional[str] = None,
    must_not_contain: Optional[str] = None,
    translate_titles: bool = True,
) -> List[Dict[str, Any]]:
    """Tìm kiếm video YouTube theo từ khóa và trả về danh sách kết quả chuẩn hóa."""
    keyword = str(keyword).strip()
    if not keyword:
        return []

    ydl_opts = {
        "extract_flat": True,
        "quiet": True,
        "skip_download": True,
        "no_warnings": True,
        "ignoreerrors": True,
    }
    if proxy and str(proxy).strip():
        ydl_opts["proxy"] = proxy.strip()

    try:
        import yt_dlp
        ydl = yt_dlp.YoutubeDL(ydl_opts)
        query = f"ytsearch{max_results}:{keyword}"
        info = ydl.extract_info(query, download=False)
        if not info:
            return []

        entries = info.get("entries") or []
        results = []
        for e in entries:
            if not e or not isinstance(e, dict):
                continue
            vid_id = e.get("id") or e.get("url")
            if not vid_id:
                continue

            thumbs = e.get("thumbnails") or []
            pic = ""
            if thumbs:
                pic = thumbs[-1].get("url") or ""
            if not pic and vid_id:
                pic = f"https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg"

            dur_str = e.get("duration_string") or ""
            if not dur_str and e.get("duration"):
                d = int(e["duration"])
                mins, secs = divmod(d, 60)
                hrs, mins = divmod(mins, 60)
                if hrs > 0:
                    dur_str = f"{hrs:02d}:{mins:02d}:{secs:02d}"
                else:
                    dur_str = f"{mins:02d}:{secs:02d}"

            results.append({
                "id": vid_id,
                "url": f"https://www.youtube.com/watch?v={vid_id}",
                "title": e.get("title") or vid_id,
                "title_vi": e.get("title") or vid_id,
                "pic": pic,
                "duration": dur_str,
                "author": e.get("channel") or e.get("uploader") or "YouTube",
                "play": e.get("view_count"),
                "description": e.get("description") or "",
                "platform": "youtube",
            })

        if translate_titles and results:
            try:
                from subtitle_localizer.downloader.translator import translate_titles_batch
                raw_titles = [r["title"] for r in results]
                vi_titles = translate_titles_batch(raw_titles, target_lang="vi")
                for idx, r in enumerate(results):
                    if idx < len(vi_titles) and vi_titles[idx]:
                        r["title_vi"] = vi_titles[idx]
            except Exception:
                pass

        results = filter_videos_by_topic(results, must_contain=must_contain, must_not_contain=must_not_contain)
        return results
    except Exception as exc:
        logger.warning(f"Error searching YouTube with keyword '{keyword}': {exc}")
        return []

