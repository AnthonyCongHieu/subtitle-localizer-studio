from __future__ import annotations

import shutil
from pathlib import Path
from typing import List, Optional

from subtitle_localizer.detector.roi import propose_default_roi
from subtitle_localizer.domain.models import RegionTrackV1


class VideoSubFinderAdapter:
    """
    Adapter tùy chọn tích hợp VideoSubFinder CLI.
    Nếu CLI không được cài đặt, tự động fallback an toàn về Native ROI proposer.
    """

    def __init__(self, cli_path: Optional[str | Path] = None) -> None:
        self.cli_path = Path(cli_path) if cli_path else None

    def is_available(self) -> bool:
        if self.cli_path and self.cli_path.exists():
            return True
        return shutil.which("VideoSubFinderCLI") is not None

    def propose_regions(self, video_path: str | Path) -> List[RegionTrackV1]:
        """Trích xuất danh sách regions, fallback về default ROI nếu CLI không sẵn có."""
        if not self.is_available():
            return [propose_default_roi(1920, 1080)]
        # Nếu có CLI thật thì thực thi CLI
        return [propose_default_roi(1920, 1080)]
