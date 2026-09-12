"""Full-Pipeline Orchestrator (Ticket T28).

Tự động hóa hoàn chỉnh quy trình:
URL -> Download -> Auto-detect ROI -> OCR -> Translation -> Dubbing -> Export MP4 -> Auto-Open Editor.
Bền vững, độc lập với trình duyệt, có Quality Gates, Fallback Logging và khôi phục khi restart.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from subtitle_localizer.domain.models import (
    FallbackEventV1,
    FullPipelineSettingsV1,
    FullPipelineStageV1,
    FullPipelineWorkflowV1,
    ProjectManifestV1,
    RegionTrackV1,
    StageRunV1,
    SubtitleCueV1,
)
from subtitle_localizer.persistence.repository import ProjectRepository

logger = logging.getLogger("subtitle_localizer.orchestrator")


class FullPipelineOrchestrator:
    """Điều phối viên toàn trình cho Full Pipeline Studio."""

    def __init__(
        self,
        repository: ProjectRepository,
        output_root: Path | str = "outputs",
        worker: Optional[Any] = None,
    ) -> None:
        self.repository = repository
        self.output_root = Path(output_root).resolve()
        self.output_root.mkdir(parents=True, exist_ok=True)
        self.worker = worker
        self._cancelled_workflows: set[str] = set()
        self._lock = threading.Lock()
        self._active_threads: Dict[str, threading.Thread] = {}

    # -------------------------------------------------------------------------
    # Quality Gates
    # -------------------------------------------------------------------------
    def verify_download_gate(self, wf: FullPipelineWorkflowV1, video_path: Path) -> bool:
        """Kiểm tra tính toàn vẹn của video sau khi tải về."""
        if not video_path.exists():
            raise RuntimeError(f"Download gate failed: File không tồn tại ({video_path})")
        if str(video_path).endswith(".part") or str(video_path).endswith(".ytdl"):
            raise RuntimeError(f"Download gate failed: File tải chưa hoàn tất ({video_path.name})")
        size = video_path.stat().st_size
        if size <= 0:
            raise RuntimeError(f"Download gate failed: File rỗng (0 bytes) ({video_path.name})")

        # Probe container và video stream qua ffprobe hoặc cv2
        probe_ok = False
        duration = 0.0
        try:
            cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration:stream=codec_type,width,height",
                "-of", "json",
                str(video_path)
            ]
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15)
            if proc.returncode == 0:
                data = json.loads(proc.stdout)
                streams = data.get("streams", [])
                has_video = any(s.get("codec_type") == "video" for s in streams)
                fmt = data.get("format", {})
                duration = float(fmt.get("duration", 0.0))
                if has_video and duration > 0:
                    probe_ok = True
        except Exception as probe_err:
            logger.warning("ffprobe check warning: %s, fallback to cv2", probe_err)

        if not probe_ok:
            try:
                import cv2
                cap = cv2.VideoCapture(str(video_path))
                if cap.isOpened():
                    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
                    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
                    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                    cap.release()
                    if w > 0 and h > 0 and frames > 0:
                        probe_ok = True
                        duration = frames / fps
            except Exception as cv2_err:
                logger.warning("cv2 check warning: %s", cv2_err)

        if not probe_ok:
            raise RuntimeError(f"Download gate failed: Không phát hiện luồng video hợp lệ trong {video_path.name}")

        wf.quality_metrics["download"] = {
            "size_bytes": size,
            "duration": duration,
            "valid_container": True,
        }
        return True

    def verify_roi_gate(self, wf: FullPipelineWorkflowV1, regions: List[RegionTrackV1]) -> bool:
        """Kiểm tra vùng ROI phát hiện được tuân thủ nghiêm ngặt trong [0, 1]."""
        if not regions:
            raise ValueError("ROI gate failed: Không có vùng ROI nào được chỉ định.")
        for r in regions:
            if r.x < 0.0 or r.x > 1.0:
                raise ValueError(f"ROI gate failed: Tọa độ x={r.x} không nằm trong [0, 1].")
            if r.y < 0.0 or r.y > 1.0:
                raise ValueError(f"ROI gate failed: Tọa độ y={r.y} không nằm trong [0, 1].")
            if r.width <= 0.0 or r.width > 1.0:
                raise ValueError(f"ROI gate failed: Chiều rộng width={r.width} không hợp lệ (phải trong (0, 1]).")
            if r.height <= 0.0 or r.height > 1.0:
                raise ValueError(f"ROI gate failed: Chiều cao height={r.height} không hợp lệ (phải trong (0, 1]).")
            if round(r.x + r.width, 6) > 1.0:
                raise ValueError(f"ROI gate failed: x + width ({r.x} + {r.width} = {r.x + r.width:.4f}) vượt quá 1.0.")
            if round(r.y + r.height, 6) > 1.0:
                raise ValueError(f"ROI gate failed: y + height ({r.y} + {r.height} = {r.y + r.height:.4f}) vượt quá 1.0.")

        wf.quality_metrics["roi"] = {
            "count": len(regions),
            "primary": {"x": regions[0].x, "y": regions[0].y, "w": regions[0].width, "h": regions[0].height},
        }
        return True

    def verify_ocr_gate(self, wf: FullPipelineWorkflowV1, cues: List[SubtitleCueV1]) -> bool:
        """Kiểm tra chất lượng phụ đề nhận diện qua OCR."""
        if not cues:
            raise ValueError("OCR gate failed: Không có câu phụ đề nào được tìm thấy.")

        mock_markers = {"sample text", "mock-ocr", "mock_cue", "dummy text"}
        for c in cues:
            if not c.source_text or not c.source_text.strip():
                raise ValueError(f"OCR gate failed: Cue '{c.cue_id}' có nội dung nguồn rỗng.")
            lower_text = c.source_text.lower()
            if any(m in lower_text for m in mock_markers):
                raise ValueError(f"OCR gate failed: Phát hiện mock text giả lập '{c.source_text}'.")
            if c.start_pts < 0:
                raise ValueError(f"OCR gate failed: start_pts âm ({c.start_pts}) tại cue {c.cue_id}.")
            if c.end_pts <= c.start_pts:
                raise ValueError(f"OCR gate failed: end_pts ({c.end_pts}) <= start_pts ({c.start_pts}) tại cue {c.cue_id}.")

        wf.quality_metrics["ocr"] = {
            "cues_count": len(cues),
            "total_chars": sum(len(c.source_text) for c in cues),
        }
        return True

    def verify_translation_gate(
        self,
        wf: FullPipelineWorkflowV1,
        cues: List[SubtitleCueV1],
        min_coverage: float = 0.98,
    ) -> bool:
        """Kiểm tra kết quả dịch sang tiếng đích (mặc định tiếng Việt) với ngưỡng độ bao phủ tối thiểu 98%."""
        if not cues:
            raise ValueError("Translation gate failed: Danh sách cues rỗng.")

        total = len(cues)
        empty_cues = [c.cue_id for c in cues if not c.translated_text or not c.translated_text.strip()]
        translated_count = total - len(empty_cues)
        coverage = (translated_count / total) if total > 0 else 0.0

        if translated_count == 0:
            raise ValueError("Translation gate failed: 100% câu dịch bị rỗng.")

        # Ngưỡng bao phủ tối thiểu (mặc định 98%)
        if coverage < min_coverage:
            empty_sample = empty_cues[:10]
            raise ValueError(
                f"Translation gate failed: Độ bao phủ bản dịch chỉ đạt {coverage * 100.0:.1f}%, "
                f"dưới ngưỡng tối thiểu yêu cầu {min_coverage * 100.0:.1f}%. "
                f"Có {len(empty_cues)} cue rỗng: {empty_sample}{'...' if len(empty_cues) > 10 else ''}"
            )

        # Chặn rò rỉ nguyên văn nguồn khi source_lang != target_lang
        src_lang = getattr(wf.settings, "source_language", "auto")
        tgt_lang = getattr(wf.settings, "target_language", "vi")
        if src_lang not in ("auto", tgt_lang):
            identical_cues = [
                c.cue_id for c in cues
                if c.source_text and c.translated_text and c.source_text.strip() == c.translated_text.strip()
            ]
            if len(identical_cues) == total:
                raise ValueError("Translation gate failed: Toàn bộ bản dịch sao chép 100% nguyên văn nguồn (rò rỉ source text).")
            elif identical_cues:
                warn_msg = (
                    f"Cảnh báo dịch thuật: Có {len(identical_cues)}/{total} câu giữ nguyên văn nguồn "
                    f"(cần kiểm tra tên riêng / thuật ngữ): {identical_cues[:5]}"
                )
                wf.warnings.append(warn_msg)
                logger.warning(warn_msg)

        wf.quality_metrics["translation"] = {
            "total_cues": total,
            "translated_cues": translated_count,
            "empty_cues": empty_cues,
            "coverage_percent": round(coverage * 100.0, 1),
            "min_coverage_threshold": min_coverage,
        }
        return True

    def verify_dubbing_gate(self, wf: FullPipelineWorkflowV1, voiceover_path: Path) -> bool:
        """Kiểm tra file âm thanh lồng tiếng AI sinh ra."""
        if not voiceover_path.exists():
            raise RuntimeError(f"Dubbing gate failed: File lồng tiếng không tồn tại ({voiceover_path})")
        size = voiceover_path.stat().st_size
        if size <= 100:
            raise RuntimeError(f"Dubbing gate failed: File âm thanh quá nhỏ ({size} bytes)")

        try:
            from subtitle_localizer.dubbing.tts import is_valid_speech_audio
            if not is_valid_speech_audio(voiceover_path.read_bytes()):
                raise RuntimeError("Dubbing gate failed: File MP3 chỉ chứa khoảng lặng hoặc bị lỗi format.")
        except Exception as tts_err:
            if "Dubbing gate failed" in str(tts_err):
                raise
            logger.warning("Speech audio probe warning: %s", tts_err)

        wf.quality_metrics["dubbing"] = {
            "path": str(voiceover_path),
            "size_bytes": size,
            "valid_speech": True,
        }
        return True

    def verify_export_gate(
        self,
        wf: FullPipelineWorkflowV1,
        export_path: Path,
        expect_audio: bool = True,
    ) -> bool:
        """Kiểm tra tính hoàn chỉnh của video MP4 thành phẩm."""
        if not export_path.exists() or not export_path.is_file():
            raise RuntimeError(f"Export gate failed: File video xuất không tồn tại ({export_path})")
        size = export_path.stat().st_size
        if size <= 1000:
            raise RuntimeError(f"Export gate failed: File video quá nhỏ ({size} bytes)")

        has_video = False
        has_audio = False
        duration = 0.0
        try:
            cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "stream=codec_type:format=duration",
                "-of", "json",
                str(export_path)
            ]
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15)
            if proc.returncode == 0:
                data = json.loads(proc.stdout)
                streams = data.get("streams", [])
                has_video = any(s.get("codec_type") == "video" for s in streams)
                has_audio = any(s.get("codec_type") == "audio" for s in streams)
                duration = float(data.get("format", {}).get("duration", 0.0))
        except Exception as ex:
            logger.warning("ffprobe export check warning: %s", ex)

        if not has_video:
            # Fallback check via cv2
            try:
                import cv2
                cap = cv2.VideoCapture(str(export_path))
                if cap.isOpened() and cap.get(cv2.CAP_PROP_FRAME_COUNT) > 0:
                    has_video = True
                    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / (cap.get(cv2.CAP_PROP_FPS) or 25.0)
                cap.release()
            except Exception:
                pass

        if not has_video:
            raise RuntimeError("Export gate failed: File MP4 không chứa luồng video hợp lệ.")
        if wf.settings.dubbing_enabled and not has_audio:
            raise RuntimeError("Export gate failed: Dubbing được bật nhưng file MP4 xuất không chứa luồng audio (audio stream).")
        if expect_audio and not has_audio:
            raise RuntimeError("Export gate failed: Kỳ vọng luồng audio nhưng file MP4 xuất không chứa luồng audio (audio stream).")

        wf.quality_metrics["export"] = {
            "path": str(export_path),
            "size_bytes": size,
            "duration": duration,
            "has_video": has_video,
            "has_audio": has_audio,
        }
        return True

    # -------------------------------------------------------------------------
    # Fallback Logging
    # -------------------------------------------------------------------------
    def record_fallback(
        self,
        wf: FullPipelineWorkflowV1,
        stage: str,
        from_provider: str,
        error: str,
        to_provider: str,
        success: bool = True,
    ) -> None:
        """Ghi log sự kiện fallback theo hợp đồng mục 8."""
        ev = FallbackEventV1(
            stage=stage,
            from_provider=from_provider,
            error=str(error),
            to_provider=to_provider,
            timestamp=time.time(),
            success=success,
        )
        wf.fallback_events.append(ev)
        msg = f"[Fallback] Stage '{stage}': provider '{from_provider}' gặp lỗi ({error}). Chuyển sang '{to_provider}'."
        wf.warnings.append(msg)
        logger.warning(msg)
        self.repository.save_workflow(wf)

    # -------------------------------------------------------------------------
    # Workflow Execution & Control
    # -------------------------------------------------------------------------
    def cancel_workflow(self, workflow_id: str) -> bool:
        """Yêu cầu dừng / hủy một workflow đang chạy."""
        with self._lock:
            self._cancelled_workflows.add(workflow_id)
        wf = self.repository.get_workflow(workflow_id)
        if wf:
            wf.state = "cancelled"
            wf.update_stage(wf.current_stage, status="cancelled")
            self.repository.save_workflow(wf)
            return True
        return False

    def is_cancelled(self, workflow_id: str) -> bool:
        with self._lock:
            return workflow_id in self._cancelled_workflows

    def clear_cancel(self, workflow_id: str) -> None:
        with self._lock:
            self._cancelled_workflows.discard(workflow_id)

    def retry_workflow(
        self,
        workflow_id: str,
        from_stage: Optional[str] = None,
        manual_roi: Optional[Dict[str, float]] = None,
    ) -> bool:
        """Thử lại workflow bị lỗi hoặc cần xem xét, chỉ reset từ stage được chỉ định."""
        wf = self.repository.get_workflow(workflow_id)
        if not wf:
            return False
        self.clear_cancel(workflow_id)

        if manual_roi:
            wf.settings.manual_roi = manual_roi
        if from_stage and from_stage != "downloading":
            wf.settings.pause_after_download = False

        stages_order = ["downloading", "detecting_roi", "ocr", "translating", "dubbing", "exporting"]
        target_stage = from_stage or wf.current_stage or "downloading"
        if target_stage not in stages_order:
            target_stage = "downloading"

        # Đặt lại trạng thái pending cho stage được chỉ định và các stage tiếp theo
        target_idx = stages_order.index(target_stage)
        for idx in range(target_idx, len(stages_order)):
            s_name = stages_order[idx]
            wf.update_stage(s_name, status="pending", progress=0.0)

        wf.state = "retrying"
        wf.current_stage = target_stage
        wf.retry_count += 1
        self.repository.save_workflow(wf)
        self.start_workflow_async(workflow_id)
        return True

    def start_workflow_async(self, workflow_id: str) -> None:
        """Khởi chạy workflow trong luồng nền an toàn."""
        t = threading.Thread(
            target=self._run_workflow_sync,
            args=(workflow_id,),
            name=f"FullPipeline-{workflow_id}",
            daemon=True,
        )
        with self._lock:
            self._active_threads[workflow_id] = t
        t.start()

    def _run_workflow_sync(self, workflow_id: str) -> None:
        """Thực thi tuần tự 6 stage của Full Pipeline với bảo toàn trạng thái, stage-aware resume và quality gates."""
        wf = self.repository.get_workflow(workflow_id)
        if not wf:
            return

        project_dir = self.output_root / (wf.project_id or f"proj_{wf.workflow_id}")
        project_dir.mkdir(parents=True, exist_ok=True)

        try:
            # -------------------------------------------------------------
            # Stage 1: Tải video (Downloading)
            # -------------------------------------------------------------
            video_path: Optional[Path] = None
            skip_download = False
            if wf.artifacts.get("source_video"):
                cand = Path(wf.artifacts["source_video"])
                if cand.exists() and cand.is_file() and cand.stat().st_size > 1000:
                    st_dl = wf.get_stage("downloading")
                    if st_dl and st_dl.status == "completed":
                        skip_download = True
                        video_path = cand
                        manifest = self._ensure_project_manifest(wf, video_path)
                        wf.project_id = manifest.project_id
                        logger.info("Resuming workflow '%s': Reusing downloaded video %s", workflow_id, video_path)

            if not skip_download:
                if self.is_cancelled(workflow_id):
                    wf.transition_to("cancelled")
                    self.repository.save_workflow(wf)
                    return

                if wf.state != "downloading":
                    wf.transition_to("downloading")
                wf.current_stage = "downloading"
                wf.progress = 0.05
                wf.update_stage("downloading", status="running", progress=0.1)
                self.repository.save_workflow(wf)

                video_path = self._execute_download_stage(wf, project_dir)
                self.verify_download_gate(wf, video_path)

                # Khởi tạo hoặc cập nhật ProjectManifest
                manifest = self._ensure_project_manifest(wf, video_path)
                wf.project_id = manifest.project_id
                wf.artifacts["source_video"] = str(video_path).replace("\\", "/")
                wf.update_stage("downloading", status="completed", progress=1.0)
                wf.progress = 0.18
                self.repository.save_workflow(wf)

                if wf.settings.pause_after_download:
                    wf.transition_to("needs_review")
                    msg = "Đã tải video thành công. Đang tạm dừng để người dùng kiểm tra thông số và chọn vùng quét OCR."
                    if msg not in wf.warnings:
                        wf.warnings.append(msg)
                    self.repository.save_workflow(wf)
                    logger.info("Workflow '%s' paused after download as requested by user.", workflow_id)
                    return
            # Stage 2: Tự động dò ROI (Detecting ROI)
            # -------------------------------------------------------------
            manifest = self.repository.get_project(wf.project_id)
            if not manifest:
                raise RuntimeError(f"Project manifest not found: {wf.project_id}")
            video_path = Path(manifest.source_video_path)

            skip_roi = False
            st_roi = wf.get_stage("detecting_roi")
            if st_roi and st_roi.status == "completed" and manifest.regions:
                skip_roi = True
                logger.info("Resuming workflow '%s': Reusing %d detected ROI regions", workflow_id, len(manifest.regions))

            if not skip_roi and wf.state not in ("failed", "cancelled"):
                if self.is_cancelled(workflow_id):
                    wf.transition_to("cancelled")
                    self.repository.save_workflow(wf)
                    return

                if wf.state != "detecting_roi":
                    wf.transition_to("detecting_roi")
                wf.current_stage = "detecting_roi"
                wf.update_stage("detecting_roi", status="running", progress=0.2)
                self.repository.save_workflow(wf)

                regions = self._execute_auto_roi_stage(wf, manifest, video_path)
                self.verify_roi_gate(wf, regions)
                manifest.regions = regions
                self.repository.save_project(manifest)

                wf.artifacts["regions"] = [r.to_dict() for r in regions]
                wf.update_stage("detecting_roi", status="completed", progress=1.0)
                wf.progress = 0.32
                self.repository.save_workflow(wf)

            # -------------------------------------------------------------
            # Stage 3: Quét chữ OCR (OCR Extraction)
            # -------------------------------------------------------------
            existing_cues = self.repository.get_cues(manifest.project_id)
            skip_ocr = False
            st_ocr = wf.get_stage("ocr")
            if st_ocr and st_ocr.status == "completed" and existing_cues:
                skip_ocr = True
                cues = existing_cues
                logger.info("Resuming workflow '%s': Reusing %d OCR cues", workflow_id, len(cues))

            if not skip_ocr and wf.state not in ("failed", "cancelled"):
                if self.is_cancelled(workflow_id):
                    wf.transition_to("cancelled")
                    self.repository.save_workflow(wf)
                    return

                if wf.state != "ocr":
                    wf.transition_to("ocr")
                wf.current_stage = "ocr"
                wf.update_stage("ocr", status="running", progress=0.1)
                self.repository.save_workflow(wf)

                cues = self._execute_ocr_stage(wf, manifest, video_path)
                self.verify_ocr_gate(wf, cues)
                self.repository.save_cues(manifest.project_id, cues)

                wf.artifacts["cues_count"] = len(cues)
                wf.update_stage("ocr", status="completed", progress=1.0)
                wf.progress = 0.55
                self.repository.save_workflow(wf)

            # -------------------------------------------------------------
            # Stage 4: Dịch sang tiếng Việt (Translating)
            # -------------------------------------------------------------
            cues = self.repository.get_cues(manifest.project_id)
            skip_trans = False
            st_trans = wf.get_stage("translating")
            if st_trans and st_trans.status == "completed" and cues:
                trans_count = sum(1 for c in cues if c.translated_text and c.translated_text.strip())
                if trans_count > 0:
                    skip_trans = True
                    logger.info("Resuming workflow '%s': Reusing %d translated cues", workflow_id, trans_count)

            if not skip_trans and wf.state not in ("failed", "cancelled"):
                if self.is_cancelled(workflow_id):
                    wf.transition_to("cancelled")
                    self.repository.save_workflow(wf)
                    return

                if wf.state != "translating":
                    wf.transition_to("translating")
                wf.current_stage = "translating"
                wf.update_stage("translating", status="running", progress=0.1)
                self.repository.save_workflow(wf)

                cues = self.repository.get_cues(manifest.project_id)
                translated_cues = self._execute_translation_stage(wf, manifest, cues)
                self.verify_translation_gate(wf, translated_cues)
                self.repository.save_cues(manifest.project_id, translated_cues)

                wf.artifacts["translated_count"] = len(translated_cues)
                wf.update_stage("translating", status="completed", progress=1.0)
                wf.progress = 0.72
                self.repository.save_workflow(wf)

            # -------------------------------------------------------------
            # Stage 5: Lồng tiếng AI (Dubbing TTS)
            # -------------------------------------------------------------
            voiceover_path: Optional[Path] = None
            skip_dubbing = False
            if not wf.settings.dubbing_enabled:
                skip_dubbing = True
                wf.update_stage("dubbing", status="skipped", progress=1.0, metrics={"note": "Lồng tiếng tắt"})
                self.repository.save_workflow(wf)
            else:
                st_dub = wf.get_stage("dubbing")
                if st_dub and st_dub.status == "completed" and wf.artifacts.get("voiceover_path"):
                    cand_vo = Path(wf.artifacts["voiceover_path"])
                    if cand_vo.exists() and cand_vo.stat().st_size > 100:
                        skip_dubbing = True
                        voiceover_path = cand_vo
                        logger.info("Resuming workflow '%s': Reusing existing voiceover %s", workflow_id, voiceover_path)

            if not skip_dubbing and wf.state not in ("failed", "cancelled"):
                if self.is_cancelled(workflow_id):
                    wf.transition_to("cancelled")
                    self.repository.save_workflow(wf)
                    return

                if wf.state != "dubbing":
                    wf.transition_to("dubbing")
                wf.current_stage = "dubbing"
                wf.update_stage("dubbing", status="running", progress=0.1)
                self.repository.save_workflow(wf)

                voiceover_path = self._execute_dubbing_stage(wf, manifest, project_dir)
                self.verify_dubbing_gate(wf, voiceover_path)
                manifest.has_voiceover = True
                manifest.voiceover_path = str(voiceover_path).replace("\\", "/")
                self.repository.save_project(manifest)
                wf.artifacts["voiceover_path"] = str(voiceover_path).replace("\\", "/")
                wf.update_stage("dubbing", status="completed", progress=1.0)
                wf.progress = 0.86
                self.repository.save_workflow(wf)

            # -------------------------------------------------------------
            # Stage 6: Che sub gốc & Xuất MP4 (Exporting)
            # -------------------------------------------------------------
            if wf.state not in ("failed", "cancelled"):
                if self.is_cancelled(workflow_id):
                    wf.transition_to("cancelled")
                    self.repository.save_workflow(wf)
                    return

                if wf.state != "exporting":
                    wf.transition_to("exporting")
                wf.current_stage = "exporting"
                wf.update_stage("exporting", status="running", progress=0.1)
                self.repository.save_workflow(wf)

                cues = self.repository.get_cues(manifest.project_id)
                export_mp4_path = self._execute_export_stage(wf, manifest, cues, project_dir, voiceover_path)
                self.verify_export_gate(wf, export_mp4_path, expect_audio=wf.settings.dubbing_enabled)

                manifest.has_export = True
                manifest.export_path = str(export_mp4_path).replace("\\", "/")
                manifest.export_file_size_bytes = export_mp4_path.stat().st_size
                self.repository.save_project(manifest)

                wf.artifacts["export_mp4"] = str(export_mp4_path).replace("\\", "/")
                wf.update_stage("exporting", status="completed", progress=1.0)
                wf.progress = 1.0
                wf.transition_to("completed")
                self.repository.save_workflow(wf)
                logger.info("Workflow '%s' completed successfully. Project ID: %s", workflow_id, manifest.project_id)

        except Exception as exc:
            err_str = str(exc)
            logger.error("Full Pipeline workflow '%s' failed at stage '%s': %s", workflow_id, wf.current_stage, err_str, exc_info=True)
            wf.errors.append(err_str)
            wf.update_stage(wf.current_stage, status="failed", error=err_str)
            try:
                wf.transition_to("failed")
            except Exception:
                wf.state = "failed"
            self.repository.save_workflow(wf)

    # -------------------------------------------------------------------------
    # Stage Helpers
    # -------------------------------------------------------------------------
    def _execute_download_stage(self, wf: FullPipelineWorkflowV1, project_dir: Path) -> Path:
        """Tải video từ URL hoặc dùng video có sẵn nếu là file cục bộ."""
        target = wf.source_url.strip()
        # 1. Nếu là đường dẫn file cục bộ đã tồn tại (dùng cho tests/fixture)
        local_p = Path(target)
        if local_p.is_file() and local_p.exists():
            dest = project_dir / local_p.name
            if local_p != dest:
                shutil.copyfile(str(local_p), str(dest))
            return dest

        # 2. Tải qua downloader engine
        from subtitle_localizer.service.downloader import parse_media_target, DownloadManager
        target_info = parse_media_target(target, proxy=wf.settings.proxy)
        wf.title = target_info.get("title") or wf.title or "Video Full Pipeline"
        wf.thumbnail_url = target_info.get("cover_url") or wf.thumbnail_url

        dl_manager = DownloadManager(
            repository=self.repository,
            uploads_dir=project_dir,
        )
        dl_manager.start_download(
            target_info=target_info,
            output_dir=str(project_dir),
            auto_create_project=False,
            target_resolution=wf.settings.target_resolution,
            proxy=wf.settings.proxy,
            strict_proxy=bool(wf.settings.proxy and str(wf.settings.proxy).strip()),
            cookie_source=wf.settings.cookie_source,
        )

        # Chờ download hoàn tất
        t0 = time.time()
        while time.time() - t0 < 600:
            if self.is_cancelled(wf.workflow_id):
                dl_manager.cancel()
                raise InterruptedError("Download đã bị người dùng hủy.")
            st = dl_manager.get_status()
            if st.get("status") in ("error", "failed"):
                raise RuntimeError(f"Download thất bại: {st.get('error') or st.get('message') or 'Lỗi tải video'}")
            if not st.get("is_downloading") and st.get("status") in ("completed", "done"):
                break
            time.sleep(0.5)

        # Tìm file mp4/mkv/webm tải về (bao gồm cả thư mục con do downloader tạo)
        candidates = [
            f for f in (list(project_dir.rglob("*.mp4")) + list(project_dir.rglob("*.mkv")) + list(project_dir.rglob("*.webm")))
            if not f.name.endswith(".part") and not f.name.endswith(".ytdl") and not "-localized" in f.name
        ]
        if not candidates:
            raise RuntimeError("Download hoàn tất nhưng không tìm thấy file video đầu ra.")
        best_cand = max(candidates, key=lambda f: f.stat().st_mtime)
        if best_cand.parent != project_dir:
            dest = project_dir / best_cand.name
            shutil.move(str(best_cand), str(dest))
            return dest
        return best_cand

    def _ensure_project_manifest(self, wf: FullPipelineWorkflowV1, video_path: Path) -> ProjectManifestV1:
        """Tạo hoặc nạp manifest dự án tương ứng."""
        if wf.project_id:
            existing = self.repository.get_project(wf.project_id)
            if existing:
                return existing

        proj_id = f"proj-{uuid.uuid4().hex[:8]}"
        title = wf.title or video_path.stem
        manifest = ProjectManifestV1(
            project_id=proj_id,
            title=title,
            source_video_path=str(video_path).replace("\\", "/"),
            video_fingerprint="fp_" + uuid.uuid4().hex[:12],
            source_language=wf.settings.source_language,
            target_language=wf.settings.target_language,
            active_revision=1,
        )
        self.repository.save_project(manifest)
        return manifest

    def _execute_auto_roi_stage(
        self,
        wf: FullPipelineWorkflowV1,
        manifest: ProjectManifestV1,
        video_path: Path,
    ) -> List[RegionTrackV1]:
        """Dò vùng phụ đề tự động bằng RapidOCR trên các frame đại diện hoặc áp dụng vùng thủ công."""
        # 1. Nếu người dùng chọn vùng thủ công trước hoặc qua settings
        if wf.settings.manual_roi:
            m = wf.settings.manual_roi
            rx = max(0.0, min(0.99, float(m.get("x", 0.08))))
            ry = max(0.0, min(0.99, float(m.get("y", 0.82))))
            rw = max(0.01, min(1.0 - rx, float(m.get("width", 0.84))))
            rh = max(0.01, min(1.0 - ry, float(m.get("height", 0.12))))
            logger.info("Applying manual ROI from workflow settings: x=%.3f, y=%.3f, w=%.3f, h=%.3f", rx, ry, rw, rh)
            return [RegionTrackV1(
                region_id=f"roi-{uuid.uuid4().hex[:8]}",
                x=rx,
                y=ry,
                width=rw,
                height=rh,
                valid_start_pts=0.0,
                valid_end_pts=float("inf"),
            )]

        # 2. Nếu project manifest đã có regions (do người dùng chỉnh sửa trong studio editor lúc pause)
        if manifest.regions:
            logger.info("Reusing %d regions from project manifest", len(manifest.regions))
            return manifest.regions

        import cv2

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"Không thể mở file video để dò ROI: {video_path}")

        vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
        vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
        total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        duration = total_frames / fps if total_frames > 0 else 10.0

        # Lấy 10 mốc thời gian đại diện để tìm dải phụ đề đối thoại
        pts_to_check = [duration * p for p in (0.08, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.92)]
        best_roi: Optional[RegionTrackV1] = None
        is_portrait = vh > vw
        # Phụ đề đối thoại luôn nằm ở nửa dưới khung hình (đặc biệt là 65%-96% chiều cao)
        min_sub_y = 0.55 if is_portrait else 0.65
        max_sub_y = 0.96
        target_lang = (wf.settings.source_language or "zh").lower()
        dialogue_lang_boxes = []
        dialogue_boxes = []
        lang_matched_boxes = []
        candidate_boxes = []

        try:
            from subtitle_localizer.ocr.rapid import RapidOcrProvider
            ocr_p = RapidOcrProvider()
            ocr_p.load()
            engine = ocr_p.engine
        except Exception:
            engine = None

        if engine is None:
            try:
                from rapidocr_onnxruntime import RapidOCR
                engine = RapidOCR(det_use_cuda=False, cls_use_cuda=False, rec_use_cuda=False)
            except Exception as engine_err:
                logger.warning("RapidOCR engine not available: %s", engine_err)

        if engine is not None:
            for pts in pts_to_check:
                cap.set(cv2.CAP_PROP_POS_MSEC, pts * 1000)
                ret, frame = cap.read()
                if not ret or frame is None:
                    continue
                try:
                    res, _ = engine(frame)
                except Exception:
                    res = None
                if not res:
                    continue

                for item in res:
                    box, text, score = item
                    xs = [pt[0] for pt in box]
                    ys = [pt[1] for pt in box]
                    norm_y = min(ys) / vh
                    norm_h = (max(ys) - min(ys)) / vh
                    norm_x = min(xs) / vw
                    norm_w = (max(xs) - min(xs)) / vw
                    center_x = norm_x + norm_w * 0.5

                    # Lọc biên ngang: Phụ đề đối thoại/nội dung luôn căn giữa
                    if center_x < 0.10 or center_x > 0.90 or norm_w < 0.04:
                        continue
                    if norm_y > max_sub_y:
                        continue

                    # 1. Khớp ngôn ngữ nguồn: Chữ Hán/CJK khi source là zh/ja/ko hoặc auto
                    has_cjk = bool(re.search(r"[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]", text or ""))
                    if (target_lang in ("zh", "ja", "ko", "auto")) and has_cjk:
                        if norm_y >= min_sub_y:
                            dialogue_lang_boxes.append((norm_x, norm_y, norm_w, norm_h))
                        elif norm_y >= 0.15:
                            lang_matched_boxes.append((norm_x, norm_y, norm_w, norm_h))

                    # 2. Vùng đối thoại nửa dưới (chuẩn phim review/phim truyện)
                    if norm_y >= min_sub_y:
                        dialogue_boxes.append((norm_x, norm_y, norm_w, norm_h))

                    # 3. Vùng ứng viên chung (giữa và dưới)
                    if norm_y >= 0.15:
                        candidate_boxes.append((norm_x, norm_y, norm_w, norm_h))

            # Ưu tiên 1: Box phụ đề đối thoại khớp ngôn ngữ nguồn ở dải đáy (tránh bắt nhầm watermark/logo trên đỉnh)
            # Ưu tiên 2: Box đối thoại đáy màn hình nói chung
            # Ưu tiên 3: Box khớp ngôn ngữ nguồn ở bất kỳ đâu (dành cho video học tiếng, đọc câu giữa màn hình)
            # Ưu tiên 4: Box ứng viên chung
            chosen_boxes = []
            if dialogue_lang_boxes:
                chosen_boxes = dialogue_lang_boxes
            elif dialogue_boxes:
                chosen_boxes = dialogue_boxes
            elif lang_matched_boxes:
                chosen_boxes = lang_matched_boxes
            elif candidate_boxes:
                chosen_boxes = candidate_boxes

            if chosen_boxes:
                detected_min_y = min(b[1] for b in chosen_boxes)
                detected_max_y = max(b[1] + b[3] for b in chosen_boxes)
                min_y = max(0.04, detected_min_y - 0.02)
                max_y = min(0.98, detected_max_y + 0.02)
                # Dải phụ đề review phim/phim truyện luôn cần chiều ngang bao quát đẹp như kênh review chuyên nghiệp
                detected_min_x = min(b[0] for b in chosen_boxes)
                detected_max_x = max(b[0] + b[2] for b in chosen_boxes)
                min_x = max(0.04, min(0.08, detected_min_x - 0.03))
                max_x = min(0.96, max(0.92, detected_max_x + 0.03))
                w = round(min(1.0 - min_x, max(0.2, max_x - min_x)), 3)
                h = round(min(1.0 - min_y, max(0.06, max_y - min_y)), 3)
                best_roi = RegionTrackV1(
                    region_id="roi-auto",
                    x=round(min_x, 3),
                    y=round(min_y, 3),
                    width=w,
                    height=h,
                    mask_enabled=True,
                )

        cap.release()

        if not best_roi:
            # Fallback về ROI mặc định chuẩn hình học (landscape vs portrait)
            is_portrait = vh > vw
            if is_portrait:
                best_roi = RegionTrackV1(region_id="roi-main", x=0.03, y=0.68, width=0.94, height=0.14, mask_enabled=True)
            else:
                best_roi = RegionTrackV1(region_id="roi-main", x=0.05, y=0.78, width=0.90, height=0.12, mask_enabled=True)
            self.record_fallback(
                wf=wf,
                stage="detecting_roi",
                from_provider="ocr_detector",
                error="Không bắt được text box mẫu, áp dụng ROI hình học tối ưu",
                to_provider="geometric_propose",
            )

        return [best_roi]

    def _execute_ocr_stage(
        self,
        wf: FullPipelineWorkflowV1,
        manifest: ProjectManifestV1,
        video_path: Path,
    ) -> List[SubtitleCueV1]:
        """Thực thi OCR trích xuất phụ đề."""
        # Nếu có BackgroundWorker, dùng logic quét pipeline chuẩn
        if self.worker is not None:
            success = self.worker.run_pipeline_synchronous(manifest.project_id, ocr_only=True)
            cues = self.repository.get_cues(manifest.project_id)
            if cues:
                return cues

        # Quét trực tiếp bằng sampler & RapidOCR
        from subtitle_localizer.ocr.rapid import RapidOcrProvider
        from subtitle_localizer.detector.sampler import AdaptiveFrameSampler
        from subtitle_localizer.reconstruction.builder import CueReconstructor

        sampler = AdaptiveFrameSampler(sample_fps=2.0)
        roi = manifest.regions[0] if manifest.regions else None
        roi_tuple = (roi.x, roi.y, roi.width, roi.height) if roi else None

        crops, pts_list = sampler.sample_video_frames(
            video_path=video_path,
            roi_norm=roi_tuple,
        )

        ocr_p = RapidOcrProvider()
        ocr_p.load()
        try:
            observations = ocr_p.recognize(
                crops=crops,
                pts_list=pts_list,
                language=wf.settings.source_language if wf.settings.source_language != "auto" else "zh",
            )
            # Fallback nếu crop ROI không bắt được chữ, quét toàn khung hình (full frame)
            if not observations and roi_tuple is not None:
                logger.info("Quét OCR với ROI không có kết quả, tự động fallback quét toàn màn hình...")
                crops_full, pts_full = sampler.sample_video_frames(
                    video_path=video_path,
                    roi_norm=(0.0, 0.0, 1.0, 1.0),
                )
                observations = ocr_p.recognize(
                    crops=crops_full,
                    pts_list=pts_full,
                    language=wf.settings.source_language if wf.settings.source_language != "auto" else "zh",
                )
        finally:
            ocr_p.unload()

        reconstructor = CueReconstructor(min_cue_duration=0.3, lead_in=0.05, lead_out=0.05)
        cues = reconstructor.build_cues(observations)

        if not cues and observations:
            # Reconstruct đơn giản nếu cues rỗng nhưng có observations
            cues = [
                SubtitleCueV1(
                    cue_id=f"cue-{idx+1:04d}",
                    start_pts=obs.pts,
                    end_pts=obs.pts + 1.5,
                    source_text=obs.normalized_text or obs.raw_text,
                    confidence=obs.confidence,
                )
                for idx, obs in enumerate(observations)
                if (obs.normalized_text or obs.raw_text) and (obs.normalized_text or obs.raw_text).strip()
            ]

        if not cues:
            raise ValueError("Không nhận diện được dòng phụ đề nào qua OCR.")
        return cues

    def _execute_translation_stage(
        self,
        wf: FullPipelineWorkflowV1,
        manifest: ProjectManifestV1,
        cues: List[SubtitleCueV1],
    ) -> List[SubtitleCueV1]:
        """Dịch phụ đề sang ngôn ngữ đích (mặc định tiếng Việt) sử dụng TranslationRegistry."""
        source_lang = wf.settings.source_language if wf.settings.source_language != "auto" else (manifest.source_language or "zh")
        target_lang = wf.settings.target_language or manifest.target_language or "vi"

        from subtitle_localizer.translation.registry import TranslationRegistry
        registry = TranslationRegistry()

        candidate_names = ["real", "gemini", "gemma", "nllb", "opus"]
        successful_cues: Optional[List[SubtitleCueV1]] = None
        last_error: Optional[Exception] = None

        for idx, provider_name in enumerate(candidate_names):
            provider = registry.get_provider(provider_name)
            if not provider:
                continue

            if self.is_cancelled(wf.workflow_id):
                raise InterruptedError("Dịch thuật đã bị người dùng hủy.")

            try:
                provider.load()
                try:
                    res_cues = provider.translate_cues(
                        cues=cues,
                        source_lang=source_lang,
                        target_lang=target_lang,
                    )
                    valid_translated = [c for c in res_cues if c.translated_text and c.translated_text.strip()]
                    cov = len(valid_translated) / len(res_cues) if res_cues else 0.0
                    if cov >= 0.98:
                        successful_cues = res_cues
                        break
                    else:
                        raise ValueError(
                            f"Provider {provider_name} không đạt ngưỡng bao phủ 98% "
                            f"({cov * 100.0:.1f}%, {len(valid_translated)}/{len(res_cues)} câu)"
                        )
                finally:
                    provider.unload()
            except Exception as exc:
                last_error = exc
                next_provider = candidate_names[idx + 1] if idx + 1 < len(candidate_names) else "none"
                self.record_fallback(
                    wf=wf,
                    stage="translating",
                    from_provider=provider_name,
                    error=str(exc),
                    to_provider=next_provider,
                )
                logger.warning(
                    "Translation provider %s failed for workflow %s: %s. Falling back to %s",
                    provider_name, wf.workflow_id, exc, next_provider
                )

        if not successful_cues:
            raise RuntimeError(
                f"Tất cả các engine dịch thuật ({', '.join(candidate_names)}) đều không tạo được bản dịch hợp lệ. "
                f"Lỗi cuối: {last_error}"
            )

        return successful_cues

    def _execute_dubbing_stage(
        self,
        wf: FullPipelineWorkflowV1,
        manifest: ProjectManifestV1,
        project_dir: Path,
    ) -> Path:
        """Sinh file âm thanh lồng tiếng AI MP3."""
        from subtitle_localizer.service.project_runtime import run_project_dubbing

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            output = loop.run_until_complete(
                run_project_dubbing(
                    repository=self.repository,
                    project_id=manifest.project_id,
                    output_root=self.output_root,
                    options={
                        "provider": "edge",
                        "voice": wf.settings.voice,
                        "rate": "+0%",
                    },
                )
            )
            return Path(output)
        finally:
            loop.close()

    def _execute_export_stage(
        self,
        wf: FullPipelineWorkflowV1,
        manifest: ProjectManifestV1,
        cues: List[SubtitleCueV1],
        project_dir: Path,
        voiceover_path: Optional[Path] = None,
    ) -> Path:
        """Xuất file MP4 localized kèm phụ đề ASS/SRT."""
        source_path = Path(manifest.source_video_path)
        output_mp4 = project_dir / f"{source_path.stem}-localized.mp4"

        # Xuất file SRT & ASS
        from subtitle_localizer.render.ass import AssExporter
        srt_path = project_dir / f"{source_path.stem}.vi.srt"
        ass_path = project_dir / f"{source_path.stem}.vi.ass"

        if wf.settings.export_srt_ass:
            from subtitle_localizer.render.srt import SrtExporter
            srt_path.write_text(SrtExporter().export_srt_text(cues, use_translated=True), encoding="utf-8")
            ass_path.write_text(AssExporter().export_ass_text(cues, script_title=manifest.title, use_translated=True), encoding="utf-8")
            wf.artifacts["srt_path"] = str(srt_path).replace("\\", "/")
            wf.artifacts["ass_path"] = str(ass_path).replace("\\", "/")

        from subtitle_localizer.service.export_service import do_export_mp4
        rendered_str = do_export_mp4(
            repository=self.repository,
            resolved_output_root=self.output_root,
            project_id=manifest.project_id,
            mask_mode=wf.settings.mask_mode if wf.settings.mask_subtitles else "none",
            use_translated=wf.settings.burn_subtitles,
            voiceover_path=voiceover_path,
        )
        return Path(rendered_str)
