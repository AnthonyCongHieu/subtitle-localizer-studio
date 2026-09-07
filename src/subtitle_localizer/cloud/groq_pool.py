"""Groq Key Pool: Quản lý và điều phối xoay tua tự động API Keys cho Groq Cloud Whisper.

Hỗ trợ:
- Tự động xoay tua Round-Robin chia đều tải các API Keys.
- Tự động cách ly (cooldown) các key dính lỗi HTTP 429 Rate Limit.
- Tự động khôi phục key khi hết hạn cách ly.
- Tự động nạp/lưu từ file groq_keys_pool.json.
- Thread-safe đa luồng.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import threading
import time
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

DEFAULT_GROQ_KEY_POOL_FILE = Path("groq_keys_pool.json")


def mask_groq_key(key: str) -> str:
    """Che giấu ký tự API Key Groq để hiển thị an toàn trên Web UI và log."""
    k = key.strip()
    if len(k) >= 12:
        return f"{k[:7]}...{k[-4:]}"
    return "***"


class GroqKeyPool:
    """Bộ quản lý và điều phối xoay tua Groq API Keys tự động."""

    def __init__(self, keys: Optional[List[str]] = None) -> None:
        self._lock = threading.Lock()
        self._keys: List[str] = []
        self._current_index: int = 0
        self._cooldowns: Dict[str, float] = {}  # key -> timestamp hết hạn cooldown
        self._reasons: Dict[str, str] = {}     # key -> lý do cách ly
        self._health: Dict[str, Dict[str, Any]] = {}  # key -> kết quả verify gần nhất

        if keys:
            self.load_keys(keys)

    @property
    def total_keys(self) -> int:
        with self._lock:
            return len(self._keys)

    def load_keys(self, raw_keys: List[str]) -> None:
        """Nạp danh sách keys, chuẩn hóa và loại bỏ trùng lặp."""
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

    def load_from_file(self, file_path: Path | str = DEFAULT_GROQ_KEY_POOL_FILE) -> bool:
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
                lines = [line.strip() for line in content.splitlines() if line.strip()]
                self.load_keys(lines)
                return True
        except Exception as exc:
            logger.warning("Không thể đọc Groq pool keys từ %s: %s", p, exc)
        return False

    def save_to_file(self, file_path: Path | str = DEFAULT_GROQ_KEY_POOL_FILE) -> bool:
        """Lưu danh sách keys xuống file JSON."""
        p = Path(file_path).resolve()
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            with self._lock:
                keys_to_save = list(self._keys)
            p.write_text(json.dumps(keys_to_save, indent=2, ensure_ascii=False), encoding="utf-8")
            return True
        except Exception as exc:
            logger.error("Không thể lưu Groq pool keys ra %s: %s", p, exc)
            return False

    def mark_rate_limited(
        self,
        key: str,
        cooldown_seconds: float = 60.0,
        reason: str = "Groq Rate Limit (429)",
    ) -> None:
        """Đưa key vào trạng thái Cooldown trong khoảng thời gian quy định."""
        with self._lock:
            if key in self._keys:
                exp = time.time() + max(1.0, cooldown_seconds)
                self._cooldowns[key] = exp
                self._reasons[key] = reason
                logger.info(
                    "Key %s bị đưa vào cooldown %.1fs. Lý do: %s",
                    mask_groq_key(key),
                    cooldown_seconds,
                    reason,
                )

    def is_usable(self, key: str) -> bool:
        """Kiểm tra key có đang sẵn sàng sử dụng (không bị cooldown) hay không."""
        with self._lock:
            exp = self._cooldowns.get(key, 0.0)
            return time.time() >= exp

    def get_next_key(self, wait_timeout: float = 0.0) -> Optional[str]:
        """Lấy key khả dụng tiếp theo theo thuật toán Round-Robin."""
        start_wait = time.time()
        while True:
            with self._lock:
                if not self._keys:
                    return None

                total = len(self._keys)
                now = time.time()

                # Quét 1 vòng tròn bắt đầu từ _current_index
                for offset in range(total):
                    idx = (self._current_index + offset) % total
                    cand_key = self._keys[idx]
                    exp = self._cooldowns.get(cand_key, 0.0)
                    if now >= exp:
                        self._current_index = (idx + 1) % total
                        return cand_key

                # Nếu tất cả keys đều bị cooldown
                min_exp = min(self._cooldowns.values()) if self._cooldowns else now
                sleep_needed = max(0.1, min_exp - now)

            # Kiểm tra thời gian chờ tối đa
            if wait_timeout <= 0.0 or (time.time() - start_wait + sleep_needed) > wait_timeout:
                return None

            time.sleep(min(sleep_needed, 1.0))

    def get_status(self) -> Dict[str, Any]:
        """Trả về thống kê chi tiết trạng thái của toàn bộ Key Pool."""
        with self._lock:
            now = time.time()
            items = []
            active_cnt = 0
            cooldown_cnt = 0

            for idx, k in enumerate(self._keys):
                exp = self._cooldowns.get(k, 0.0)
                reason = self._reasons.get(k, "")
                remaining = max(0.0, exp - now)
                is_ready = remaining == 0.0

                if is_ready:
                    active_cnt += 1
                    status = "active"
                    status_label = "Sẵn sàng"
                else:
                    cooldown_cnt += 1
                    status = "cooldown"
                    status_label = f"Tạm nghỉ ({int(remaining)}s)"

                health = self._health.get(k, {})

                items.append({
                    "index": idx,
                    "masked_key": mask_groq_key(k),
                    "is_usable": is_ready,
                    "status": status,
                    "status_label": status_label,
                    "remaining_seconds": int(remaining),
                    "reason": reason,
                    "latency_ms": health.get("latency_ms"),
                    "last_checked": health.get("last_checked"),
                    "message": health.get("message", ""),
                })

            return {
                "total_keys": len(self._keys),
                "active_keys": active_cnt,
                "cooldown_keys": cooldown_cnt,
                "items": items,
            }

    def verify_key(self, key: str, timeout: int = 8) -> Dict[str, Any]:
        """Kiểm tra tính hợp lệ của key bằng cách gọi API Groq Models."""
        t0 = time.time()
        try:
            resp = requests.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {key}"},
                timeout=timeout,
            )
            latency_ms = int((time.time() - t0) * 1000)
            if resp.status_code == 200:
                result = {
                    "ok": True,
                    "status": "active",
                    "status_label": "Hoạt động tốt",
                    "latency_ms": latency_ms,
                    "message": "Kết nối thành công",
                }
            elif resp.status_code == 401:
                result = {
                    "ok": False,
                    "status": "invalid",
                    "status_label": "Key không hợp lệ",
                    "latency_ms": latency_ms,
                    "message": "Groq báo HTTP 401 Unauthorized",
                }
            elif resp.status_code == 429:
                result = {
                    "ok": False,
                    "status": "cooldown",
                    "status_label": "Đang bị Rate Limit",
                    "latency_ms": latency_ms,
                    "message": "Hết lượt truy cập tạm thời (429)",
                }
                self.mark_rate_limited(key, cooldown_seconds=60.0, reason="Verify dính 429")
            else:
                result = {
                    "ok": False,
                    "status": "error",
                    "status_label": f"Lỗi HTTP {resp.status_code}",
                    "latency_ms": latency_ms,
                    "message": resp.text[:80],
                }
        except Exception as exc:
            latency_ms = int((time.time() - t0) * 1000)
            result = {
                "ok": False,
                "status": "network_error",
                "status_label": "Lỗi kết nối",
                "latency_ms": latency_ms,
                "message": str(exc)[:80],
            }

        result["last_checked"] = int(time.time())
        with self._lock:
            self._health[key] = result
        return result

    def verify_all_keys(self) -> Dict[str, Any]:
        """Kiểm tra đồng loạt tất cả các keys trong Pool."""
        with self._lock:
            keys_copy = list(self._keys)

        for k in keys_copy:
            self.verify_key(k)
        return self.get_status()

    def verify_key_by_index(self, index: int) -> Optional[Dict[str, Any]]:
        """Kiểm tra sức khỏe 1 key theo chỉ số vị trí (hỗ trợ cả 0-based và 1-based)."""
        with self._lock:
            target_idx = -1
            if 0 <= index < len(self._keys):
                target_idx = index
            elif 1 <= index <= len(self._keys):
                target_idx = index - 1

            if target_idx < 0 or target_idx >= len(self._keys):
                return None
            key = self._keys[target_idx]
        return self.verify_key(key)

    def delete_key(self, index: int) -> bool:
        """Xóa một key theo chỉ số vị trí (hỗ trợ cả 0-based index và 1-based index)."""
        with self._lock:
            target_idx = -1
            if 0 <= index < len(self._keys):
                target_idx = index
            elif 1 <= index <= len(self._keys):
                target_idx = index - 1

            if target_idx >= 0 and target_idx < len(self._keys):
                k = self._keys.pop(target_idx)
                self._cooldowns.pop(k, None)
                self._reasons.pop(k, None)
                self._health.pop(k, None)
                if self._current_index >= len(self._keys):
                    self._current_index = 0
                return True
        return False


# Singleton toàn cục
_global_groq_pool: Optional[GroqKeyPool] = None


def get_global_groq_pool() -> GroqKeyPool:
    """Lấy thể hiện Singleton toàn cục của GroqKeyPool."""
    global _global_groq_pool
    if _global_groq_pool is None:
        _global_groq_pool = GroqKeyPool()
        _global_groq_pool.load_from_file(DEFAULT_GROQ_KEY_POOL_FILE)

        # Nếu file chưa có key nhưng có biến môi trường GROQ_API_KEY thì nạp vào
        if _global_groq_pool.total_keys == 0:
            env_key = os.environ.get("GROQ_API_KEY", "").strip()
            if env_key:
                _global_groq_pool.load_keys([env_key])
                _global_groq_pool.save_to_file(DEFAULT_GROQ_KEY_POOL_FILE)

    return _global_groq_pool
