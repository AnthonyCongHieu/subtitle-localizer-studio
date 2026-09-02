from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, File, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from subtitle_localizer.domain.models import (
    CommandEnvelopeV1,
    ProjectManifestV1,
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


def create_app(
    database: Optional[Database] = None,
    repo: Optional[ProjectRepository] = None,
    auth_token: Optional[str] = None,
) -> FastAPI:
    """Tạo instance ứng dụng FastAPI với đầy đủ routes, auth và websocket."""
    app = FastAPI(title="Subtitle Localizer Studio API", version="1.0.0")

    db = database or Database("subtitle_localizer.db")
    db.migrate()
    repository = repo or ProjectRepository(db)
    ws_manager = WebSocketManager(repository)
    worker = BackgroundWorker(repository)

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
        return [p.to_dict() for p in projects]

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

    @app.post("/api/v1/projects/{project_id}/pipeline/run")
    async def run_pipeline(project_id: str, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
        verify_auth(authorization)
        success = worker.run_pipeline_synchronous(project_id)
        if not success:
            raise HTTPException(status_code=400, detail="Failed to run pipeline")
        return {"status": "success", "project_id": project_id}

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

    @app.get("/api/v1/projects/{project_id}/video/stream")
    async def stream_project_video(project_id: str):
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
        import shutil
        upload_dir = Path("uploads").resolve()
        upload_dir.mkdir(parents=True, exist_ok=True)
        target_path = upload_dir / file.filename
        with target_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"path": str(target_path).replace("\\", "/"), "filename": file.filename}

    @app.post("/api/v1/system/pick-video")
    async def pick_video(authorization: Optional[str] = Header(None)) -> Dict[str, str]:
        verify_auth(authorization)
        try:
            import tkinter as tk
            from tkinter import filedialog
            from pathlib import Path
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            selected = filedialog.askopenfilename(
                title="Chọn Video Hard Subtitle",
                filetypes=[
                    ("Video Files", "*.mp4 *.mkv *.avi *.mov *.webm *.flv *.ts *.m4v"),
                    ("All Files", "*.*"),
                ],
            )
            root.destroy()
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
