from subtitle_localizer.service.lan import LanCoordinator


def _job(coordinator, key, **payload):
    return coordinator.create_job({"project_id": "project-1", "idempotency_key": key, **payload})


def test_scheduler_skips_workers_without_slots_or_vram():
    coordinator = LanCoordinator()
    coordinator.register_worker({
        "worker_id": "busy", "capabilities": {"cuda": True},
        "vram_free_mb": 8000, "disk_free_bytes": 100 * 1024**3,
        "slots_available": 0,
    })
    coordinator.register_worker({
        "worker_id": "low-vram", "capabilities": {"cuda": True},
        "vram_free_mb": 1000, "disk_free_bytes": 100 * 1024**3,
        "slots_available": 1,
    })
    coordinator.register_worker({
        "worker_id": "ready", "capabilities": {"cuda": True},
        "vram_free_mb": 4000, "disk_free_bytes": 100 * 1024**3,
        "slots_available": 1,
    })

    job = _job(coordinator, "resource-aware", job_type="ocr", stage_plan=["ocr"])

    assert job.worker_id == "ready"


def test_scheduler_prefers_cuda_for_ocr_and_cpu_for_translation():
    coordinator = LanCoordinator()
    coordinator.register_worker({"worker_id": "cpu", "capabilities": {"cuda": False}})
    coordinator.register_worker({
        "worker_id": "cuda", "capabilities": {"cuda": True}, "vram_free_mb": 4000,
    })

    ocr_job = _job(coordinator, "ocr", job_type="ocr", stage_plan=["ocr"])
    translation_job = _job(coordinator, "translate", job_type="translation", stage_plan=["translate"])

    assert ocr_job.worker_id == "cuda"
    assert translation_job.worker_id == "cpu"


def test_single_stage_rerun_preserves_artifacts_and_updates_stage_plan():
    coordinator = LanCoordinator()
    coordinator.register_worker({"worker_id": "worker", "capabilities": {"cuda": True}, "vram_free_mb": 4000})
    job = _job(
        coordinator, "rerun", worker_id="worker", job_type="ocr", stage_plan=["ocr"],
    )
    coordinator.update_job(job.job_id, {
        "status": "completed", "artifacts": [{"name": "existing-dub.mp3", "kind": "audio"}],
    })

    rerun = coordinator.retry_job(job.job_id, stage_plan=["translate"])
    assert rerun.stage_plan == ["translate"]
    assert rerun.status == "queued"

    completed = coordinator.update_job(rerun.job_id, {"status": "completed", "result": {"ok": True}})

    assert completed.status == "completed"
    assert completed.artifacts == [{"name": "existing-dub.mp3", "kind": "audio"}]
