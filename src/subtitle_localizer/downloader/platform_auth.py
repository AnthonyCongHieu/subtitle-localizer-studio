"""Platform Authentication and Session Management for Subtitle Localizer Studio.

Manages platform credentials (cookies, tokens) for Bilibili, Xiaohongshu,
Douyin, YouTube, etc. Supports In-App QR Code Login for Bilibili and
exporting to standard Netscape HTTP Cookie files for yt-dlp.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

COOKIE_DOMAINS = {
    "bilibili": ".bilibili.com",
    "xiaohongshu": ".xiaohongshu.com",
    "douyin": ".douyin.com",
    "youtube": ".youtube.com",
    "hongguo": ".hongguoduanju.com",
}


class PlatformAuthManager:
    """Quản lý thông tin xác thực và phiên đăng nhập của các nền tảng."""

    def __init__(
        self,
        storage_path: Optional[Path | str] = None,
        cookie_store_path: Optional[Path | str] = None,
    ) -> None:
        target = storage_path or cookie_store_path
        if target:
            self.storage_file = Path(target).resolve()
        else:
            base_dir = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local")) / "SubtitleLocalizerStudio"
            base_dir.mkdir(parents=True, exist_ok=True)
            self.storage_file = base_dir / "platform_cookies.json"
        
        self._temp_files: List[str] = []
        self._cache: Dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if self.storage_file.exists():
            try:
                self._cache = json.loads(self.storage_file.read_text(encoding="utf-8"))
            except Exception as e:
                logger.warning(f"Failed to read platform cookies: {e}")
                self._cache = {}
        else:
            self._cache = {}

    def _save(self) -> None:
        try:
            self.storage_file.parent.mkdir(parents=True, exist_ok=True)
            self.storage_file.write_text(
                json.dumps(self._cache, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
        except Exception as e:
            logger.error(f"Failed to write platform cookies: {e}")

    def save_cookie(self, platform: str, cookie_str: str, user_info: Optional[Dict[str, Any]] = None) -> None:
        """Lưu trữ cookie cho nền tảng cụ thể."""
        p = platform.lower().strip()
        cookie_clean = cookie_str.strip()
        if not cookie_clean:
            return
        
        self._cache[p] = {
            "cookie": cookie_clean,
            "updated_at": time.time(),
            "user_info": user_info or {},
        }
        self._save()

    def get_cookie(self, platform: str) -> Optional[str]:
        """Lấy chuỗi cookie đã lưu của nền tảng."""
        p = platform.lower().strip()
        item = self._cache.get(p)
        if isinstance(item, dict):
            return item.get("cookie")
        elif isinstance(item, str):
            return item
        return None

    def get_user_info(self, platform: str) -> Dict[str, Any]:
        """Lấy thông tin tài khoản (nếu có)."""
        p = platform.lower().strip()
        item = self._cache.get(p)
        if isinstance(item, dict):
            return item.get("user_info") or {}
        return {}

    def delete_cookie(self, platform: str) -> bool:
        """Xóa thông tin đăng nhập của nền tảng."""
        p = platform.lower().strip()
        if p in self._cache:
            del self._cache[p]
            self._save()
            return True
        return False

    def list_auth_status(self) -> Dict[str, Any]:
        """Tổng hợp trạng thái đăng nhập của toàn bộ các nền tảng."""
        platforms = ["bilibili", "xiaohongshu", "douyin", "youtube"]
        res = {}
        for p in platforms:
            item = self._cache.get(p)
            has_cookie = bool(item and (isinstance(item, dict) and item.get("cookie") or isinstance(item, str)))
            user_info = item.get("user_info", {}) if isinstance(item, dict) else {}
            res[p] = {
                "logged_in": has_cookie,
                "platform": p,
                "username": user_info.get("uname") or user_info.get("username") or "",
                "avatar": user_info.get("avatar") or "",
                "is_vip": bool(user_info.get("is_vip", False)),
                "vip_label": user_info.get("vip_label", ""),
                "updated_at": item.get("updated_at") if isinstance(item, dict) else None,
            }
        return {
            "platforms": res,
            "accountless_capabilities": {
                "bilibili": "Guest Fingerprint (buvid3/buvid4) + Wbi Sign (720p/480p không cần đăng nhập)",
                "xiaohongshu": "Origin Video Key Direct CDN ByteDance (1080p không logo watermark)",
                "hongguo": "Virtual Device Identity CENC Bypass (100% mở khóa VIP không cần đăng nhập)",
                "youtube": "Web Embedded & Android Client Emulation (1080p - 4K không cần đăng nhập Google)",
                "douyin": "Direct Play URL 1080p No Watermark (không cần đăng nhập)",
            },
            **res,
        }

    def create_temp_netscape_cookie_file(self, platform: str, target_url: Optional[str] = None) -> Optional[str]:
        """Xuất cookie ra tệp định dạng Netscape chuẩn cho yt-dlp."""
        raw_cookie = self.get_cookie(platform)
        if not raw_cookie:
            return None

        p = platform.lower().strip()
        domain = COOKIE_DOMAINS.get(p)
        if not domain and target_url:
            host = urllib.parse.urlparse(target_url).netloc
            domain = f".{host}" if not host.startswith(".") else host

        if not domain:
            domain = f".{p}.com"

        fd, temp_path = tempfile.mkstemp(prefix=f"sls_cookie_{p}_", suffix=".txt", text=True)
        try:
            with open(fd, "w", encoding="utf-8", newline="\n") as f:
                f.write("# Netscape HTTP Cookie File\n")
                f.write("# Generated automatically by Subtitle Localizer Studio\n\n")
                for part in raw_cookie.split(";"):
                    if "=" not in part:
                        continue
                    name, val = part.strip().split("=", 1)
                    if not name.strip():
                        continue
                    # Format: domain \t TRUE \t / \t TRUE \t expires \t name \t value
                    f.write(f"{domain}\tTRUE\t/\tTRUE\t2147483647\t{name.strip()}\t{val.strip()}\n")
            self._temp_files.append(temp_path)
            return temp_path
        except Exception as e:
            logger.warning(f"Error creating Netscape cookie file: {e}")
            try:
                os.remove(temp_path)
            except OSError:
                pass
            return None

    def cleanup_temp_files(self) -> None:
        """Dọn dẹp các file cookie tạm."""
        for path in self._temp_files:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                pass
        self._temp_files.clear()

    # -------------------------------------------------------------------------
    # Bilibili Official QR Code Authentication Engine
    # -------------------------------------------------------------------------

    def generate_bilibili_qr(self) -> Dict[str, Any]:
        """Khởi tạo phiên đăng nhập QR Bilibili chính thức.

        API: https://passport.bilibili.com/x/passport-login/web/qrcode/generate
        Trả về { url: str, qrcode_key: str }
        """
        api_url = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate"
        req = urllib.request.Request(api_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        
        if data.get("code") != 0:
            raise RuntimeError(f"Lỗi tạo mã QR Bilibili: {data.get('message')}")
        
        qr_data = data.get("data", {})
        return {
            "url": qr_data.get("url", ""),
            "qrcode_key": qr_data.get("qrcode_key", ""),
        }

    def poll_bilibili_qr(self, qrcode_key: str) -> Dict[str, Any]:
        """Kiểm tra trạng thái quét mã QR Bilibili.

        Mã phản hồi từ Bilibili:
          0: Đăng nhập thành công (Thừa hưởng Cookies)
          86101: Chưa quét mã (Unscanned)
          86090: Đã quét nhưng chưa xác nhận trên điện thoại (Scanned, unconfirmed)
          86038: Mã QR đã hết hạn (Expired)
        """
        if not qrcode_key:
            raise ValueError("qrcode_key không được để trống.")

        api_url = f"https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key={urllib.parse.quote(qrcode_key)}"
        req = urllib.request.Request(api_url, headers={"User-Agent": USER_AGENT})
        
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8")
            data = json.loads(content)
            headers_info = resp.info()

        qr_data = data.get("data", {})
        code = qr_data.get("code", -1)
        msg = qr_data.get("message", "Chưa rõ trạng thái")

        if code == 0:
            # Thành công: Bóc tách toàn bộ cookie từ Header Set-Cookie
            set_cookies = headers_info.get_all("Set-Cookie") or []
            cookie_dict = {}
            for item in set_cookies:
                part = item.split(";")[0]
                if "=" in part:
                    k, v = part.split("=", 1)
                    cookie_dict[k.strip()] = v.strip()

            cookie_str = "; ".join([f"{k}={v}" for k, v in cookie_dict.items()])
            
            # Lấy thông tin user (VIP status, username, avatar)
            user_info = self._fetch_bilibili_user_nav(cookie_str)
            self.save_cookie("bilibili", cookie_str, user_info=user_info)

            return {
                "status": "confirmed",
                "code": 0,
                "message": "Đăng nhập thành công!",
                "user_info": user_info,
            }
        elif code == 86090:
            return {
                "status": "scanned",
                "code": 86090,
                "message": "Đã quét mã! Vui lòng bấm Xác nhận trên điện thoại.",
            }
        elif code == 86101:
            return {
                "status": "waiting",
                "code": 86101,
                "message": "Đang chờ quét mã QR...",
            }
        elif code == 86038:
            return {
                "status": "expired",
                "code": 86038,
                "message": "Mã QR đã hết hạn, vui lòng tạo mã mới.",
            }
        else:
            return {
                "status": "error",
                "code": code,
                "message": msg,
            }

    def _fetch_bilibili_user_nav(self, cookie_str: str) -> Dict[str, Any]:
        """Gọi API /x/web-interface/nav để lấy thông tin tài khoản Bilibili."""
        try:
            req = urllib.request.Request(
                "https://api.bilibili.com/x/web-interface/nav",
                headers={
                    "User-Agent": USER_AGENT,
                    "Cookie": cookie_str,
                    "Referer": "https://www.bilibili.com/",
                }
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if data.get("code") == 0:
                user_data = data.get("data", {})
                vip_info = user_data.get("vip", {})
                is_vip = vip_info.get("status") == 1
                vip_label = vip_info.get("label", {}).get("text", "") or ("VIP" if is_vip else "Thành viên thường")
                return {
                    "mid": user_data.get("mid"),
                    "uname": user_data.get("uname"),
                    "avatar": user_data.get("face"),
                    "is_vip": is_vip,
                    "vip_label": vip_label,
                    "money": user_data.get("money"),
                }
        except Exception as e:
            logger.warning(f"Error fetching Bilibili user nav: {e}")
        return {}

    def ensure_bilibili_guest_cookies(self) -> str:
        """Tự động sinh cookie khách (buvid3/buvid4) cho Bilibili nếu chưa có tài khoản."""
        existing = self.get_cookie("bilibili")
        if existing and ("SESSDATA=" in existing or "buvid3=" in existing):
            return existing
        
        try:
            req = urllib.request.Request(
                "https://api.bilibili.com/x/frontend/finger/spi",
                headers={
                    "User-Agent": USER_AGENT,
                    "Referer": "https://www.bilibili.com/",
                }
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                spi_data = data.get("data", {})
                b3 = spi_data.get("b_3", "")
                b4 = spi_data.get("b_4", "")
                if b3:
                    guest_cookie = f"buvid3={b3}; buvid4={b4}"
                    self.save_cookie("bilibili_guest", guest_cookie)
                    return guest_cookie
        except Exception as e:
            logger.warning(f"Failed to generate Bilibili guest cookie: {e}")
        
        fallback = "buvid3=8F84950A-DE47-0D44-7C78-5C4D3960CA7C92461infoc"
        return fallback


platform_auth = PlatformAuthManager()
