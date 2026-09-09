"""PyAV decoder with an optional NVDEC attempt and deterministic CPU fallback."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterator, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


class NvdecVideoDecoder:
    def __init__(self, video_path: str | Path, gpu_id: int = 0) -> None:
        self.video_path = Path(video_path)
        self.gpu_id = int(gpu_id)
        self.container = None
        self.hw_stream = None
        self.is_hw = False

    def open(self) -> bool:
        if not self.video_path.is_file():
            logger.warning("Video file does not exist: %s", self.video_path)
            return False
        try:
            import av
        except ImportError:
            logger.info("PyAV is not installed; NVDEC decoder unavailable")
            return False

        try:
            from av.codec.hwaccel import HWAccel
        except ImportError:
            HWAccel = None  # type: ignore[assignment]

        attempts = []
        if HWAccel is not None:
            attempts.append(("cuda", True))
        attempts.append((None, False))
        for device_type, hardware in attempts:
            try:
                if device_type is not None:
                    container = av.open(
                        str(self.video_path),
                        hwaccel=HWAccel(
                            device_type,
                            device=str(self.gpu_id),
                            allow_software_fallback=False,
                        ),
                    )
                else:
                    container = av.open(str(self.video_path))
                stream = container.streams.video[0]
                stream.thread_type = "AUTO"
                # Do not advertise NVDEC when FFmpeg accepted the request but
                # selected a software codec.
                codec_context = getattr(stream, "codec_context", None)
                hardware = bool(hardware and getattr(codec_context, "is_hwaccel", False))
                self.container = container
                self.hw_stream = stream
                self.is_hw = hardware
                logger.info("Video decoder initialized (%s)", "NVDEC" if hardware else "CPU")
                return True
            except Exception as exc:
                logger.debug("Decoder attempt failed (%s): %s", device_type, exc)
                try:
                    container.close()  # type: ignore[union-attr]
                except Exception:
                    pass
        return False

    def decode_frames_roi(
        self,
        roi_norm: Optional[Tuple[float, float, float, float]] = None,
        sample_step: int = 1,
        max_duration_seconds: Optional[float] = None,
    ) -> Iterator[Tuple[np.ndarray, float]]:
        if self.container is None or self.hw_stream is None:
            return
        if sample_step < 1:
            raise ValueError("sample_step must be at least 1")
        if roi_norm is not None and (
            len(roi_norm) != 4 or any(not np.isfinite(float(value)) for value in roi_norm)
        ):
            raise ValueError("roi_norm must contain four finite values")
        if roi_norm is not None:
            rx, ry, rw, rh = (float(value) for value in roi_norm)
            if rw <= 0 or rh <= 0 or rx < 0 or ry < 0 or rx >= 1 or ry >= 1:
                raise ValueError("roi_norm must describe a positive region inside the frame")
        fps = float(self.hw_stream.average_rate or 25.0)
        time_base = float(self.hw_stream.time_base)
        for frame_index, frame in enumerate(self.container.decode(video=0)):
            if frame_index % sample_step:
                continue
            pts = float(frame.pts * time_base) if frame.pts is not None else frame_index / fps
            if max_duration_seconds is not None and pts > max_duration_seconds:
                break
            bgr = frame.to_ndarray(format="bgr24")
            if roi_norm is not None:
                height, width = bgr.shape[:2]
                rx, ry, rw, rh = (float(value) for value in roi_norm)
                x1 = max(0, min(width - 1, int(rx * width)))
                y1 = max(0, min(height - 1, int(ry * height)))
                x2 = max(x1 + 1, min(width, int((rx + rw) * width)))
                y2 = max(y1 + 1, min(height, int((ry + rh) * height)))
                bgr = bgr[y1:y2, x1:x2]
            yield np.ascontiguousarray(bgr), pts

    def close(self) -> None:
        if self.container is not None:
            try:
                self.container.close()
            finally:
                self.container = None
                self.hw_stream = None
                self.is_hw = False

    def __enter__(self) -> "NvdecVideoDecoder":
        if not self.open():
            raise RuntimeError(f"Unable to open video: {self.video_path}")
        return self

    def __exit__(self, _exc_type, _exc_value, _traceback) -> None:
        self.close()
