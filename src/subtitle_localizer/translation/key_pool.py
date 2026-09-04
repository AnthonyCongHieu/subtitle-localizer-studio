from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def mask_api_key(key: str) -> str:
    """Che giấu phần lớn ký tự của API key để hiển thị an toàn trên giao diện hoặc log."""
    k = key.strip()
    if len(k) >= 12:
        return f"{k[:6]}...{k[-4:]}"
    return "***"


class GeminiKeyPool:
    """
    Bộ quản lý và điều phối xoay tua Pool API Keys Gemini Free.
    - Xoay tua Round-Robin đều qua tất cả các keys để chia đều hạn mức 15 RPM.
    - Tự động cách ly (cooldown) các keys gặp lỗi 429 Rate Limit (mặc định 60 giây).
    - Hỗ trợ cách ly dài hạn (4 giờ) cho keys hết quota ngày (RPD 1,500 req/ngày).
    - Tự động khôi phục key khi hết thời gian cooldown.
    - Đảm bảo an toàn đa luồng (Thread-safe).
    """

    def __init__(self, keys: Optional[List[str]] = None) -> None:
        self._lock = threading.Lock()
        self._keys: List[str] = []
        self._current_index: int = 0
        self._cooldowns: Dict[str, float] = {}  # key -> timestamp hết cooldown
        self._reasons: Dict[str, str] = {}     # key -> lý do cooldown
        self._health: Dict[str, Dict[str, Any]] = {}  # key -> kết quả health check gần nhất

        if keys:
            self.load_keys(keys)

    @property
    def total_keys(self) -> int:
        with self._lock:
            return len(self._keys)

    def load_keys(self, raw_keys: List[str]) -> None:
        """Nạp danh sách keys, loại bỏ khoảng trắng và trùng lặp."""
        with self._lock:
            cleaned: List[str] = []
            seen = set()
            for k in raw_keys:
                if isinstance(k, str):
                    trimmed = k.strip()
                    if trimmed and trimmed not in seen:
                        cleaned.append(trimmed)
                        seen.add(trimmed)
            self._keys = cleaned
            active_set = set(self._keys)
            self._cooldowns = {k: exp for k, exp in self._cooldowns.items() if k in active_set}
            self._reasons = {k: r for k, r in self._reasons.items() if k in active_set}
            self._health = {k: h for k, h in self._health.items() if k in active_set}
            if self._current_index >= len(self._keys):
                self._current_index = 0

    def load_from_file(self, file_path: Path | str) -> bool:
        """Đọc danh sách keys từ file JSON hoặc TXT."""
        p = Path(file_path).resolve()
        if not p.exists():
            return False
        try:
            content = p.read_text(encoding="utf-8").strip()
            if content.startswith("["):
                raw_list = json.loads(content)
                if isinstance(raw_list, list):
                    self.load_keys(raw_list)
                    return True
            else:
                lines = [l.strip() for l in content.splitlines() if l.strip()]
                self.load_keys(lines)
                return True
        except Exception as e:
            logger.warning(f"Không thể đọc pool keys từ {p}: {e}")
        return False

    def save_to_file(self, file_path: Path | str) -> bool:
        """Lưu danh sách keys ra file JSON."""
        p = Path(file_path).resolve()
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            with self._lock:
                keys_to_save = list(self._keys)
            p.write_text(json.dumps(keys_to_save, indent=2), encoding="utf-8")
            return True
        except Exception as e:
            logger.error(f"Không thể lưu pool keys ra {p}: {e}")
            return False

    def mark_rate_limited(
        self,
        key: str,
        cooldown_seconds: float = 60.0,
        reason: str = "rate_limit_exceeded",
    ) -> None:
        """Đưa key vào danh sách tạm nghỉ (cooldown)."""
        with self._lock:
            if key in self._keys:
                self._cooldowns[key] = time.time() + cooldown_seconds
                self._reasons[key] = reason
                logger.info(
                    f"Key {mask_api_key(key)} được đưa vào Cooldown {cooldown_seconds:.0f}s (Lý do: {reason})"
                )

    def mark_daily_quota_exhausted(self, key: str) -> None:
        """Đánh dấu key đã hết hạn mức ngày (RPD), cách ly 4 tiếng."""
        self.mark_rate_limited(key, cooldown_seconds=14400.0, reason="daily_quota_exhausted")

    def _cleanup_expired_cooldowns(self, now: float) -> None:
        expired = [k for k, expire_time in self._cooldowns.items() if now >= expire_time]
        for k in expired:
            del self._cooldowns[k]
            self._reasons.pop(k, None)
            logger.info(f"Key {mask_api_key(k)} đã hết thời gian Cooldown và trở lại hoạt động")

    def get_next_key(self, wait_timeout: float = 0.0) -> Optional[str]:
        """
        Lấy key tiếp theo theo cơ chế Round-Robin thông minh:
        - Tự động bỏ qua các key đang trong thời gian Cooldown.
        - Nếu tất cả các keys đều bận và có wait_timeout, chờ cho đến khi key gần nhất hết hạn.
        """
        start_time = time.time()

        while True:
            with self._lock:
                if not self._keys:
                    return None

                now = time.time()
                self._cleanup_expired_cooldowns(now)

                n = len(self._keys)
                # Quét 1 vòng từ _current_index để tìm key khả dụng đầu tiên
                for offset in range(n):
                    idx = (self._current_index + offset) % n
                    candidate = self._keys[idx]
                    if candidate not in self._cooldowns:
                        # Tìm thấy key khả dụng: Cập nhật current_index cho lần sau và trả về
                        self._current_index = (idx + 1) % n
                        return candidate

                # Nếu toàn bộ keys đều đang trong cooldown:
                earliest_cooldown = min(self._cooldowns.values()) if self._cooldowns else now
                remaining_wait = max(0.0, earliest_cooldown - now)

            # Kiểm tra xem có thể chờ tiếp không
            elapsed = time.time() - start_time
            if remaining_wait <= 0.0 or elapsed + remaining_wait > wait_timeout:
                if wait_timeout > 0:
                    time.sleep(min(0.1, wait_timeout - elapsed))
                return None

            # Ngủ chờ đúng khoảng thời gian cần thiết để key gần nhất hồi sinh
            sleep_chunk = min(remaining_wait + 0.05, wait_timeout - elapsed)
            if sleep_chunk <= 0:
                return None
            time.sleep(sleep_chunk)

    def get_status(self) -> Dict[str, Any]:
        """Trả về bảng trạng thái chi tiết của Key Pool kèm danh sách từng key và tình trạng sử dụng."""
        with self._lock:
            now = time.time()
            self._cleanup_expired_cooldowns(now)

            total = len(self._keys)
            cooldown_count = len(self._cooldowns)
            active_count = max(0, total - cooldown_count)

            masked = [mask_api_key(k) for k in self._keys]
            cooldown_details = {}
            for k, exp in self._cooldowns.items():
                idx_prefix = f"Key #{self._keys.index(k) + 1} " if k in self._keys else ""
                key_label = f"{idx_prefix}({mask_api_key(k)})"
                cooldown_details[key_label] = {
                    "remaining_seconds": round(max(0.0, exp - now), 1),
                    "reason": self._reasons.get(k, "rate_limit"),
                }

            items = []
            for idx, k in enumerate(self._keys):
                in_cooldown = k in self._cooldowns
                exp = self._cooldowns.get(k, 0.0)
                rem = round(max(0.0, exp - now), 1) if in_cooldown else 0.0
                reason = self._reasons.get(k, "") if in_cooldown else ""
                health = self._health.get(k, {})

                if reason.startswith("invalid") or health.get("status") == "invalid":
                    st = "invalid"
                    lbl = "Lỗi / Vô hiệu"
                    usable = False
                elif in_cooldown:
                    if reason == "daily_quota_exhausted":
                        st = "daily_exhausted"
                        lbl = "Hết quota ngày"
                    else:
                        st = "cooldown"
                        lbl = f"Tạm nghỉ 429 ({rem}s)"
                    usable = False
                else:
                    st = "active"
                    lbl = "Khả dụng"
                    usable = True

                items.append({
                    "index": idx + 1,
                    "masked_key": mask_api_key(k),
                    "is_usable": usable,
                    "status": st,
                    "status_label": lbl,
                    "remaining_seconds": rem,
                    "reason": reason,
                    "latency_ms": health.get("latency_ms"),
                    "last_checked": health.get("last_checked"),
                    "message": health.get("message", ""),
                })

            return {
                "total_keys": total,
                "active_keys": active_count,
                "cooldown_keys": cooldown_count,
                "masked_keys": masked,
                "cooldown_details": cooldown_details,
                "items": items,
            }

    def check_key_health(self, key: str, timeout: float = 6.0) -> Dict[str, Any]:
        """Kiểm tra thực tế trạng thái hoạt động của key đối với Google Gemini API."""
        import urllib.request
        import urllib.error

        t0 = time.time()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}"
        payload = json.dumps({
            "contents": [{"parts": [{"text": "hi"}]}],
            "generationConfig": {"maxOutputTokens": 1}
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})

        result: Dict[str, Any] = {
            "masked_key": mask_api_key(key),
            "last_checked": time.time(),
        }

        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status_code = getattr(resp, "status", getattr(resp, "code", 200))
                latency_ms = round((time.time() - t0) * 1000, 1)
                result.update({
                    "status": "ok",
                    "status_label": "Khả dụng",
                    "latency_ms": latency_ms,
                    "message": f"Hoạt động tốt ({latency_ms}ms)",
                })
                with self._lock:
                    self._cooldowns.pop(key, None)
                    self._reasons.pop(key, None)
                    self._health[key] = result
                return result
        except urllib.error.HTTPError as err:
            latency_ms = round((time.time() - t0) * 1000, 1)
            err_body = ""
            try:
                err_body = err.read().decode("utf-8", errors="ignore").lower()
            except Exception:
                pass

            if err.code == 429:
                if any(t in err_body for t in ("per day", "daily", "requestsperday", "rpd")):
                    self.mark_daily_quota_exhausted(key)
                    result.update({
                        "status": "daily_exhausted",
                        "status_label": "Hết quota ngày",
                        "latency_ms": latency_ms,
                        "message": "Đã chạm hạn ngạch ngày (1,500 RPD)",
                    })
                else:
                    self.mark_rate_limited(key, cooldown_seconds=60.0, reason="rate_limit_exceeded")
                    result.update({
                        "status": "cooldown",
                        "status_label": "Tạm nghỉ 429",
                        "latency_ms": latency_ms,
                        "message": "Nghẽn RPM 15 req/phút (60s)",
                    })
            elif err.code in (400, 403):
                self.mark_rate_limited(key, cooldown_seconds=86400.0 * 365, reason="invalid_key")
                result.update({
                    "status": "invalid",
                    "status_label": "Không hợp lệ",
                    "latency_ms": latency_ms,
                    "message": f"Lỗi xác thực HTTP {err.code} (Key sai/bị khóa)",
                })
            else:
                result.update({
                    "status": "error",
                    "status_label": f"HTTP {err.code}",
                    "latency_ms": latency_ms,
                    "message": f"HTTP {err.code}: {err.reason}",
                })
            with self._lock:
                self._health[key] = result
            return result
        except Exception as e:
            latency_ms = round((time.time() - t0) * 1000, 1)
            result.update({
                "status": "network_error",
                "status_label": "Lỗi mạng",
                "latency_ms": latency_ms,
                "message": str(e),
            })
            with self._lock:
                self._health[key] = result
            return result

    def verify_all_keys(self, max_workers: int = 8) -> List[Dict[str, Any]]:
        """Kiểm tra sức khỏe song song toàn bộ các keys trong pool."""
        from concurrent.futures import ThreadPoolExecutor, as_completed

        with self._lock:
            keys_snapshot = list(self._keys)

        if not keys_snapshot:
            return []

        results = []
        with ThreadPoolExecutor(max_workers=min(max_workers, len(keys_snapshot))) as executor:
            future_to_key = {executor.submit(self.check_key_health, k): k for k in keys_snapshot}
            for future in as_completed(future_to_key):
                try:
                    res = future.result()
                    results.append(res)
                except Exception as ex:
                    results.append({"status": "error", "message": str(ex)})
        return results

    def verify_key_by_index(self, index: int) -> Optional[Dict[str, Any]]:
        """Kiểm tra sức khỏe 1 key theo số thứ tự (1-based index)."""
        with self._lock:
            if index < 1 or index > len(self._keys):
                return None
            key = self._keys[index - 1]
        return self.check_key_health(key)

    def remove_key_by_index(self, index: int) -> bool:
        """Xóa 1 key khỏi pool theo thứ tự (1-based index)."""
        with self._lock:
            if index < 1 or index > len(self._keys):
                return False
            removed_key = self._keys.pop(index - 1)
            self._cooldowns.pop(removed_key, None)
            self._reasons.pop(removed_key, None)
            self._health.pop(removed_key, None)
            if self._current_index >= len(self._keys):
                self._current_index = 0
            return True


