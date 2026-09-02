from __future__ import annotations

import hashlib
from pathlib import Path


def compute_video_fingerprint(video_path: Path | str) -> str:
    """
    Tính video fingerprint xác định (deterministic) dựa trên kích thước file,
    1MB đầu và 1MB cuối mà không cần đọc toàn bộ file video nhiều GB.
    """
    path = Path(video_path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"File not found for fingerprinting: {path}")

    stat = path.stat()
    file_size = stat.st_size
    hasher = hashlib.sha256()
    hasher.update(str(file_size).encode("ascii"))

    chunk_size = 1024 * 1024  # 1MB sample
    with path.open("rb") as f:
        # Đọc chunk đầu
        first_chunk = f.read(chunk_size)
        hasher.update(first_chunk)

        # Nếu file lớn hơn 2MB, đọc thêm chunk cuối
        if file_size > 2 * chunk_size:
            f.seek(file_size - chunk_size)
            last_chunk = f.read(chunk_size)
            hasher.update(last_chunk)

    return hasher.hexdigest()
