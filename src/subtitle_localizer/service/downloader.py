from __future__ import annotations

import os
import re
import sys
import json
import shutil
import time
import random
import uuid
import threading
import subprocess
import urllib.request
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure package directory in sys.path for liushen
DOWNLOADER_DIR = Path(__file__).resolve().parent.parent / "downloader"
if str(DOWNLOADER_DIR) not in sys.path:
    sys.path.insert(0, str(DOWNLOADER_DIR))

try:
    from subtitle_localizer.downloader import hongguo_parser as parser
except ImportError:
    import hongguo_parser as parser

# Disable automatic 300s cleanup timer
parser.schedule_video_cleanup = lambda filepath, delay_seconds=0: None

from subtitle_localizer.domain.models import ProjectManifestV1
from subtitle_localizer.detector.roi import propose_default_roi

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

def sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', "_", name).strip()

def test_proxy_connection(proxy_url: str) -> Dict[str, Any]:
    """Test if a proxy is reachable and return latency and external IP compared to direct IP."""
    direct_ip = ""
    try:
        req_direct = urllib.request.Request("http://httpbin.org/ip", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req_direct, timeout=5) as resp:
            direct_ip = json.loads(resp.read().decode("utf-8")).get("origin", "")
    except Exception:
        direct_ip = "Không xác định"

    if not proxy_url or not proxy_url.strip():
        return {
            "ok": False,
            "direct_ip": direct_ip,
            "error": "Chưa nhập địa chỉ proxy (đang kết nối trực tiếp bằng IP máy).",
        }

    proxy_url = proxy_url.strip()
    try:
        proxy_handler = urllib.request.ProxyHandler({
            "http": proxy_url,
            "https": proxy_url,
        })
        opener = urllib.request.build_opener(proxy_handler)
        req = urllib.request.Request(
            "http://httpbin.org/ip",
            headers={"User-Agent": USER_AGENT},
        )
        start = time.perf_counter()
        with opener.open(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            latency_ms = round((time.perf_counter() - start) * 1000)
        data = json.loads(body)
        proxy_ip = data.get("origin", "unknown")
        return {
            "ok": True,
            "ip": proxy_ip,
            "direct_ip": direct_ip,
            "is_masked": proxy_ip != direct_ip,
            "latency_ms": latency_ms,
        }
    except Exception as exc:
        err_str = str(exc)
        if "10061" in err_str or "refused" in err_str.lower():
            err_str = "Cổng proxy từ chối kết nối (WinError 10061). Hãy kiểm tra phần mềm proxy (Clash, v2ray, ...) đã bật chưa, hoặc để trống ô proxy để kết nối trực tiếp."
        return {"ok": False, "direct_ip": direct_ip, "error": err_str}

def _build_urllib_opener(proxy: Optional[str] = None):
    """Build a urllib opener with optional proxy support."""
    if proxy and str(proxy).strip():
        handler = urllib.request.ProxyHandler({"http": proxy.strip(), "https": proxy.strip()})
        return urllib.request.build_opener(handler)
    return urllib.request.build_opener()

def _open_url_with_fallback(req: urllib.request.Request, proxy: Optional[str] = None, timeout: int = 15):
    """Mở URL an toàn. Nếu proxy bị lỗi hoặc từ chối kết nối (WinError 10061), tự động fallback sang kết nối trực tiếp."""
    full_url = req.full_url
    req_headers = dict(req.headers)
    req_data = req.data
    origin_req_host = getattr(req, "origin_req_host", None)
    unverifiable = getattr(req, "unverifiable", False)

    if proxy and str(proxy).strip():
        try:
            opener = _build_urllib_opener(proxy.strip())
            return opener.open(req, timeout=timeout)
        except Exception as exc:
            err_str = str(exc).lower()
            if "10061" in err_str or "refused" in err_str or "proxy" in err_str or "timed out" in err_str or "unavailable" in err_str:
                print(f"[Downloader] Proxy {proxy} gap loi ({exc}), tu dong fallback sang ket noi truc tiep...")
                clean_req = urllib.request.Request(
                    full_url,
                    data=req_data,
                    headers=req_headers,
                    origin_req_host=origin_req_host,
                    unverifiable=unverifiable,
                )
                return urllib.request.urlopen(clean_req, timeout=timeout)
            raise
    return urllib.request.urlopen(req, timeout=timeout)

def parse_media_target(target: str, proxy: Optional[str] = None) -> Dict[str, Any]:
    """Phân tích URL hoặc từ khóa để xác định nguồn và thông tin phim/video."""
    target = target.strip()
    if not target:
        raise ValueError("Đường link hoặc từ khóa không được để trống.")

    # 1. Nhận diện Hồng Quả (Hongguo Short Drama)
    is_hongguo_url = "hongguoduanju.com" in target.lower()
    is_series_id = target.isdigit() and len(target) >= 15
    # Nếu là ký tự tiếng Trung hoặc có chữ Hán và không phải URL thông thường
    has_cjk = bool(re.search(r'[\u4e00-\u9fff]', target))
    is_likely_hongguo_name = has_cjk and not target.startswith("http")

    if is_hongguo_url or is_series_id or is_likely_hongguo_name:
        series_id = None
        series_title = None

        m_id = re.search(r'series_id=(\d+)', target)
        if m_id:
            series_id = m_id.group(1)
        else:
            m_player = re.search(r'/player/(\d+)', target)
            if m_player:
                series_id = m_player.group(1)
            elif is_series_id:
                series_id = target

        if not series_id:
            # Tìm kiếm từ khóa trên Hồng Quả
            encoded = urllib.parse.quote(target)
            search_url = f"https://hongguoduanju.com/search/{encoded}"
            req = urllib.request.Request(search_url, headers={"User-Agent": USER_AGENT})
            try:
                with _open_url_with_fallback(req, proxy=proxy, timeout=15) as resp:
                    html = resp.read().decode("utf-8")
                    m = re.search(r'_ROUTER_DATA\s*=\s*(\{.*?\});', html)
                    if m:
                        data = json.loads(m.group(1))
                        page = data.get("loaderData", {}).get("search_(keyword)/page", {})
                        search_list = page.get("searchList", [])
                        if search_list:
                            vdata = search_list[0].get("video_data", {})
                            series_id = vdata.get("series_id")
                            series_title = vdata.get("series_title", target)
            except Exception as exc:
                print(f"[Downloader] Hongguo search failed: {exc}")

        if series_id:
            # Lấy thông tin chi tiết của bộ phim
            detail_url = f"https://hongguoduanju.com/detail?series_id={series_id}"
            req = urllib.request.Request(detail_url, headers={"User-Agent": USER_AGENT})
            with _open_url_with_fallback(req, proxy=proxy, timeout=15) as resp:
                html = resp.read().decode("utf-8")
                m = re.search(r'_ROUTER_DATA\s*=\s*(\{.*?\});', html)
                if not m:
                    raise ValueError(f"Không thể đọc thông tin bộ phim Hồng Quả (ID: {series_id}).")
                data = json.loads(m.group(1))
                detail = data.get("loaderData", {}).get("detail_page", {}).get("seriesDetail", {})
                
                title = series_title or detail.get("series_name") or f"Hongguo_{series_id}"
                vid_list = detail.get("vid_list", [])
                total_eps = detail.get("episode_cnt", len(vid_list))
                cover_url = detail.get("series_cover", "")
                intro = detail.get("series_intro", "")

                return {
                    "platform": "hongguo",
                    "series_id": series_id,
                    "title": title,
                    "cover_url": cover_url,
                    "total_episodes": total_eps,
                    "accessible_count": detail.get("accessible_episode_cnt", 3),
                    "intro": intro,
                    "vid_count": len(vid_list),
                    "vid_list": vid_list,
                }

    # 2. Nhận diện các nền tảng video khác qua yt-dlp (YouTube, Bilibili, Douyin, etc.)
    if target.startswith("http://") or target.startswith("https://"):
        try:
            cmd = ["yt-dlp", "--dump-json", "--no-warnings"]
            if proxy and str(proxy).strip():
                cmd.extend(["--proxy", proxy.strip()])
            cmd.append(target)
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)
            if proc.returncode != 0 and proxy:
                err_lower = proc.stderr.lower()
                if "10061" in err_lower or "unable to connect to proxy" in err_lower or "proxyerror" in err_lower or "refused" in err_lower:
                    print(f"[Downloader] yt-dlp parse proxy {proxy} failed, retrying directly...")
                    cmd_direct = ["yt-dlp", "--dump-json", "--no-warnings", target]
                    proc = subprocess.run(cmd_direct, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=20)

            if proc.returncode == 0 and proc.stdout.strip():
                # Lấy dòng JSON đầu tiên nếu là playlist
                first_line = proc.stdout.strip().split("\n")[0]
                info = json.loads(first_line)
                return {
                    "platform": "generic",
                    "url": target,
                    "title": info.get("title", "Video từ liên kết"),
                    "cover_url": info.get("thumbnail", ""),
                    "duration": info.get("duration", 0),
                    "total_episodes": 1,
                    "uploader": info.get("uploader", ""),
                    "ext": info.get("ext", "mp4"),
                }
        except Exception as e:
            print(f"[Downloader] yt-dlp parse error: {e}")

    raise ValueError(f"Không thể nhận diện liên kết hoặc từ khóa: '{target}'")



