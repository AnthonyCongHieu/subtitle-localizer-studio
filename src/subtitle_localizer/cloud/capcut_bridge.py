"""CapCut / JianYing Smart Bridge Subtitle Extractor.

Hỗ trợ 2 cơ chế:
1. Desktop Draft Sync: Đọc trực tiếp từ file cấu trúc JSON của CapCut Desktop
   (%LOCALAPPDATA%\\CapCut\\User Data\\Projects\\com.lveditor.draft), trích xuất 100%
   phụ đề đã Auto Caption của ByteDance với timecode microsecond cực chuẩn.
2. Cloud API: Kết nối qua API đám mây CapCut Singapore (edit-api-sg.capcut.com).
"""

from __future__ import annotations

import datetime
import glob
import html
import json
import logging
import os
from pathlib import Path
import re
from typing import Any, Dict, List, Optional
import uuid

from subtitle_localizer.domain.models import SubtitleCueV1

logger = logging.getLogger(__name__)


class CapCutBridgeExtractor:
    """Cầu nối bóc tách phụ đề CapCut Desktop Draft & ByteDance Cloud."""

    def __init__(
        self,
        mode: str = "cloud_api",  # "cloud_api" | "desktop_draft"
        session_token: str = "",
        endpoint: str = "https://edit-api-sg.capcut.com",
    ) -> None:
        self.mode = mode
        self.session_token = session_token
        self.endpoint = endpoint

    def _get_capcut_draft_base_dir(self) -> Path:
        """Lấy đường dẫn thư mục dự án CapCut Desktop trên Windows."""
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        if local_app_data:
            p = Path(local_app_data) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
            if p.exists():
                return p
        # Fallback JianYing (nếu dùng bản nội địa Trung)
        if local_app_data:
            p_jy = Path(local_app_data) / "JianyingPro" / "User Data" / "Projects" / "com.lveditor.draft"
            if p_jy.exists():
                return p_jy
        return Path(local_app_data) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"

    def parse_draft_json(self, draft_path: Path) -> List[Dict[str, Any]]:
        """Phân tích file draft_content.json của CapCut theo cấu trúc chuẩn của pyJianYingDraft/capcut2srt."""
        if not draft_path.exists():
            return []

        try:
            with open(draft_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            logger.error("Không thể đọc file draft CapCut %s: %s", draft_path, exc)
            return []

        # 1. Thu thập bảng tra cứu nội dung Text (materials -> texts)
        materials = data.get("materials", {})
        texts_list = materials.get("texts", []) or data.get("texts", [])
        text_lookup: Dict[str, str] = {}

        for item in texts_list:
            text_id = item.get("id", "")
            content = item.get("content", "")
            # Hoặc JSON bọc: {"text": "..."}
            if content.startswith("{") and "text" in content:
                try:
                    c_json = json.loads(content)
                    content = c_json.get("text", content)
                except Exception:
                    pass
            # CapCut có thể lưu content dưới dạng XML/JSON style: "<size=...><color=...>Chữ..." hoặc text thuần
            if "<" in content and ">" in content:
                content = re.sub(r"<[^>]+>", "", content)
            content = html.unescape(content)
            clean = content.strip()
            if text_id and clean:
                text_lookup[text_id] = clean

        # 2. Thu thập các track phụ đề trong tracks
        results: List[Dict[str, Any]] = []
        tracks = data.get("tracks", [])
        for track in tracks:
            # Nhận diện track text/subtitle
            track_type = track.get("type", "")
            track_name = track.get("name", "").lower()
            if track_type != "text" and "subtitle" not in track_name and "text" not in track_name:
                continue

            segments = track.get("segments", [])
            for seg in segments:
                material_id = seg.get("material_id", "")
                timerange = seg.get("target_timerange") or seg.get("source_timerange")
                if not timerange or material_id not in text_lookup:
                    continue

                # CapCut lưu thời gian dạng microseconds (1s = 1,000,000 us)
                start_us = timerange.get("start", 0)
                duration_us = timerange.get("duration", 0)
                start_sec = round(start_us / 1_000_000.0, 3)
                end_sec = round((start_us + duration_us) / 1_000_000.0, 3)
                text = text_lookup[material_id]

                if text and end_sec > start_sec:
                    results.append({"start": start_sec, "end": end_sec, "text": text})

        # Sắp xếp theo thứ tự thời gian
        results.sort(key=lambda x: x["start"])
        return results

    def list_recent_drafts(self, limit: int = 30) -> List[Dict[str, Any]]:
        """Quét và liệt kê các dự án CapCut Desktop gần nhất kèm số lượng phụ đề và metadata."""
        base_dir = self._get_capcut_draft_base_dir()
        if not base_dir.exists():
            return []

        drafts: List[Dict[str, Any]] = []
        try:
            for item in base_dir.iterdir():
                if not item.is_dir():
                    continue

                draft_content_path = item / "draft_content.json"
                if not draft_content_path.exists():
                    continue

                draft_meta_path = item / "draft_meta_info.json"
                name = item.name
                mtime = draft_content_path.stat().st_mtime
                duration_sec = 0.0

                if draft_meta_path.exists():
                    try:
                        with open(draft_meta_path, "r", encoding="utf-8") as mf:
                            meta = json.load(mf)
                        name = meta.get("draft_name") or name
                        raw_mod = meta.get("tm_draft_modified", 0)
                        if raw_mod:
                            mtime = raw_mod / 1e6 if raw_mod > 1e11 else float(raw_mod)
                        raw_dur = meta.get("tm_duration", 0)
                        if raw_dur:
                            duration_sec = round(raw_dur / 1e6, 2)
                    except Exception as meta_err:
                        logger.debug("Không thể đọc draft_meta_info cho %s: %s", item.name, meta_err)

                # Parse cues để lấy số lượng và preview
                segments = self.parse_draft_json(draft_content_path)
                preview_cues = [s["text"] for s in segments[:3]] if segments else []

                try:
                    updated_at_str = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
                except Exception:
                    updated_at_str = ""

                drafts.append({
                    "id": item.name,
                    "name": name,
                    "path": str(draft_content_path).replace("\\", "/"),
                    "folder_path": str(item).replace("\\", "/"),
                    "mtime": mtime,
                    "updated_at": updated_at_str,
                    "duration_sec": duration_sec,
                    "cue_count": len(segments),
                    "preview_cues": preview_cues,
                })
        except Exception as exc:
            logger.error("Lỗi khi quét danh mục dự án CapCut: %s", exc)

        drafts.sort(key=lambda x: x["mtime"], reverse=True)
        return drafts[:limit]

    def extract_cues(
        self,
        video_path: Path,
        source_lang: str = "auto",
        draft_id: Optional[str] = None,
        draft_path: Optional[Path | str] = None,
        progress_callback: Optional[Any] = None,
    ) -> List[SubtitleCueV1]:
        """Trích xuất phụ đề qua CapCut Cloud Direct ASR (ưu tiên) hoặc Desktop Draft."""
        from subtitle_localizer.service.capcut_api import CapCutSubtitleClient
        client = CapCutSubtitleClient(endpoint=self.endpoint)

        # 1. Chế độ chính: CapCut Cloud Direct ASR (hoàn toàn không cần tài khoản)
        if self.mode == "cloud_api" or (not draft_id and not draft_path):
            try:
                if progress_callback:
                    progress_callback(0.2, "Đang kết nối CapCut Cloud ASR (ByteDance)...")
                cloud_cues = client.extract_subtitles_from_video(
                    video_path, source_lang=source_lang, progress_cb=progress_callback
                )
                if cloud_cues:
                    logger.info("Bóc tách thành công %d câu phụ đề từ CapCut Cloud ASR.", len(cloud_cues))
                    return cloud_cues
            except Exception as exc:
                logger.warning("CapCut Cloud ASR gặp lỗi, kiểm tra dự thảo CapCut Desktop nếu có: %s", exc)

        # 2. Chế độ phụ trợ: Đọc từ dự án CapCut Desktop Draft (nếu có chỉ định cụ thể)
        matched_draft: Optional[Path] = None
        if draft_path:
            p = Path(draft_path)
            if p.exists():
                matched_draft = p

        if not matched_draft and draft_id:
            base_dir = self._get_capcut_draft_base_dir()
            candidate = base_dir / draft_id / "draft_content.json"
            if candidate.exists():
                matched_draft = candidate

        if matched_draft and matched_draft.exists():
            logger.info("Parsing CapCut Draft: %s", matched_draft)
            segments = self.parse_draft_json(matched_draft)
            if segments:
                cues = []
                for seg in segments:
                    cues.append(
                        SubtitleCueV1(
                            cue_id=f"capcut-{uuid.uuid4().hex[:8]}",
                            start_pts=seg["start"],
                            end_pts=seg["end"],
                            source_text=seg["text"],
                            quality_flags=["capcut_draft_extracted"],
                        )
                    )
                return cues

        # Fallback cuối cùng: Thử gọi Cloud một lần nữa nếu trước đó chưa gọi
        try:
            return client.extract_subtitles_from_video(
                video_path, source_lang=source_lang, progress_cb=progress_callback
            )
        except Exception:
            return []
