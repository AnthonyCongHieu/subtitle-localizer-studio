"""Hardware profiling and resilient OCR batch-size tuning.

The tuner is deliberately independent from the pipeline worker.  It exposes a
small, typed API that callers can use to select an OCR batch/concurrency tier
and to retry an inference operation after CUDA out-of-memory failures.

No CUDA/PyTorch import is required to import this module.  Hardware probing is
best-effort and conservative: when free VRAM cannot be measured the profile
falls back to the CPU tier instead of guessing a large batch size.
"""

from __future__ import annotations

import gc
import logging
import os
import platform
import subprocess
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Mapping, Optional, Sequence

logger = logging.getLogger(__name__)


class HardwareTier(str, Enum):
    """Supported elastic hardware tiers."""

    S = "S"
    A = "A"
    B = "B"
    C = "C"


@dataclass(frozen=True)
class HardwareSnapshot:
    """Measured host capabilities used to derive a :class:`HardwareProfile`.

    ``free_vram_mb`` is intentionally required separately from total VRAM.
    OCR runs alongside a video decoder and translation stages, so total VRAM
    alone is not a safe basis for choosing a batch size.
    """

    cpu_threads: int
    free_vram_mb: int = 0
    total_vram_mb: int = 0
    gpu_name: str = ""
    cuda_available: bool = False
    nvdec_available: bool = False
    gpu_index: int = 0

    def __post_init__(self) -> None:
        for field_name in ("cpu_threads", "free_vram_mb", "total_vram_mb", "gpu_index"):
            value = int(getattr(self, field_name))
            if value < 0:
                raise ValueError(f"{field_name} must be non-negative")
        if int(self.total_vram_mb) and int(self.free_vram_mb) > int(self.total_vram_mb):
            raise ValueError("free_vram_mb cannot exceed total_vram_mb")


@dataclass(frozen=True)
class HardwareProfile:
    """Safe OCR runtime plan derived from a hardware snapshot."""

    tier: HardwareTier
    cpu_threads: int
    free_vram_mb: int
    total_vram_mb: int
    gpu_name: str
    cuda_available: bool
    nvdec_available: bool
    optimal_batch_size: int
    max_concurrency: int
    decoder: str
    execution_provider: str
    rationale: str = ""

    @property
    def batch_size(self) -> int:
        """Compatibility alias for callers that use ``batch_size``."""

        return self.optimal_batch_size

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-safe diagnostics payload."""

        result = {
            "tier": self.tier.value,
            "cpu_threads": self.cpu_threads,
            "free_vram_mb": self.free_vram_mb,
            "total_vram_mb": self.total_vram_mb,
            "gpu_name": self.gpu_name,
            "cuda_available": self.cuda_available,
            "nvdec_available": self.nvdec_available,
            "optimal_batch_size": self.optimal_batch_size,
            "max_concurrency": self.max_concurrency,
            "decoder": self.decoder,
            "execution_provider": self.execution_provider,
            "rationale": self.rationale,
        }
        return result


def profile_hardware(snapshot: HardwareSnapshot) -> HardwareProfile:
    """Map measured capabilities to the S/A/B/C elastic matrix.

    Thresholds follow the integration blueprint and use *free* VRAM:

    * S: >= 12 GiB free VRAM and >= 16 CPU threads, batch 64, concurrency 6
    * A: >= 6 GiB free VRAM and >= 8 CPU threads, batch 32, concurrency 3
    * B: >= 2.5 GiB free VRAM, batch 16, concurrency 1
    * C: no usable CUDA/free VRAM, batch 4, CPU PyAV, concurrency 1

    A machine with ample VRAM but too few CPU threads is conservatively capped
    at B; this prevents decoder/I/O contention from starving OCR.
    """

    free = int(snapshot.free_vram_mb)
    threads = max(1, int(snapshot.cpu_threads))
    has_gpu = bool(snapshot.cuda_available and free >= 2560)

    if has_gpu and free >= 12288 and threads >= 16:
        tier, batch, concurrency = HardwareTier.S, 64, 6
        rationale = "free VRAM >= 12 GiB and CPU >= 16 threads"
        decoder = "dual_nvdec" if snapshot.nvdec_available else "single_nvdec"
    elif has_gpu and free >= 6144 and threads >= 8:
        tier, batch, concurrency = HardwareTier.A, 32, 3
        rationale = "free VRAM >= 6 GiB and CPU >= 8 threads"
        decoder = "single_nvdec" if snapshot.nvdec_available else "cpu_pyav"
    elif has_gpu:
        tier, batch, concurrency = HardwareTier.B, 16, 1
        rationale = "free VRAM >= 2.5 GiB"
        decoder = "single_nvdec" if snapshot.nvdec_available else "cpu_pyav"
    else:
        tier, batch, concurrency = HardwareTier.C, 4, 1
        rationale = "no usable CUDA device or less than 2.5 GiB free VRAM"
        decoder = "cpu_pyav"

    provider = "CUDAExecutionProvider" if tier is not HardwareTier.C else "CPUExecutionProvider"
    return HardwareProfile(
        tier=tier,
        cpu_threads=threads,
        free_vram_mb=free,
        total_vram_mb=int(snapshot.total_vram_mb),
        gpu_name=snapshot.gpu_name or (platform.processor() if tier is HardwareTier.C else "Unknown GPU"),
        cuda_available=bool(snapshot.cuda_available and tier is not HardwareTier.C),
        nvdec_available=bool(snapshot.nvdec_available and tier is not HardwareTier.C),
        optimal_batch_size=batch,
        max_concurrency=concurrency,
        decoder=decoder,
        execution_provider=provider,
        rationale=rationale,
    )


def _parse_memory_mb(value: str) -> int:
    """Parse nvidia-smi's numeric memory fields without locale assumptions."""

    token = value.strip().split()[0] if value.strip() else "0"
    try:
        return max(0, int(float(token)))
    except ValueError:
        return 0