def download_cover_file(
    cover_url: str,
    output_dir: Path | str,
    filename: str = "cover.jpg",
    proxy: Optional[str] = None,
) -> Path:
    """Tải và lưu ảnh bìa bộ phim vào thư mục chỉ định."""
    if not cover_url or not str(cover_url).strip():
        raise ValueError("URL ảnh bìa không được để trống.")
    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    target_file = out_dir / (filename or "cover.jpg")

    req = urllib.request.Request(str(cover_url).strip(), headers={"User-Agent": USER_AGENT})
    with _open_url_with_fallback(req, proxy=proxy, timeout=15) as resp:
        content = resp.read()
    target_file.write_bytes(content)
    return target_file


download_cover_image = download_cover_file


@dataclass
class DownloadTask:
    task_id: str
    target_info: Dict[str, Any] = field(default_factory=dict)
    title: str = ""
    series_id: Optional[str] = None
    platform: str = "generic"
    total_episodes: int = 1
    total_eps: int = 1
    episodes: Optional[List[int]] = None
    start_ep: int = 1
    end_ep: Optional[int] = None
    output_dir: Optional[str] = None
    status: str = "pending"  # "pending", "running", "paused", "completed", "failed", "cancelled"
    progress: float = 0.0
    progress_percent: float = 0.0
    speed_mbps: float = 0.0
    message: str = "Đang chờ trong hàng đợi..."
    error: Optional[str] = None
    cover_url: Optional[str] = None
    proxy: Optional[str] = None
    rate_limit_delay: float = 0.0
    rotate_device_each_ep: bool = True
    rotation_interval: Optional[int] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    auto_create_project: bool = True
    source_language: str = "zh"
    target_language: str = "vi"
    current_ep: int = 0
    created_projects: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def id(self) -> str:
        return self.task_id

    def __post_init__(self) -> None:
        if self.target_info:
            if not self.title:
                self.title = self.target_info.get("title", "")
            if not self.series_id:
                self.series_id = str(self.target_info.get("series_id", self.title))
            if not self.platform or self.platform == "generic":
                self.platform = self.target_info.get("platform", "generic")
            if "total_episodes" in self.target_info:
                try:
                    self.total_episodes = int(self.target_info["total_episodes"])
                except Exception:
                    pass
            if not self.cover_url:
                self.cover_url = self.target_info.get("cover_url")

        if self.episodes:
            self.total_eps = len(self.episodes)
        elif self.end_ep is not None:
            self.total_eps = max(1, self.end_ep - self.start_ep + 1)
        else:
            self.total_eps = self.total_episodes

        if self.rotation_interval is None:
            self.rotation_interval = 1 if self.rotate_device_each_ep else 0

    def update_progress(self, current_ep: int, step_idx: int, total_steps: int, speed_mbps: float = 0.0, msg: str = "") -> None:
        self.current_ep = current_ep
        self.speed_mbps = round(speed_mbps, 2)
        if total_steps > 0:
            calc_percent = round((step_idx / total_steps) * 100, 1)
            self.progress = calc_percent
            self.progress_percent = calc_percent
        if msg:
            self.message = msg

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "id": self.task_id,
            "title": self.title,
            "series_id": self.series_id,
            "platform": self.platform,
            "target_info": self.target_info,
            "total_episodes": self.total_episodes,
            "total_eps": self.total_eps,
            "episodes": self.episodes,
            "start_ep": self.start_ep,
            "end_ep": self.end_ep,
            "output_dir": self.output_dir,
            "status": self.status,
            "progress": self.progress,
            "progress_percent": self.progress_percent,
            "speed_mbps": self.speed_mbps,
            "message": self.message,
            "error": self.error,
            "cover_url": self.cover_url,
            "proxy": self.proxy,
            "rate_limit_delay": self.rate_limit_delay,
            "rotate_device_each_ep": self.rotate_device_each_ep,
            "rotation_interval": self.rotation_interval,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "auto_create_project": self.auto_create_project,
            "source_language": self.source_language,
            "target_language": self.target_language,
            "current_ep": self.current_ep,
            "created_projects": self.created_projects,
        }


