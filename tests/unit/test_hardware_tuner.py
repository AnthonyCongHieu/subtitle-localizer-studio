from __future__ import annotations

from subprocess import CompletedProcess

import pytest

from subtitle_localizer.service.hardware_tuner import (
    ElasticBatchController,
    HardwareAutoTuner,
    HardwareSnapshot,
    HardwareTier,
    OomRecoveryError,
    is_oom_error,
    probe_hardware,
    profile_hardware,
)


@pytest.mark.parametrize(
    ("snapshot", "tier", "batch", "concurrency", "decoder"),
    [
        (HardwareSnapshot(cpu_threads=28, free_vram_mb=14_000, total_vram_mb=16_000, gpu_name="RTX 5080", cuda_available=True, nvdec_available=True), HardwareTier.S, 64, 6, "dual_nvdec"),
        (HardwareSnapshot(cpu_threads=12, free_vram_mb=8_000, total_vram_mb=12_000, gpu_name="RTX 3070", cuda_available=True, nvdec_available=True), HardwareTier.A, 32, 3, "single_nvdec"),
        (HardwareSnapshot(cpu_threads=8, free_vram_mb=3_000, total_vram_mb=4_000, gpu_name="RTX 3050", cuda_available=True, nvdec_available=True), HardwareTier.B, 16, 1, "single_nvdec"),
        (HardwareSnapshot(cpu_threads=16, free_vram_mb=2_400, total_vram_mb=8_000, gpu_name="", cuda_available=True), HardwareTier.C, 4, 1, "cpu_pyav"),
        (HardwareSnapshot(cpu_threads=4), HardwareTier.C, 4, 1, "cpu_pyav"),
    ],
)
def test_profile_hardware_uses_free_vram_and_cpu_matrix(snapshot, tier, batch, concurrency, decoder):
    profile = profile_hardware(snapshot)
    assert profile.tier is tier
    assert profile.optimal_batch_size == batch
    assert profile.max_concurrency == concurrency
    assert profile.decoder == decoder
    assert profile.to_dict()["tier"] == tier.value


def test_profile_caps_high_vram_machine_with_low_cpu_threads():
    profile = profile_hardware(
        HardwareSnapshot(cpu_threads=4, free_vram_mb=16_000, total_vram_mb=16_000, cuda_available=True)
    )
    assert profile.tier is HardwareTier.B
    assert profile.optimal_batch_size == 16


def test_probe_hardware_parses_nvidia_smi_without_requiring_cuda(monkeypatch):
    monkeypatch.setattr("subtitle_localizer.service.hardware_tuner.os.cpu_count", lambda: 20)
    monkeypatch.setattr("subtitle_localizer.service.hardware_tuner._cuda_provider_available", lambda: False)

    def fake_runner(*_args, **_kwargs):
        return CompletedProcess(_args[0], 0, stdout="RTX 3050, 4096, 3072\n", stderr="")

    snapshot = probe_hardware(runner=fake_runner)
    assert snapshot.cpu_threads == 20
    assert snapshot.gpu_name == "RTX 3050"
    assert snapshot.free_vram_mb == 3072
    assert snapshot.total_vram_mb == 4096
    assert snapshot.cuda_available is True  # nvidia-smi itself is valid evidence


def test_probe_failure_is_safe_cpu_profile():
    def missing_runner(*_args, **_kwargs):
        raise FileNotFoundError("nvidia-smi")

    snapshot = probe_hardware(runner=missing_runner)
    assert profile_hardware(snapshot).tier is HardwareTier.C


def test_oom_backoff_halves_batch_then_falls_back_to_cpu():
    calls = []
    cleanup_calls = []

    def operation(batch, provider):
        calls.append((batch, provider))
        if provider == "CUDAExecutionProvider":
            raise RuntimeError("CUDA out of memory")
        return "completed"

    controller = ElasticBatchController(64, min_batch_size=4, cleanup_callback=lambda: cleanup_calls.append(True))
    assert controller.run(operation) == "completed"
    assert calls == [
        (64, "CUDAExecutionProvider"),
        (32, "CUDAExecutionProvider"),
        (16, "CUDAExecutionProvider"),
        (8, "CUDAExecutionProvider"),
        (4, "CUDAExecutionProvider"),
        (4, "CPUExecutionProvider"),
    ]
    assert len(cleanup_calls) == 5
    assert controller.last_status["cpu_fallback"] is True
    assert controller.current_batch_size == 4


def test_non_oom_errors_are_not_hidden():
    controller = ElasticBatchController(16)

    def operation(_batch, _provider):
        raise ValueError("bad crop")

    with pytest.raises(ValueError, match="bad crop"):
        controller.run(operation)


def test_cpu_oom_raises_explicit_recovery_error():
    controller = ElasticBatchController(8, min_batch_size=4)

    def operation(_batch, _provider):
        raise MemoryError("allocator exhausted")

    with pytest.raises(OomRecoveryError, match="exhausted CPU memory"):
        controller.run(operation)


def test_oom_classifier_is_narrow():
    assert is_oom_error(MemoryError("allocator"))
    assert is_oom_error(RuntimeError("CUBLAS_STATUS_ALLOC_FAILED"))
    assert is_oom_error(RuntimeError("CUDA out of memory"))
    assert not is_oom_error(RuntimeError("network timeout"))


def test_auto_tuner_can_use_injected_snapshot_without_probe():
    tuner = HardwareAutoTuner(HardwareSnapshot(cpu_threads=16, free_vram_mb=7000, cuda_available=True))
    assert tuner.profile().tier is HardwareTier.A
    assert tuner.new_batch_controller().current_batch_size == 32