def _cuda_provider_available() -> bool:
    try:
        import onnxruntime as ort
    except ImportError:
        return False
    try:
        return "CUDAExecutionProvider" in ort.get_available_providers()
    except (AttributeError, RuntimeError):
        return False


def probe_hardware(
    gpu_index: int = 0,
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> HardwareSnapshot:
    """Probe CPU/GPU resources using ``nvidia-smi`` and ONNX Runtime.

    ``runner`` is injectable for deterministic tests.  Probe failures are
    treated as an unavailable GPU; callers still receive a valid CPU profile.
    """

    index = int(gpu_index)
    if index < 0:
        raise ValueError("gpu_index must be non-negative")
    threads = max(1, int(os.cpu_count() or 1))
    command = [
        "nvidia-smi",
        f"--id={index}",
        "--query-gpu=name,memory.total,memory.free",
        "--format=csv,noheader,nounits",
    ]
    try:
        completed = runner(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=3)
    except (OSError, subprocess.SubprocessError):
        completed = None
    if completed is None or completed.returncode != 0 or not completed.stdout.strip():
        return HardwareSnapshot(cpu_threads=threads, gpu_index=index, cuda_available=False)

    line = completed.stdout.splitlines()[0]
    fields = [part.strip() for part in line.split(",")]
    if len(fields) < 3:
        return HardwareSnapshot(cpu_threads=threads, gpu_index=index, cuda_available=False)
    total = _parse_memory_mb(fields[1])
    free = _parse_memory_mb(fields[2])
    has_nvidia = bool(total)
    # nvidia-smi visibility remains valid profiling evidence even before ORT CUDA
    # wheels are installed; OCR providers still verify the actual execution provider.
    cuda = _cuda_provider_available() or has_nvidia
    return HardwareSnapshot(
        cpu_threads=threads,
        free_vram_mb=free,
        total_vram_mb=total,
        gpu_name=fields[0],
        cuda_available=cuda,
        nvdec_available=has_nvidia,
        gpu_index=index,
    )


OOM_MARKERS = (
    "out of memory",
    "outofmemory",
    "cublas_status_alloc_failed",
    "cudaerrormemoryallocation",
    "resource exhausted",
)


def is_oom_error(error: BaseException) -> bool:
    """Return whether an exception is a recognized CUDA/allocator OOM."""

    if isinstance(error, MemoryError):
        return True
    message = str(error).lower().replace("_", " ")
    return any(marker.replace("_", " ") in message for marker in OOM_MARKERS)


class OomRecoveryError(RuntimeError):
    """Raised when both GPU backoff and CPU fallback cannot complete."""


@dataclass
class ElasticBatchController:
    """Retry an OCR operation with halved batches, then CPU fallback.

    The callback receives ``(batch_size, execution_provider)``.  It is called
    first with the configured GPU provider, then with progressively smaller
    batches after OOM.  Once ``min_batch_size`` is reached, the controller
    retries using ``CPUExecutionProvider``.  Non-OOM exceptions propagate
    unchanged so programming/data errors are not hidden.
    """

    initial_batch_size: int
    min_batch_size: int = 4
    reduction_factor: int = 2
    max_oom_retries: int = 8
    gpu_execution_provider: str = "CUDAExecutionProvider"
    cleanup_callback: Optional[Callable[[], None]] = None
    _current_batch_size: int = field(init=False, repr=False)
    _last_status: dict[str, Any] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self) -> None:
        self.initial_batch_size = int(self.initial_batch_size)
        self.min_batch_size = int(self.min_batch_size)
        self.reduction_factor = int(self.reduction_factor)
        self.max_oom_retries = int(self.max_oom_retries)
        if self.initial_batch_size < 1:
            raise ValueError("initial_batch_size must be positive")
        if self.min_batch_size < 1 or self.min_batch_size > self.initial_batch_size:
            raise ValueError("min_batch_size must be in [1, initial_batch_size]")
        if self.reduction_factor < 2:
            raise ValueError("reduction_factor must be at least 2")
        if self.max_oom_retries < 1:
            raise ValueError("max_oom_retries must be positive")
        self._current_batch_size = self.initial_batch_size

    @property
    def current_batch_size(self) -> int:
        return self._current_batch_size

    @property
    def last_status(self) -> Mapping[str, Any]:
        return dict(self._last_status)

    def reset(self) -> None:
        self._current_batch_size = self.initial_batch_size
        self._last_status = {}

    def _cleanup_after_oom(self) -> None:
        gc.collect()
        if self.cleanup_callback is not None:
            self.cleanup_callback()

    def run(
        self,
        operation: Callable[[int, str], Any],
        *,
        cpu_operation: Optional[Callable[[int, str], Any]] = None,
    ) -> Any:
        """Execute ``operation`` with bounded OOM recovery."""

        batch = self._current_batch_size
        provider = self.gpu_execution_provider
        oom_count = 0
        history: list[dict[str, Any]] = []
        while True:
            try:
                callback = (
                    cpu_operation
                    if provider == "CPUExecutionProvider" and cpu_operation
                    else operation
                )
                result = callback(batch, provider)
                self._current_batch_size = batch
                self._last_status = {
                    "batch_size": batch,
                    "execution_provider": provider,
                    "oom_retries": oom_count,
                    "cpu_fallback": provider == "CPUExecutionProvider",
                    "history": history,
                }
                return result
            except Exception as error:
                if not is_oom_error(error):
                    raise
                oom_count += 1
                history.append({"batch_size": batch, "execution_provider": provider, "error": str(error)})
                self._cleanup_after_oom()
                if provider == "CPUExecutionProvider":
                    raise OomRecoveryError("OCR inference exhausted CPU memory after CUDA backoff") from error
                next_batch = max(self.min_batch_size, batch // self.reduction_factor)
                if next_batch < batch and oom_count <= self.max_oom_retries:
                    batch = next_batch
                    continue
                provider = "CPUExecutionProvider"
                batch = self.min_batch_size


class HardwareAutoTuner:
    """Convenience facade combining probing, profiling, and OOM control."""

    def __init__(self, snapshot: Optional[HardwareSnapshot] = None) -> None:
        self._snapshot = snapshot
        self._profile: Optional[HardwareProfile] = None

    def snapshot(self, *, refresh: bool = False) -> HardwareSnapshot:
        if self._snapshot is None or refresh:
            self._snapshot = probe_hardware()
        return self._snapshot

    def profile(self, *, refresh: bool = False) -> HardwareProfile:
        if self._profile is None or refresh:
            self._profile = profile_hardware(self.snapshot(refresh=refresh))
        return self._profile

    def new_batch_controller(self, *, batch_size: Optional[int] = None) -> ElasticBatchController:
        profile = self.profile()
        return ElasticBatchController(batch_size or profile.optimal_batch_size, min_batch_size=4)


__all__ = [
    "ElasticBatchController",
    "HardwareAutoTuner",
    "HardwareProfile",
    "HardwareSnapshot",
    "HardwareTier",
    "OOM_MARKERS",
    "OomRecoveryError",
    "is_oom_error",
    "probe_hardware",
    "profile_hardware",
]