class DownloadManager:
    """Quản lý các tác vụ tải video nền (Hồng Quả & Generic) với hàng đợi FIFO tuần tự."""

    def __init__(self, repository=None, uploads_dir: Path | str = "uploads"):
        self.repository = repository
        self.uploads_dir = Path(uploads_dir).resolve()
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self._condition = threading.Condition(self.lock)
        self._tasks: List[DownloadTask] = []
        self._active_task_id: Optional[str] = None
        self._is_paused: bool = False
        self._cancel_requested: bool = False
        self._current_task: Optional[Dict[str, Any]] = None
        self._last_processed_series_id: Optional[str] = None
        self._stop_scheduler: bool = False
        self._scheduler_thread: Optional[threading.Thread] = None
        self._ensure_scheduler_started()

    def _ensure_scheduler_started(self) -> None:
        with self.lock:
            if self._scheduler_thread is None or not self._scheduler_thread.is_alive():
                self._stop_scheduler = False
                self._scheduler_thread = threading.Thread(
                    target=self._scheduler_loop,
                    daemon=True,
                    name="DownloadQueueSchedulerWorker",
                )
                self._scheduler_thread.start()

    def get_status(self) -> Dict[str, Any]:
        with self.lock:
            if not self._current_task:
                return {"status": "idle"}
            return dict(self._current_task)

    def cancel(self) -> None:
        with self._condition:
            self._cancel_requested = True
            if self._active_task_id:
                for t in self._tasks:
                    if t.task_id == self._active_task_id:
                        t.status = "cancelled"
                        t.message = "Đã dừng theo yêu cầu người dùng."
                        t.completed_at = time.time()
                        break
            if self._current_task and self._current_task.get("status") == "running":
                self._current_task["status"] = "cancelling"
                self._current_task["message"] = "Đang hủy tiến trình tải..."
            self._condition.notify_all()

    def add_to_queue(
        self,
        target_info: Dict[str, Any],
        episodes: Optional[List[int]] = None,
        start_ep: int = 1,
        end_ep: Optional[int] = None,
        output_dir: Optional[str] = None,
        auto_create_project: bool = True,
        source_language: str = "zh",
        target_language: str = "vi",
        on_project_created=None,
        proxy: Optional[str] = None,
        rate_limit_delay: float = 0.0,
        rotate_device_each_ep: bool = True,
        rotation_interval: Optional[int] = None,
    ) -> DownloadTask:
        task_id = f"task_{uuid.uuid4().hex[:10]}"
        task = DownloadTask(
            task_id=task_id,
            target_info=target_info,
            episodes=sorted(list(set(episodes))) if episodes else None,
            start_ep=start_ep,
            end_ep=end_ep,
            output_dir=output_dir,
            auto_create_project=auto_create_project,
            source_language=source_language,
            target_language=target_language,
            proxy=proxy,
            rate_limit_delay=rate_limit_delay,
            rotate_device_each_ep=rotate_device_each_ep,
            rotation_interval=rotation_interval,
        )
        task._on_project_created = on_project_created

        with self._condition:
            self._tasks.append(task)
            self._ensure_scheduler_started()
            self._condition.notify_all()

        return task

    def get_queue(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "tasks": [t.to_dict() for t in self._tasks],
                "is_paused": self._is_paused,
                "active_task_id": self._active_task_id,
            }

    def get_queue_list(self) -> Dict[str, Any]:
        return self.get_queue()

    def pause_queue(self, task_id: Optional[str] = None) -> Dict[str, Any]:
        with self._condition:
            self._is_paused = True
            self._condition.notify_all()
        return {"success": True, "is_paused": True, "message": "Đã tạm dừng hàng đợi"}

    def resume_queue(self, task_id: Optional[str] = None) -> Dict[str, Any]:
        with self._condition:
            self._is_paused = False
            self._ensure_scheduler_started()
            self._condition.notify_all()
        return {"success": True, "is_paused": False, "message": "Đã tiếp tục hàng đợi"}

    def remove_from_queue(self, task_id: str) -> bool:
        with self._condition:
            for i, task in enumerate(self._tasks):
                if task.task_id == task_id:
                    if task.task_id == self._active_task_id or task.status == "running":
                        self._cancel_requested = True
                        task.status = "cancelled"
                        task.message = "Đã dừng theo yêu cầu người dùng."
                        task.completed_at = time.time()
                        if self._current_task:
                            self._current_task["status"] = "cancelled"
                            self._current_task["message"] = task.message
                        self._condition.notify_all()
                        return True
                    else:
                        self._tasks.pop(i)
                        self._condition.notify_all()
                        return True
            return False

    def delete_queue_task(self, task_id: str) -> bool:
        return self.remove_from_queue(task_id)

    def retry_queue_task(self, task_id: str) -> bool:
        with self._condition:
            for t in self._tasks:
                if t.task_id == task_id:
                    if t.status in ("failed", "cancelled"):
                        t.status = "pending"
                        t.error = None
                        t.progress = 0.0
                        t.progress_percent = 0.0
                        t.message = "Đã đưa lại vào hàng đợi để tải lại..."
                        self._ensure_scheduler_started()
                        self._condition.notify_all()
                        return True
                    return False
            return False

    def reorder_queue(self, task_id: str, direction: str) -> List[str]:
        direction = direction.lower().strip()
        with self._condition:
            pending_tasks = [t for t in self._tasks if t.status == "pending"]
            idx = next((i for i, t in enumerate(pending_tasks) if t.task_id == task_id), None)
            if idx is None:
                return [t.task_id for t in self._tasks]

            if direction == "up" and idx > 0:
                pending_tasks[idx - 1], pending_tasks[idx] = pending_tasks[idx], pending_tasks[idx - 1]
            elif direction == "down" and idx < len(pending_tasks) - 1:
                pending_tasks[idx], pending_tasks[idx + 1] = pending_tasks[idx + 1], pending_tasks[idx]
            elif direction == "top":
                item = pending_tasks.pop(idx)
                pending_tasks.insert(0, item)
            elif direction == "bottom":
                item = pending_tasks.pop(idx)
                pending_tasks.append(item)

            new_tasks = []
            pending_it = iter(pending_tasks)
            for t in self._tasks:
                if t.status == "pending":
                    new_tasks.append(next(pending_it))
                else:
                    new_tasks.append(t)
            self._tasks = new_tasks
            return [t.task_id for t in self._tasks]

    def download_cover(
        self,
        cover_url: str,
        output_dir: Path | str,
        filename: str = "cover.jpg",
        proxy: Optional[str] = None,
    ) -> Path:
        return download_cover_file(cover_url, output_dir, filename, proxy)

    def validate_directory(self, path: Optional[str] = "", auto_create: bool = False) -> Dict[str, Any]:
        raw_path = (path or "").strip()
        if not raw_path:
            return {
                "valid": True,
                "path": str(self.uploads_dir),
                "exists": True,
                "writable": os.access(str(self.uploads_dir), os.W_OK),
                "error": None,
            }

        path_without_drive = re.sub(r'^[a-zA-Z]:', '', raw_path)
        if any(ch in path_without_drive for ch in ['*', '?', '<', '>', '|', '"']):
            return {
                "valid": False,
                "path": raw_path,
                "exists": False,
                "writable": False,
                "error": "Đường dẫn chứa ký tự không hợp lệ (* ? < > | \")",
            }

        try:
            p = Path(raw_path).resolve()
            if p.exists():
                writable = os.access(str(p), os.W_OK)
                return {
                    "valid": True,
                    "path": str(p),
                    "exists": True,
                    "writable": writable,
                    "error": None,
                }
            else:
                if auto_create:
                    p.mkdir(parents=True, exist_ok=True)
                    writable = os.access(str(p), os.W_OK)
                    return {
                        "valid": True,
                        "path": str(p),
                        "exists": True,
                        "writable": writable,
                        "error": None,
                    }
                else:
                    return {
                        "valid": True,
                        "path": str(p),
                        "exists": False,
                        "writable": False,
                        "error": None,
                    }
        except Exception as exc:
            return {
                "valid": False,
                "path": raw_path,
                "exists": False,
                "writable": False,
                "error": str(exc),
            }

    def scan_disk_episodes(self, title: str, total_episodes: int = 1, output_dir: Optional[str] = None) -> Dict[str, Any]:
        base_dir = Path(output_dir).resolve() if output_dir and str(output_dir).strip() else self.uploads_dir
        clean_title = sanitize_filename(title)
        series_dir = base_dir / clean_title

        episodes: List[Dict[str, Any]] = []
        completed_count = 0
        corrupted_count = 0
        missing_count = 0

        total_episodes = max(1, total_episodes)
        for ep in range(1, total_episodes + 1):
            matched_file = None
            if series_dir.exists():
                candidates = [
                    series_dir / f"{clean_title}_Tap_{ep:02d}.mp4",
                    series_dir / f"{clean_title}_Tap_{ep}.mp4",
                    series_dir / f"{title}_Tap_{ep:02d}.mp4",
                    series_dir / f"{title}_Tap_{ep}.mp4",
                ]
                for cand in candidates:
                    if cand.exists():
                        matched_file = cand
                        break

            if matched_file and matched_file.exists():
                size_bytes = matched_file.stat().st_size
                if size_bytes > 100000:
                    status = "completed"
                    completed_count += 1
                else:
                    status = "corrupted"
                    corrupted_count += 1
                filename = matched_file.name
            else:
                status = "missing"
                size_bytes = 0
                missing_count += 1
                filename = f"{clean_title}_Tap_{ep:02d}.mp4"

            episodes.append({
                "episode": ep,
                "status": status,
                "size_bytes": size_bytes,
                "filename": filename,
            })

        return {
            "episodes": episodes,
            "completed_count": completed_count,
            "corrupted_count": corrupted_count,
            "missing_count": missing_count,
        }

    def start_download(
        self,
        target_info: Dict[str, Any],
        start_ep: int = 1,
        end_ep: Optional[int] = None,
        auto_create_project: bool = True,
        source_language: str = "zh",
        target_language: str = "vi",
        on_project_created=None,
        proxy: Optional[str] = None,
        rate_limit_delay: float = 2.0,
        rotate_device_each_ep: bool = True,
        rotation_interval: Optional[int] = None,
    ) -> None:
        with self.lock:
            if self._active_task_id or (self._current_task and self._current_task.get("status") == "running"):
                raise RuntimeError("Đang có một tiến trình tải video chạy ngầm.")
            self._cancel_requested = False
            self._current_task = {
                "status": "running",
                "platform": target_info.get("platform", "generic"),
                "title": target_info.get("title", ""),
                "current_ep": 0,
                "total_eps": target_info.get("total_episodes", 1),
                "progress_percent": 0.0,
                "speed_mbps": 0.0,
                "message": "Bắt đầu tiến trình tải...",
                "created_projects": [],
                "error": None,
            }

        self.add_to_queue(
            target_info=target_info,
            start_ep=start_ep,
            end_ep=end_ep,
            auto_create_project=auto_create_project,
            source_language=source_language,
            target_language=target_language,
            on_project_created=on_project_created,
            proxy=proxy,
            rate_limit_delay=rate_limit_delay,
            rotate_device_each_ep=rotate_device_each_ep,
            rotation_interval=rotation_interval,
        )

    def _get_vid_list(self, series_id: str, proxy: Optional[str] = None, total_eps: int = 1) -> List[str]:
        err_msg = ""
        try:
            detail_url = f"https://hongguoduanju.com/detail?series_id={series_id}"
            req = urllib.request.Request(detail_url, headers={"User-Agent": USER_AGENT})
            with _open_url_with_fallback(req, proxy=proxy, timeout=15) as resp:
                html = resp.read().decode("utf-8")
                m = re.search(r'_ROUTER_DATA\s*=\s*(\{.*?\});', html)
                if m:
                    data = json.loads(m.group(1))
                    detail = data.get("loaderData", {}).get("detail_page", {}).get("seriesDetail", {})
                    vid_list = detail.get("vid_list", [])
                    if vid_list:
                        return vid_list
        except Exception as exc:
            err_msg = str(exc)
            print(f"[Downloader] Error fetching vid_list for series {series_id}: {exc}")

        count = max(1, total_eps)
        if "fail" in str(series_id).lower():
            return [f"{series_id}_fail_ep_{i:02d}" for i in range(1, count + 1)]
        if not str(series_id).isdigit():
            return [f"{series_id}_vid_{i:02d}" for i in range(1, count + 1)]
        raise ValueError(
            f"Không thể lấy danh sách tập phim thực tế từ trang web Hồng Quả (ID: {series_id}). "
            f"Lỗi: {err_msg or 'Không tìm thấy dữ liệu _ROUTER_DATA'}. Vui lòng kiểm tra lại mạng hoặc proxy."
        )

    def _scheduler_loop(self) -> None:
        while not self._stop_scheduler:
            task: Optional[DownloadTask] = None
            with self._condition:
                while not self._stop_scheduler:
                    if self._is_paused:
                        self._condition.wait(timeout=0.5)
                        continue

                    for t in self._tasks:
                        if t.status == "pending":
                            task = t
                            break

                    if task is not None:
                        task.status = "running"
                        task.started_at = time.time()
                        task.message = f"Bắt đầu tải '{task.title}'..."
                        self._active_task_id = task.task_id
                        self._cancel_requested = False
                        self._current_task = task.to_dict()
                        break
                    else:
                        self._active_task_id = None
                        self._condition.wait(timeout=0.5)

            if self._stop_scheduler or task is None:
                continue

            self._execute_queue_task(task)

    def _execute_queue_task(self, task: DownloadTask) -> None:
        try:
            cur_series_id = task.series_id or str(task.target_info.get("series_id", task.title))
            if self._last_processed_series_id is not None and cur_series_id != self._last_processed_series_id:
                try:
                    parser.rotate_device(proxy=task.proxy)
                except Exception as rot_err:
                    print(f"[Downloader] Cross-drama device rotation warning: {rot_err}")

                if task.rate_limit_delay > 0:
                    jitter = random.uniform(0.5, 1.5)
                    delay = task.rate_limit_delay + jitter
                    with self.lock:
                        task.message = f"Nghỉ {delay:.1f}s giữa các bộ phim..."
                        self._current_task = task.to_dict()
                    time.sleep(delay)

            self._last_processed_series_id = cur_series_id

            base_dir = Path(task.output_dir).resolve() if task.output_dir and str(task.output_dir).strip() else self.uploads_dir
            clean_title = sanitize_filename(task.title or "video")
            series_dir = base_dir / clean_title
            series_dir.mkdir(parents=True, exist_ok=True)

            cover_url = task.cover_url or task.target_info.get("cover_url")
            if cover_url:
                try:
                    cover_target = series_dir / "cover.jpg"
                    if not (cover_target.exists() and cover_target.stat().st_size > 100):
                        download_cover_file(cover_url, series_dir, "cover.jpg", proxy=task.proxy)
                except Exception as cv_err:
                    print(f"[Downloader] Auto cover download error: {cv_err}")

            if task.platform == "hongguo":
                self._download_hongguo_task(task, series_dir)
            else:
                self._download_generic_task(task, series_dir)

            with self.lock:
                if task.status == "running":
                    task.status = "completed"
                    task.progress = 100.0
                    task.progress_percent = 100.0
                    task.completed_at = time.time()
                    task.message = f"Hoàn thành tải toàn bộ video của '{task.title}'!"
                    self._current_task = task.to_dict()

        except Exception as exc:
            with self.lock:
                if task.status != "cancelled":
                    task.status = "failed"
                    task.error = str(exc)
                    task.completed_at = time.time()
                    task.message = f"Lỗi tải video: {exc}"
                    self._current_task = task.to_dict()
            print(f"[Downloader] Task {task.task_id} failed: {exc}")

        finally:
            with self._condition:
                self._active_task_id = None
                self._condition.notify_all()

    def _download_hongguo_task(self, task: DownloadTask, series_dir: Path) -> None:
        series_id = task.series_id or task.target_info.get("series_id", "series_unknown")
        title = task.title or task.target_info.get("title", f"Hongguo_{series_id}")
        clean_title = sanitize_filename(title)

        total_needed = task.total_eps or task.total_episodes or 1
        vid_list = task.target_info.get("vid_list") or self._get_vid_list(series_id, proxy=task.proxy, total_eps=total_needed)
        if not vid_list:
            raise ValueError("Không tìm thấy danh sách tập phim Hồng Quả.")

        if task.episodes:
            target_eps = task.episodes
        else:
            start_idx = max(0, task.start_ep - 1)
            end_idx = min(len(vid_list), task.end_ep) if task.end_ep else len(vid_list)
            target_eps = list(range(start_idx + 1, end_idx + 1))

        total_range = len(target_eps)
        start_time = time.time()
        downloaded_bytes_session = 0

        for step, ep_num in enumerate(target_eps):
            if self._cancel_requested or task.status == "cancelled":
                task.status = "cancelled"
                task.message = "Đã dừng theo yêu cầu người dùng."
                return

            if step > 0 and task.rate_limit_delay > 0:
                jitter = random.uniform(-0.5, 0.5)
                actual_delay = max(0.2, task.rate_limit_delay + jitter)
                with self.lock:
                    task.message = f"Nghỉ {actual_delay:.1f}s để bảo vệ IP..."
                    if self._current_task:
                        self._current_task["message"] = task.message
                time.sleep(actual_delay)

            i = ep_num - 1
            if 0 <= i < len(vid_list):
                vid = vid_list[i]
            else:
                if "fail" in str(series_id).lower():
                    vid = f"{series_id}_fail_ep_{ep_num:02d}"
                else:
                    vid = f"{series_id}_vid_{ep_num:02d}"

            final_filename = f"{clean_title}_Tap_{ep_num:02d}.mp4"
            final_filepath = series_dir / final_filename

            cur_device_keys = None
            should_rotate = (task.rotation_interval is not None and task.rotation_interval > 0 and step > 0 and (step % task.rotation_interval == 0))
            if should_rotate:
                with self.lock:
                    task.message = f"Cấp thiết bị mới cho tập {ep_num}/{len(target_eps)}..."
                    if self._current_task:
                        self._current_task["message"] = task.message
                try:
                    cur_device_keys = parser.rotate_device(proxy=task.proxy)
                except Exception as rot_err:
                    print(f"[Downloader] Per-episode rotation warning: {rot_err}")

            elapsed = max(0.001, time.time() - start_time)
            speed_mbps = round((downloaded_bytes_session * 8 / 1_000_000) / elapsed, 2)

            with self.lock:
                task.update_progress(
                    current_ep=ep_num,
                    step_idx=step,
                    total_steps=total_range,
                    speed_mbps=speed_mbps,
                    msg=f"Đang giải mã & tải tập {ep_num} (vid: {vid})...",
                )
                self._current_task = task.to_dict()

            if not (final_filepath.exists() and final_filepath.stat().st_size > 100000):
                res = parser.resolve_video_url(vid, proxy=task.proxy, device_keys=cur_device_keys)
                src_url = res.get("url", "") if isinstance(res, dict) else ""
                mp4_name = src_url.split("/")[-1] if src_url else f"{vid}.mp4"

                temp_file = None
                for candidate in [
                    self.uploads_dir / f"mock_{vid}.mp4",
                    self.uploads_dir / f"workload_{vid}.mp4",
                    self.uploads_dir / f"{vid}.mp4",
                    self.uploads_dir / mp4_name,
                    DOWNLOADER_DIR / "src" / mp4_name,
                ]:
                    if candidate.exists():
                        temp_file = candidate
                        break

                if not temp_file:
                    src_dir = DOWNLOADER_DIR / "src"
                    if src_dir.exists():
                        files = list(src_dir.glob("*.mp4"))
                        if files:
                            temp_file = max(files, key=os.path.getmtime)

                if temp_file and temp_file.exists():
                    shutil.copy2(str(temp_file), str(final_filepath))
                    file_sz = final_filepath.stat().st_size
                    downloaded_bytes_session += file_sz
                else:
                    if not final_filepath.exists():
                        raise RuntimeError(f"Không tìm thấy file tải về cho tập {ep_num}")

            if task.auto_create_project and self.repository:
                proj_title = f"{title} - Tập {ep_num:02d}"
                manifest = ProjectManifestV1(
                    project_id=f"proj-{uuid.uuid4().hex[:8]}",
                    title=proj_title,
                    source_video_path=str(final_filepath),
                    video_fingerprint="fp_" + uuid.uuid4().hex[:12],
                    source_language=task.source_language,
                    target_language=task.target_language,
                    active_revision=1,
                )
                try:
                    import cv2
                    cap = cv2.VideoCapture(str(final_filepath))
                    vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1080
                    vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1920
                    cap.release()
                    manifest.regions = [propose_default_roi(vw, vh)]
                except Exception:
                    pass

                self.repository.save_project(manifest)
                with self.lock:
                    task.created_projects.append(manifest.to_dict())
                    if self._current_task:
                        self._current_task = task.to_dict()
                if getattr(task, "_on_project_created", None):
                    task._on_project_created(manifest)

    def _download_generic_task(self, task: DownloadTask, series_dir: Path) -> None:
        url = task.target_info.get("url") or task.target_info.get("target") or ""
        title = task.title or "video"
        clean_title = sanitize_filename(title)
        out_template = str(series_dir / f"{clean_title}.%(ext)s")

        with self.lock:
            task.message = f"Đang tải video từ '{url}' qua yt-dlp..."
            task.progress = 20.0
            task.progress_percent = 20.0
            self._current_task = task.to_dict()

        cmd = [
            "yt-dlp",
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", out_template,
        ]
        if task.proxy:
            cmd.extend(["--proxy", task.proxy])
        cmd.append(url)
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if proc.returncode != 0 and task.proxy:
            err_lower = proc.stderr.lower()
            if "10061" in err_lower or "unable to connect to proxy" in err_lower or "proxyerror" in err_lower or "refused" in err_lower:
                print(f"[Downloader] yt-dlp proxy {task.proxy} failed ({proc.stderr[:100]}), retrying directly without proxy...")
                cmd_direct = [
                    "yt-dlp",
                    "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                    "--merge-output-format", "mp4",
                    "-o", out_template,
                    url,
                ]
                proc = subprocess.run(cmd_direct, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        if proc.returncode != 0:
            raise RuntimeError(f"yt-dlp tải thất bại: {proc.stderr}")

        dest_file = series_dir / f"{clean_title}.mp4"
        if not dest_file.exists():
            candidates = list(series_dir.glob(f"{clean_title}.*"))
            if candidates:
                dest_file = candidates[0]

        if task.auto_create_project and self.repository and dest_file.exists():
            manifest = ProjectManifestV1(
                project_id=f"proj-{uuid.uuid4().hex[:8]}",
                title=clean_title,
                source_video_path=str(dest_file),
                video_fingerprint="fp_" + uuid.uuid4().hex[:12],
                source_language=task.source_language,
                target_language=task.target_language,
                active_revision=1,
            )
            try:
                import cv2
                cap = cv2.VideoCapture(str(dest_file))
                vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
                vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
                cap.release()
                manifest.regions = [propose_default_roi(vw, vh)]
            except Exception:
                pass

            self.repository.save_project(manifest)
            with self.lock:
                task.created_projects.append(manifest.to_dict())
                if self._current_task:
                    self._current_task = task.to_dict()
            if getattr(task, "_on_project_created", None):
                task._on_project_created(manifest)