_GLOBAL_GEMINI_POOL: Optional[GeminiKeyPool] = None
_GLOBAL_POOL_LOCK = threading.Lock()


def get_global_gemini_pool() -> GeminiKeyPool:
    """Lấy instance GeminiKeyPool toàn cục, tự động nạp từ gemini_keys_pool.json hoặc biến môi trường."""
    global _GLOBAL_GEMINI_POOL
    with _GLOBAL_POOL_LOCK:
        if _GLOBAL_GEMINI_POOL is None:
            pool = GeminiKeyPool()
            # 1. Thử nạp từ file pool chuẩn
            candidate_files = [
                Path("gemini_keys_pool.json"),
                Path(__file__).resolve().parents[3] / "gemini_keys_pool.json",
                Path.cwd() / "gemini_keys_pool.json",
                Path.cwd() / "uploads" / "gemini_keys_pool.json",
            ]
            for cf in candidate_files:
                if cf.exists() and pool.load_from_file(cf):
                    logger.info(f"Đã nạp {pool.total_keys} keys từ {cf}")
                    break

            # 2. Thêm GEMINI_API_KEY từ env nếu có
            env_key = os.environ.get("GEMINI_API_KEY", "").strip()
            if env_key:
                with pool._lock:
                    if env_key not in pool._keys:
                        pool._keys.insert(0, env_key)

            _GLOBAL_GEMINI_POOL = pool
        return _GLOBAL_GEMINI_POOL
