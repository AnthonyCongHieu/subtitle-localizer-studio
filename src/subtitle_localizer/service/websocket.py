from __future__ import annotations

import asyncio
from typing import Dict, List, Optional
from fastapi import WebSocket

from subtitle_localizer.domain.models import BridgeEventV1
from subtitle_localizer.persistence.repository import ProjectRepository


class WebSocketManager:
    """Quản lý kết nối WebSocket và phát sóng sự kiện có đánh số thứ tự sequence."""

    def __init__(self, repo: ProjectRepository) -> None:
        self.repo = repo
        self.active_connections: List[WebSocket] = []
        self._current_sequence = 0

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast_event(self, project_id: str, event_type: str, payload: dict, job_id: Optional[str] = None) -> BridgeEventV1:
        self._current_sequence += 1
        event = BridgeEventV1(
            event_id=f"evt-{self._current_sequence}",
            sequence=self._current_sequence,
            project_id=project_id,
            job_id=job_id,
            event_type=event_type,
            payload=payload,
        )
        self.repo.save_event(event)

        # Broadcast tới tất cả connected clients
        for conn in list(self.active_connections):
            try:
                await conn.send_json(event.to_dict())
            except Exception:
                self.disconnect(conn)

        return event

    async def replay_events_after(self, websocket: WebSocket, sequence: int) -> None:
        """Gửi lại các event bị lỡ cho client vừa kết nối lại sau sequence."""
        missed = self.repo.get_events_after(sequence=sequence)
        for evt in missed:
            await websocket.send_json(evt.to_dict())
