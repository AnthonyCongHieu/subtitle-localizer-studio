from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
import time
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from subtitle_localizer.detector.roi import propose_default_roi
from subtitle_localizer.domain.models import ProjectManifestV1
from subtitle_localizer.persistence.repository import ProjectRepository

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', "_", name).strip()


def fetch_html(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8")


def extract_hongguo_router_data(html: str) -> dict:
    m = re.search(r"_ROUTER_DATA\s*=\s*(\{.*?\});", html)
    if not m:
        raise ValueError("Không tìm thấy dữ liệu _ROUTER_DATA trên trang Hongguo.")
    return json.loads(m.group(1))


def get_hongguo_series_info(series_id: str) -> dict:
    detail_url = f"https://hongguoduanju.com/detail?series_id={series_id}"
    html = fetch_html(detail_url)
    router_data = extract_hongguo_router_data(html)
    detail_page = router_data.get("loaderData", {}).get("detail_page", {})
    series_detail = detail_page.get("seriesDetail", {})
    if not series_detail:
        raise ValueError(f"Không tìm thấy thông tin cho series_id: {series_id}")
    return series_detail


def get_hongguo_episode_video(series_id: str, vid: str) -> Optional[dict]:
    player_url = f"https://hongguoduanju.com/player/{series_id}/{vid}"
    html = fetch_html(player_url)
    router_data = extract_hongguo_router_data(html)
    loader_data = router_data.get("loaderData", {})
    for _, v in loader_data.items():
        if isinstance(v, dict) and "video_player_info" in v:
            vpi = v.get("video_player_info")
            if vpi and "main_url" in vpi:
                return {
                    "video_url": vpi["main_url"],
                    "duration": vpi.get("duration"),
                    "width": vpi.get("width"),
                    "height": vpi.get("height"),
                }
    return None


class DownloadManager:
    """Quản lý tác vụ tải video đa nền tảng (Hongguo, YouTube, Bilibili, Douyin, v.v.)."""

    def __init__(self, upload_dir: Path | str = "uploads") -> None:
        self.upload_dir = Path(upload_dir).resolve()
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._is_cancelled = False
        self._thread: Optional[threading.Thread] = None
        self._status: Dict[str, Any] = {
            "status": "idle",
            "platform": None,
            "title": None,
            "current_ep": 0,
            "total_eps": 0,
            "progress_percent": 0.0,
            "speed_mbps": 0.0,
            "message": "Sẵn sàng",
            "created_projects": [],
            "error": None,
        }

    def parse_target(self, target: str) -> Dict[str, Any]:
        """Phân tích liên kết hoặc từ khóa để lấy siêu dữ liệu trước khi tải."""
        raw = target.strip()
        if not raw:
            raise ValueError("Vui lòng cung cấp URL hoặc từ khóa hợp lệ.")

        # 1. Kiểm tra nếu là Hongguo Short Drama
        is_hongguo = "hongguoduanju.com" in raw or "series_id=" in raw
        series_id = None
        if is_hongguo:
            m = re.search(r"series_id=(\d+)", raw)
            if m:
                series_id = m.group(1)
            else:
                m_player = re.search(r"/player/(\d+)", raw)
                if m_player:
                    series_id = m_player.group(1)
                elif raw.isdigit():
                    series_id = raw

        if is_hongguo and series_id:
            info = get_hongguo_series_info(series_id)
            title = info.get("series_name") or f"Hongguo_Series_{series_id}"
            total_eps = info.get("episode_cnt", 0)
            accessible_cnt = info.get("accessible_episode_cnt", 3)
            cover = info.get("cover_url", "")
            intro = info.get("abstract", "")
            vid_list = info.get("vid_list", [])
            return {
                "platform": "hongguo",
                "series_id": series_id,
                "title": title,
                "cover_url": cover,
                "total_episodes": total_eps or len(vid_list) or 1,
                "accessible_count": accessible_cnt,
                "intro": intro,
                "vid_count": len(vid_list),
            }

        # 2. Sử dụng yt-dlp cho các nền tảng phổ thông (YouTube, Bilibili, Douyin, Kuaishou, etc.)
        try:
            import yt_dlp

            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "extract_flat": "in_playlist",
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(raw, download=False)
                if not info:
                    raise ValueError("Không thể lấy thông tin video qua yt-dlp.")

                title = info.get("title", "Video")
                duration = info.get("duration", 0)
                thumbnail = info.get("thumbnail", "")
                uploader = info.get("uploader", "")
                ext = info.get("ext", "mp4")

                entries = info.get("entries")
                total_episodes = len(list(entries)) if entries is not None else 1

                return {
                    "platform": "generic",
                    "url": raw,
                    "title": title,
                    "cover_url": thumbnail,
                    "total_episodes": total_episodes,
                    "duration": duration,
                    "uploader": uploader,
                    "ext": ext,
                }
        except Exception as e:
            # Fallback nếu là link video trực tiếp
            if re.search(r"\.(mp4|mkv|webm|mov)(\?.*)?$", raw, re.IGNORECASE):
                fname = raw.split("/")[-1].split("?")[0]
                return {
                    "platform": "generic",
                    "url": raw,
                    "title": sanitize_filename(fname) or "Direct_Video",
                    "cover_url": "",
                    "total_episodes": 1,
                    "duration": 0,
                    "uploader": "Direct Link",
                    "ext": "mp4",
                }
            raise ValueError(f"Không thể phân tích liên kết: {e}")

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._status)

    def cancel_download(self) -> None:
        with self._lock:
            if self._status["status"] == "running":
                self._is_cancelled = True
                self._status["status"] = "cancelling"
                self._status["message"] = "Đang dừng tiến trình..."

    def start_download(
        self,
        payload: Dict[str, Any],
        repository: ProjectRepository,
    ) -> None:
        with self._lock:
            if self._status["status"] == "running":
                raise RuntimeError("Một tác vụ tải video khác đang chạy. Vui lòng chờ hoặc hủy trước.")

            target_info = payload.get("target_info", {})
            platform = target_info.get("platform", "generic")
            title = target_info.get("title", "Download_Video")
            start_ep = int(payload.get("start_ep", 1))
            end_ep = int(payload.get("end_ep", target_info.get("total_episodes", 1)))
            auto_create_project = bool(payload.get("auto_create_project", True))
            source_language = payload.get("source_language", "zh")
            target_language = payload.get("target_language", "vi")

            total_eps = max(1, end_ep - start_ep + 1)
            self._is_cancelled = False
            self._status = {
                "status": "running",
                "platform": platform,
                "title": title,
                "current_ep": start_ep,
                "total_eps": total_eps,
                "progress_percent": 0.0,
                "speed_mbps": 0.0,
                "message": "Bắt đầu tải...",
                "created_projects": [],
                "error": None,
            }

            def _run():
                try:
                    if platform == "hongguo":
                        self._download_hongguo_task(
                            target_info=target_info,
                            start_ep=start_ep,
                            end_ep=end_ep,
                            auto_create_project=auto_create_project,
                            source_language=source_language,
                            target_language=target_language,
                            repository=repository,
                        )
                    else:
                        self._download_generic_task(
                            target_info=target_info,
                            auto_create_project=auto_create_project,
                            source_language=source_language,
                            target_language=target_language,
                            repository=repository,
                        )
                except Exception as ex:
                    logger.exception("Download task failed")
                    with self._lock:
                        self._status["status"] = "failed"
                        self._status["error"] = str(ex)
                        self._status["message"] = f"Lỗi: {ex}"

            self._thread = threading.Thread(target=_run, daemon=True)
            self._thread.start()

    def _download_hongguo_task(
        self,
        target_info: Dict[str, Any],
        start_ep: int,
        end_ep: int,
        auto_create_project: bool,
        source_language: str,
        target_language: str,
        repository: ProjectRepository,
    ) -> None:
        series_id = target_info.get("series_id")
        if not series_id:
            raise ValueError("Thiếu series_id cho phim Hongguo")

        info = get_hongguo_series_info(series_id)
        vid_list = info.get("vid_list", [])
        title = target_info.get("title", f"Hongguo_{series_id}")
        clean_title = sanitize_filename(title)

        total_to_download = end_ep - start_ep + 1
        for ep_idx in range(start_ep - 1, min(end_ep, len(vid_list))):
            if self._is_cancelled:
                with self._lock:
                    self._status["status"] = "cancelled"
                    self._status["message"] = "Đã hủy tiến trình tải theo yêu cầu."
                return

            ep_num = ep_idx + 1
            vid = vid_list[ep_idx]
            file_name = f"{clean_title}_Tap_{ep_num:02d}.mp4"
            dest_path = self.upload_dir / file_name

            with self._lock:
                self._status["current_ep"] = ep_num
                self._status["message"] = f"Đang lấy link Tập {ep_num:02d}/{end_ep}..."
                self._status["progress_percent"] = round((ep_idx - (start_ep - 1)) / total_to_download * 100, 1)

            v_data = get_hongguo_episode_video(series_id, vid)
            if not v_data or not v_data.get("video_url"):
                continue

            video_url = v_data["video_url"]
            self._stream_download(video_url, dest_path)

            if dest_path.exists() and dest_path.stat().st_size > 50000 and auto_create_project:
                proj = self._create_project_for_video(
                    video_path=dest_path,
                    title=f"{clean_title}_Tap_{ep_num:02d}",
                    source_language=source_language,
                    target_language=target_language,
                    repository=repository,
                )
                with self._lock:
                    self._status["created_projects"].append(proj)

        with self._lock:
            self._status["status"] = "completed"
            self._status["progress_percent"] = 100.0
            self._status["message"] = f"Hoàn tất tải {len(self._status['created_projects'])} tập phim!"

    def _download_generic_task(
        self,
        target_info: Dict[str, Any],
        auto_create_project: bool,
        source_language: str,
        target_language: str,
        repository: ProjectRepository,
    ) -> None:
        url = target_info.get("url")
        if not url:
            raise ValueError("Thiếu URL tải video")

        import yt_dlp

        title = sanitize_filename(target_info.get("title", "Video"))
        out_template = str(self.upload_dir / f"{title}_%(id)s.%(ext)s")

        def _progress_hook(d: dict) -> None:
            if self._is_cancelled:
                raise RuntimeError("Download cancelled by user")
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes", 0)
                speed = d.get("speed") or 0
                pct = (downloaded / total * 100) if total > 0 else 0
                with self._lock:
                    self._status["progress_percent"] = round(pct, 1)
                    self._status["speed_mbps"] = round(speed / (1024 * 1024), 2)
                    self._status["message"] = f"Đang tải: {pct:.1f}% ({round(speed / (1024 * 1024), 1)} MB/s)"

        ydl_opts = {
            "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "outtmpl": out_template,
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [_progress_hook],
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                res = ydl.extract_info(url, download=True)
                downloaded_file = ydl.prepare_filename(res)
                if not Path(downloaded_file).exists():
                    # Check if merged mp4 exists
                    stem = Path(downloaded_file).stem
                    matches = list(self.upload_dir.glob(f"{stem}*.mp4"))
                    if matches:
                        downloaded_file = str(matches[0])

                if Path(downloaded_file).exists() and auto_create_project:
                    proj = self._create_project_for_video(
                        video_path=Path(downloaded_file),
                        title=title,
                        source_language=source_language,
                        target_language=target_language,
                        repository=repository,
                    )
                    with self._lock:
                        self._status["created_projects"].append(proj)

            with self._lock:
                self._status["status"] = "completed"
                self._status["progress_percent"] = 100.0
                self._status["message"] = "Hoàn tất tải video!"
        except Exception as e:
            if self._is_cancelled or "cancelled" in str(e).lower():
                with self._lock:
                    self._status["status"] = "cancelled"
                    self._status["message"] = "Đã hủy tải video theo yêu cầu."
            else:
                raise

    def _stream_download(self, url: str, dest_path: Path) -> None:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as resp:
            total_size = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            chunk_size = 1024 * 128
            t_start = time.time()
            with open(dest_path, "wb") as f:
                while True:
                    if self._is_cancelled:
                        dest_path.unlink(missing_ok=True)
                        raise RuntimeError("Cancelled by user")
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    elapsed = max(0.1, time.time() - t_start)
                    speed = (downloaded / elapsed) / (1024 * 1024)
                    pct = (downloaded / total_size * 100) if total_size > 0 else 0
                    with self._lock:
                        self._status["progress_percent"] = round(pct, 1)
                        self._status["speed_mbps"] = round(speed, 2)
                        self._status["message"] = f"Đang tải: {pct:.1f}% ({speed:.1f} MB/s)"

    def _create_project_for_video(
        self,
        video_path: Path,
        title: str,
        source_language: str,
        target_language: str,
        repository: ProjectRepository,
    ) -> Dict[str, Any]:
        import cv2

        cap = cv2.VideoCapture(str(video_path))
        vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
        vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
        cap.release()

        is_portrait = vh > vw
        roi = propose_default_roi(vw, vh, is_portrait=is_portrait)

        manifest = ProjectManifestV1(
            project_id=f"proj-{uuid.uuid4().hex[:8]}",
            title=title,
            source_video_path=str(video_path).replace("\\", "/"),
            video_fingerprint="fp_" + uuid.uuid4().hex[:12],
            source_language=source_language,
            target_language=target_language,
            active_revision=1,
            regions=[roi],
        )
        repository.save_project(manifest)
        return manifest.to_dict()
