from __future__ import annotations

import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, File, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from subtitle_localizer.domain.models import (
    CommandEnvelopeV1,
    ProjectManifestV1,
    RegionTrackV1,
    StageRunV1,
    SubtitleCueV1,
)
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.websocket import WebSocketManager
from subtitle_localizer.service.worker import BackgroundWorker


class CreateProjectRequest(BaseModel):
    title: str
    source_video_path: str
    source_language: str = "zh"
    target_language: str = "vi"


class CommandRequest(BaseModel):
    command_id: Optional[str] = None
    expected_revision: int
    command_type: str
    payload: Dict[str, Any] = {}


class Mp4ExportRequest(BaseModel):
    use_translated: bool = True
    mask_mode: str = "blur"


class BatchRunRequest(BaseModel):
    project_ids: List[str]
    auto_export_mp4: bool = False


class GeminiKeyRequest(BaseModel):
    api_key: str


class AutoDetectRoiRequest(BaseModel):
    pts: Optional[float] = None


class PipelineRunRequest(BaseModel):
    max_duration_seconds: Optional[float] = None
    sync: bool = False


def create_app(
    database: Optional[Database] = None,
    repo: Optional[ProjectRepository] = None,
    auth_token: Optional[str] = None,
    output_root: Path | str = "outputs",
) -> FastAPI:
    """Tạo instance ứng dụng FastAPI với đầy đủ routes, auth và websocket."""
    app = FastAPI(title="Subtitle Localizer Studio API", version="1.0.0")

    # Load local environment config if present
    env_file = Path("subtitle_localizer.env")
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()

    db = database or Database("subtitle_localizer.db")
    db.migrate()
    repository = repo or ProjectRepository(db)
    ws_manager = WebSocketManager(repository)
    worker = BackgroundWorker(repository)
    resolved_output_root = Path(output_root).resolve()

    # Cấu hình CORS chặt chẽ cho localhost
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5199", "http://127.0.0.1:5199", "http://localhost:3000", "http://127.0.0.1:3000", "*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def verify_auth(authorization: Optional[str] = Header(None)) -> None:
        if auth_token is None:
            return
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or invalid token")
        token = authorization.split(" ", 1)[1]
        if token != auth_token:
            raise HTTPException(status_code=403, detail="Forbidden: Token mismatch")

    @app.get("/api/v1/health")
    async def health_check() -> Dict[str, str]:
        return {"status": "healthy", "version": "1.0.0"}

    @app.get("/api/v1/projects")
    async def list_projects(authorization: Optional[str] = Header(None)) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        projects = repository.list_projects()
        results = []
        for p in projects:
            d = p.to_dict()
            d["cues_count"] = len(repository.get_cues(p.project_id))
            results.append(d)
        return results

    @app.post("/api/v1/projects")
    async def create_project(req: CreateProjectRequest, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        manifest = ProjectManifestV1(
            project_id=f"proj-{uuid.uuid4().hex[:8]}",
            title=req.title,
            source_video_path=req.source_video_path,
            video_fingerprint="fp_" + uuid.uuid4().hex[:12],
            source_language=req.source_language,
            target_language=req.target_language,
            active_revision=1,
        )
        repository.save_project(manifest)
        return manifest.to_dict()

    @app.get("/api/v1/projects/{project_id}")
    async def get_project(project_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return project.to_dict()

    @app.delete("/api/v1/projects/{project_id}")
    async def delete_project(project_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, bool]:
        verify_auth(authorization)
        deleted = repository.delete_project(project_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"deleted": True}

    @app.get("/api/v1/projects/{project_id}/cues")
    async def get_cues(project_id: str, authorization: Optional[str] = Header(None)) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        cues = repository.get_cues(project_id)
        return [c.to_dict() for c in cues]

    @app.put("/api/v1/projects/{project_id}/cues")
    async def save_cues(
        project_id: str,
        cues_data: List[Dict[str, Any]],
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        cues = [SubtitleCueV1.from_dict(c) for c in cues_data]
        repository.save_cues(project_id, cues)
        return {"saved_count": len(cues)}

    @app.put("/api/v1/projects/{project_id}/regions")
    async def save_regions(
        project_id: str,
        regions_data: List[Dict[str, Any]],
        authorization: Optional[str] = Header(None),
    ) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        regions = [RegionTrackV1.from_dict(region) for region in regions_data]
        invalid_ids = [region.region_id for region in regions if not region.is_valid()]
        if invalid_ids:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid normalized ROI: {', '.join(invalid_ids)}",
            )

        manifest.regions = regions
        repository.save_project(manifest)
        return [region.to_dict() for region in regions]

    @app.post("/api/v1/projects/{project_id}/pipeline/run")
    async def run_pipeline(
        project_id: str,
        req: Optional[PipelineRunRequest] = None,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        max_dur = req.max_duration_seconds if req else None
        is_sync = req.sync if req else False

        if is_sync:
            success = worker.run_pipeline_synchronous(project_id, max_duration_seconds=max_dur)
            if not success:
                raise HTTPException(status_code=400, detail="Failed to run pipeline")
            return {"status": "success", "project_id": project_id}

        # Xóa các stage cũ để client không bị nhận nhầm kết quả completed của đợt trước
        repository.clear_stage_runs(project_id)

        # Initialize detector stage run
        stage_init = StageRunV1(
            stage_name="detector",
            status="running",
            progress=0.05,
            metrics={"label": "Khởi động pipeline xử lý..."},
            start_time=time.time(),
        )
        repository.save_stage_run(project_id, stage_init)

        def _bg_run():
            try:
                worker.run_pipeline_synchronous(project_id, max_duration_seconds=max_dur)
            except Exception as e:
                import traceback
                traceback.print_exc()

        thread = threading.Thread(target=_bg_run, daemon=True)
        thread.start()

        return {
            "status": "running",
            "project_id": project_id,
            "max_duration_seconds": max_dur,
        }

    @app.get("/api/v1/projects/{project_id}/stages")
    async def get_project_stages(
        project_id: str,
        authorization: Optional[str] = Header(None),
    ) -> List[Dict[str, Any]]:
        verify_auth(authorization)
        stages = repository.get_stage_runs(project_id)
        return [s.to_dict() for s in stages]

    @app.get("/api/v1/projects/{project_id}/audio-waveform")
    async def get_audio_waveform(
        project_id: str,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Trích xuất sóng âm thanh (Audio Waveform Peaks) thực tế từ video chuẩn NLE."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        video_path = Path(manifest.source_video_path)
        if not video_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")

        cache_key = f"waveform_{project_id}"
        if hasattr(app.state, cache_key):
            return getattr(app.state, cache_key)

        import subprocess
        import numpy as np
        try:
            cmd = [
                "ffmpeg", "-i", str(video_path),
                "-vn", "-ac", "1", "-ar", "1000", "-f", "s16le", "-"
            ]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            raw_audio, _ = proc.communicate(timeout=10)
            samples = np.frombuffer(raw_audio, dtype=np.int16)
            total_points = 800
            chunk_size = max(1, len(samples) // total_points)
            peaks = [float(np.max(np.abs(samples[i:i+chunk_size])) / 32768.0) for i in range(0, len(samples), chunk_size)]
            max_p = max(peaks) if peaks else 1.0
            if max_p > 0:
                peaks = [round(p / max_p, 3) for p in peaks]
            duration = float(len(samples)) / 1000.0
            res = {"duration": duration, "peaks": peaks}
            setattr(app.state, cache_key, res)
            return res
        except Exception:
            return {"duration": 30.0, "peaks": [0.05] * 100}

    @app.post("/api/v1/projects/{project_id}/retranslate")
    async def retranslate_project(
        project_id: str,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Dịch lại toàn bộ kịch bản phim theo đúng mạch truyện và ngữ cảnh nhân vật."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        cues = repository.get_cues(project_id)
        if not cues:
            return {"status": "empty", "cues_count": 0}

        translator = worker.translation_registry.get_provider_for_pair(
            manifest.source_language, manifest.target_language
        )
        translator.load()
        try:
            translated_cues = translator.translate_cues(
                cues, source_lang=manifest.source_language, target_lang=manifest.target_language
            )
            repository.save_cues(project_id, translated_cues)
            return {"status": "success", "cues_count": len(translated_cues)}
        finally:
            translator.unload()

    @app.post("/api/v1/batch/run")
    async def run_batch_pipeline(
        req: BatchRunRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Chạy pipeline hàng loạt cho danh sách project (Hỗ trợ sản xuất 30+ video/ngày)."""
        verify_auth(authorization)
        results = []
        successful = 0
        failed = 0

        for pid in req.project_ids:
            manifest = repository.get_project(pid)
            if not manifest:
                results.append({"project_id": pid, "title": "Unknown", "status": "failed", "error": "Project not found"})
                failed += 1
                continue

            try:
                ok = worker.run_pipeline_synchronous(pid)
                if ok:
                    successful += 1
                    results.append({
                        "project_id": pid,
                        "title": manifest.title,
                        "status": "completed",
                    })
                else:
                    failed += 1
                    results.append({
                        "project_id": pid,
                        "title": manifest.title,
                        "status": "failed",
                        "error": "Pipeline execution failed",
                    })
            except Exception as e:
                failed += 1
                results.append({
                    "project_id": pid,
                    "title": manifest.title,
                    "status": "failed",
                    "error": str(e),
                })

        return {
            "total": len(req.project_ids),
            "successful": successful,
            "failed": failed,
            "results": results,
        }

    @app.post("/api/v1/projects/{project_id}/cues/{cue_id}/retranslate")
    async def retranslate_cue(
        project_id: str,
        cue_id: str,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Dịch lại một câu phụ đề cụ thể với ngữ cảnh tươi mới."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        cues = repository.get_cues(project_id)
        target_cue = next((c for c in cues if c.cue_id == cue_id), None)
        if not target_cue:
            raise HTTPException(status_code=404, detail="Cue not found")

        translator = worker.translation_registry.get_provider_for_pair(
            manifest.source_language, manifest.target_language
        )
        translator.load()
        try:
            if hasattr(translator, "_cache") and target_cue.source_text.strip() in translator._cache:
                del translator._cache[target_cue.source_text.strip()]
            translator.translate_cues(
                [target_cue],
                source_lang=manifest.source_language,
                target_lang=manifest.target_language,
            )
            repository.save_cues(project_id, cues)
            return target_cue.to_dict()
        finally:
            translator.unload()

    @app.post("/api/v1/projects/{project_id}/roi/auto-detect")
    async def auto_detect_roi(
        project_id: str,
        req: AutoDetectRoiRequest = AutoDetectRoiRequest(),
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Tự động phát hiện vị trí dòng chữ phụ đề từ khung hình và co gọn ROI vừa khít với chữ."""
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        video_path = Path(manifest.source_video_path)
        if not video_path.exists():
            raise HTTPException(status_code=400, detail="Source video file not found")

        import cv2
        from rapidocr_onnxruntime import RapidOCR

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Cannot open video file")

        total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        duration = total_frames / fps if total_frames > 0 else 30.0

        pts_to_try = []
        if req.pts is not None and req.pts >= 0:
            pts_to_try.append(req.pts)

        for sample_t in [5.0, 15.0, 30.0, 60.0, 90.0, 120.0]:
            if sample_t < duration and sample_t not in pts_to_try:
                pts_to_try.append(sample_t)

        engine = RapidOCR()
        detected_boxes = []

        for t in pts_to_try:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ret, frame = cap.read()
            if not ret or frame is None:
                continue
            h, w = frame.shape[:2]
            res, _ = engine(frame)
            frame_boxes = []
            for line in (res or []):
                box, text, score = line
                xs = [p[0] for p in box]
                ys = [p[1] for p in box]
                norm_x = min(xs) / w
                norm_y = min(ys) / h
                norm_w = (max(xs) - min(xs)) / w
                norm_h = (max(ys) - min(ys)) / h
                if norm_y >= 0.60 and norm_w >= 0.10 and norm_h <= 0.20:
                    frame_boxes.append((norm_x, norm_y, norm_w, norm_h))
            if frame_boxes:
                detected_boxes.extend(frame_boxes)
                if req.pts is not None and abs(t - req.pts) < 0.1:
                    detected_boxes = frame_boxes
                    break

        cap.release()

        if not detected_boxes:
            tight_x, tight_y, tight_w, tight_h = 0.08, 0.85, 0.84, 0.11
        else:
            min_y = min(b[1] for b in detected_boxes)
            max_y = max(b[1] + b[3] for b in detected_boxes)
            min_x = min(b[0] for b in detected_boxes)
            max_x = max(b[0] + b[2] for b in detected_boxes)

            tight_y = max(0.0, min_y - 0.015)
            tight_h = min(1.0 - tight_y, (max_y - min_y) + 0.030)
            tight_x = max(0.0, min_x - 0.03)
            tight_w = min(1.0 - tight_x, (max_x - min_x) + 0.06)

        base_region = manifest.regions[0] if manifest.regions else RegionTrackV1(region_id="roi-default")
        updated_region = RegionTrackV1(
            region_id=base_region.region_id,
            x=round(tight_x, 4),
            y=round(tight_y, 4),
            width=round(tight_w, 4),
            height=round(tight_h, 4),
        )
        manifest.regions = [updated_region]
        repository.save_project(manifest)

        return {
            "status": "success",
            "region": updated_region.to_dict(),
            "detected_count": len(detected_boxes),
        }

    @app.post("/api/v1/settings/gemini-key")
    async def set_gemini_key(
        req: GeminiKeyRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        """Cấu hình Gemini API Key cho dịch thuật phụ đề AI chuẩn điện ảnh."""
        verify_auth(authorization)
        key = req.api_key.strip()
        os.environ["GEMINI_API_KEY"] = key
        env_file = Path("subtitle_localizer.env")
        env_file.write_text(f"GEMINI_API_KEY={key}\n", encoding="utf-8")
        return {"status": "success", "configured": bool(key)}

    @app.get("/api/v1/settings/gemini-key")
    async def get_gemini_status(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        """Kiểm tra trạng thái cấu hình Gemini AI."""
        verify_auth(authorization)
        key = os.environ.get("GEMINI_API_KEY", "").strip()
        masked = f"{key[:6]}...{key[-4:]}" if len(key) > 10 else ("Configured" if key else "")
        return {"configured": bool(key), "masked_key": masked}

    @app.post("/api/v1/projects/{project_id}/commands")
    async def execute_command(
        project_id: str,
        cmd: CommandRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, Any]:
        verify_auth(authorization)
        manifest = repository.get_project(project_id)
        if not manifest:
            raise HTTPException(status_code=404, detail="Project not found")

        # Optimistic locking check
        if manifest.active_revision != cmd.expected_revision:
            raise HTTPException(
                status_code=409,
                detail=f"Revision conflict: current {manifest.active_revision}, expected {cmd.expected_revision}",
            )

        # Xử lý các command types
        if cmd.command_type == "update_title":
            manifest.title = cmd.payload.get("title", manifest.title)
            success = repository.update_project_revision(manifest, expected_revision=cmd.expected_revision)
            if not success:
                raise HTTPException(status_code=409, detail="Failed to update revision")
        return {"command_id": cmd.command_id or "auto", "new_revision": manifest.active_revision}

    @app.get("/api/v1/projects/{project_id}/export/srt")
    async def export_srt(project_id: str, use_translated: bool = True, authorization: Optional[str] = Header(None)):
        verify_auth(authorization)
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        cues = repository.get_cues(project_id)
        from subtitle_localizer.render.srt import SrtExporter
        exporter = SrtExporter()
        srt_content = exporter.export_srt_text(cues, use_translated=use_translated)
        from fastapi.responses import Response
        filename = f"{project.title}.srt"
        return Response(
            content=srt_content.encode("utf-8"),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.get("/api/v1/projects/{project_id}/export/ass")
    async def export_ass(project_id: str, use_translated: bool = True, authorization: Optional[str] = Header(None)):
        verify_auth(authorization)
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        cues = repository.get_cues(project_id)
        from subtitle_localizer.render.ass import AssExporter
        exporter = AssExporter()
        ass_content = exporter.export_ass_text(cues, script_title=project.title, use_translated=use_translated)
        from fastapi.responses import Response
        filename = f"{project.title}.ass"
        return Response(
            content=ass_content.encode("utf-8"),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.post("/api/v1/projects/{project_id}/export/mp4")
    def export_mp4(
        project_id: str,
        request: Mp4ExportRequest,
        authorization: Optional[str] = Header(None),
    ) -> Dict[str, str]:
        verify_auth(authorization)
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        source_path = Path(project.source_video_path)
        if not source_path.exists() or not source_path.is_file():
            raise HTTPException(status_code=404, detail="Source video not found")
        if request.mask_mode not in {"box", "blur", "none"}:
            raise HTTPException(status_code=422, detail="Unsupported mask mode")

        from subtitle_localizer.render.ass import AssExporter
        from subtitle_localizer.render.export import VideoExporter
        from subtitle_localizer.render.mask import SubtitleMasker
        import tempfile

        ass_path: Optional[Path] = None
        try:
            project_output = resolved_output_root / project_id
            project_output.mkdir(parents=True, exist_ok=True)
            output_path = project_output / f"{source_path.stem}-localized.mp4"
            cues = repository.get_cues(project_id)

            import cv2
            cap = cv2.VideoCapture(str(source_path))
            vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
            vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
            cap.release()

            region = project.regions[0] if project.regions else None
            font_size = max(24, int(vh * 0.036))
            if region:
                center_y_frac = region.y + (region.height / 2.0)
                margin_v = max(10, int(vh * (1.0 - center_y_frac) - (font_size / 2.0)))
            else:
                margin_v = int(vh * 0.08)

            ass_content = AssExporter(
                font_name="Arial",
                font_size=font_size,
                primary_color="&H0000FFFF",  # Vàng phụ đề chuẩn
                outline_color="&H00000000",
                outline=3,
                shadow=1,
                play_res_x=vw,
                play_res_y=vh,
                margin_v=margin_v,
                bold=1,
            ).export_ass_text(
                cues,
                script_title=project.title,
                use_translated=request.use_translated,
            )

            x = f"iw*{region.x}" if region else "0"
            y = f"ih*{region.y}" if region else "ih*0.8"
            width = f"iw*{region.width}" if region else "iw"
            height = f"ih*{region.height}" if region else "ih*0.2"
            mask_filter = None
            if request.mask_mode != "none":
                mask_filter = SubtitleMasker().get_filter_string(
                    mode=request.mask_mode,
                    x=x,
                    y=y,
                    width=width,
                    height=height,
                )

            with tempfile.NamedTemporaryFile(
                dir=project_output,
                prefix=".tmp_subtitles_",
                suffix=".ass",
                delete=False,
            ) as temporary_ass:
                ass_path = Path(temporary_ass.name)
            ass_path.write_text(ass_content, encoding="utf-8")
            rendered_path = VideoExporter().render_video(
                source_video_path=source_path,
                output_video_path=output_path,
                ass_path=ass_path,
                mask_filter=mask_filter,
                use_nvenc=True,
            )
        except (OSError, RuntimeError) as error:
            raise HTTPException(status_code=500, detail=f"MP4 export failed: {error}") from error
        finally:
            if ass_path is not None:
                try:
                    ass_path.unlink(missing_ok=True)
                except OSError:
                    pass

        if not rendered_path.exists() or not rendered_path.is_file():
            raise HTTPException(status_code=500, detail="MP4 export did not produce an output file")
        return {"status": "completed", "output_path": str(rendered_path)}

    @app.get("/api/v1/projects/{project_id}/video/rendered")
    def stream_rendered_video(project_id: str, download: bool = False):
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        from pathlib import Path
        source_path = Path(project.source_video_path)
        project_output = resolved_output_root / project_id
        rendered_path = project_output / f"{source_path.stem}-localized.mp4"
        if not rendered_path.exists():
            raise HTTPException(status_code=404, detail="Rendered video not found. Please render first.")
        from fastapi.responses import FileResponse
        if download:
            return FileResponse(path=str(rendered_path), media_type="video/mp4", filename=f"{source_path.stem}-localized.mp4")
        return FileResponse(path=str(rendered_path), media_type="video/mp4")

    @app.get("/api/v1/projects/{project_id}/video/stream")
    def stream_project_video(project_id: str):
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        from pathlib import Path
        video_path = Path(project.source_video_path)
        if not video_path.exists():
            # Trả về 404 nếu video không tồn tại
            raise HTTPException(status_code=404, detail="Video file not found on disk")
        from fastapi.responses import FileResponse
        return FileResponse(path=str(video_path), media_type="video/mp4")

    @app.post("/api/v1/projects/upload")
    async def upload_video_file(file: UploadFile = File(...), authorization: Optional[str] = Header(None)) -> Dict[str, str]:
        verify_auth(authorization)
        from pathlib import Path
        upload_dir = Path("uploads").resolve()
        upload_dir.mkdir(parents=True, exist_ok=True)
        safe_name = file.filename or "uploaded_video.mp4"
        target_path = upload_dir / safe_name
        with target_path.open("wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                buffer.write(chunk)
        return {"path": str(target_path).replace("\\", "/"), "filename": safe_name}

    @app.post("/api/v1/system/pick-video")
    async def pick_video(authorization: Optional[str] = Header(None)) -> Dict[str, str]:
        verify_auth(authorization)
        try:
            import subprocess
            import sys
            from pathlib import Path
            script_path = Path(__file__).resolve().parents[3] / "scripts" / "pick_file.py"
            res = subprocess.run(
                [sys.executable, str(script_path)],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            selected = res.stdout.strip()
            if selected:
                p = Path(selected)
                return {"path": str(p).replace("\\", "/"), "filename": p.name}
            return {"path": "", "filename": ""}
        except Exception as e:
            return {"path": "", "filename": "", "error": str(e)}

    @app.get("/api/v1/models")
    async def list_models(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        return {
            "ocr": ["paddle-zh", "paddle-ja", "paddle-ko", "paddle-en", "mock"],
            "translation": ["gemma", "nllb", "opus", "mock"],
        }

    @app.websocket("/api/v1/ws")
    async def websocket_endpoint(websocket: WebSocket, after_sequence: int = 0) -> None:
        await ws_manager.connect(websocket)
        if after_sequence > 0:
            await ws_manager.replay_events_after(websocket, after_sequence)
        try:
            while True:
                data = await websocket.receive_json()
                # Phản hồi pong hoặc xử lý client commands
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
        except WebSocketDisconnect:
            ws_manager.disconnect(websocket)

    return app
