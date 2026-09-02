from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Union


class AtomicArtifactStore:
    """Quản lý lưu trữ file an toàn (atomic write) nhằm tránh corrupted file khi app bị crash giữa chừng."""

    def __init__(self, root_dir: Path | str) -> None:
        self.root_dir = Path(root_dir).resolve()
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_safe(self, relative_path: str | Path) -> Path:
        """Đảm bảo đường dẫn tuyệt đối nằm hoàn toàn bên trong root_dir (chống Path Traversal)."""
        target = (self.root_dir / relative_path).resolve()
        try:
            target.relative_to(self.root_dir)
        except ValueError:
            raise ValueError(f"Path traversal detected: {relative_path}")
        return target

    def write_atomic(self, relative_path: str | Path, data: Union[bytes, str]) -> Path:
        """
        Ghi dữ liệu vào file tạm cùng thư mục cha rồi đổi tên (atomic replace).
        Đảm bảo file không bao giờ bị dở dang (partial write).
        """
        target = self._resolve_safe(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)

        # Tạo file tạm trong cùng thư mục để atomic os.replace hoạt động trên cùng filesystem/partition
        prefix = f".tmp_{target.stem}_"
        with tempfile.NamedTemporaryFile(
            dir=str(target.parent), prefix=prefix, delete=False
        ) as tmp_file:
            tmp_path = Path(tmp_file.name)
            if isinstance(data, str):
                tmp_file.write(data.encode("utf-8"))
            else:
                tmp_file.write(data)
            tmp_file.flush()
            os.fsync(tmp_file.fileno())

        try:
            os.replace(tmp_path, target)
        except Exception:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            raise

        return target

    def read(self, relative_path: str | Path) -> bytes:
        target = self._resolve_safe(relative_path)
        if not target.exists():
            raise FileNotFoundError(f"Artifact not found: {relative_path}")
        return target.read_bytes()

    def read_text(self, relative_path: str | Path, encoding: str = "utf-8") -> str:
        target = self._resolve_safe(relative_path)
        if not target.exists():
            raise FileNotFoundError(f"Artifact not found: {relative_path}")
        return target.read_text(encoding=encoding)

    def exists(self, relative_path: str | Path) -> bool:
        target = self._resolve_safe(relative_path)
        return target.exists()

    def delete(self, relative_path: str | Path) -> bool:
        target = self._resolve_safe(relative_path)
        if target.exists():
            target.unlink()
            return True
        return False
