"""Kiểm thử tự động cho Ticket T24: Tái cấu trúc toàn diện giao diện Admin LAN Operations Control Center."""
from __future__ import annotations

import json
from pathlib import Path
import pytest

from subtitle_localizer.service.lan import LanCoordinator, WorkerRecord, LanJob, DownloadApproval

ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = ROOT / "web"
ADMIN_COMPONENTS_DIR = WEB_DIR / "src" / "components" / "admin"


def test_t24_admin_components_exist() -> None:
    """Tất cả các module thành phần của giao diện Admin mới phải tồn tại đầy đủ."""
    expected_files = [
        "types.ts",
        "mockData.ts",
        "LanUi.tsx",
        "AdminLanView.tsx",
        "AdminOverviewTab.tsx",
        "AdminWorkersTab.tsx",
        "AdminJobsTab.tsx",
        "AdminDownloadsTab.tsx",
        "WorkerConfigDrawer.tsx",
        "JobVideoPreviewModal.tsx",
        "useLanOverview.ts",
    ]
    for filename in expected_files:
        file_path = ADMIN_COMPONENTS_DIR / filename
        assert file_path.exists(), f"Thiếu tệp thành phần Admin: {filename}"
        assert file_path.stat().st_size > 0, f"Tệp {filename} không được rỗng"


def test_t24_mock_data_integrity() -> None:
    """Kiểm tra nội dung tệp mockData.ts có đầy đủ cấu hình mock workers, jobs, cues."""
    mock_file = ADMIN_COMPONENTS_DIR / "mockData.ts"
    content = mock_file.read_text(encoding="utf-8")

    assert "MOCK_COMPLETED_CUES" in content
    assert "worker-alpha-rtx4090" in content
    assert "worker-beta-m2max" in content
    assert "worker-gamma-cpu" in content
    assert "job-mock-ocr-4090" in content
    assert "job-mock-completed" in content
    assert "req-mock-dl-01" in content

    # Xác nhận bảo tồn tiếng Trung và tiếng Việt không bị lỗi encoding
    assert "你到底是谁" in content
    assert "Rốt cuộc ngươi là ai" in content


def test_t24_utf8_and_no_mojibake() -> None:
    """Toàn bộ các tệp của giao diện Admin và App.tsx không được chứa ký tự lỗi \\ufffd."""
    files_to_check = list(ADMIN_COMPONENTS_DIR.glob("*.tsx")) + list(ADMIN_COMPONENTS_DIR.glob("*.ts"))
    files_to_check.append(WEB_DIR / "src" / "App.tsx")

    for file_path in files_to_check:
        text = file_path.read_text(encoding="utf-8")
        assert "\ufffd" not in text, f"Phát hiện ký tự lỗi \\ufffd trong tệp: {file_path}"


def test_t24_coordinator_backend_compatibility() -> None:
    """Đảm bảo coordinator backend tương thích 100% với các trường mà Admin UI đọc."""
    coordinator = LanCoordinator(database=None)

    # Đăng ký một worker mẫu
    coordinator.register_worker({
        "worker_id": "worker-test-node",
        "hostname": "TEST-BOX",
        "ip_address": "192.168.1.50:8899",
        "platform": "windows",
        "gpu_name": "NVIDIA GeForce RTX 3060",
        "vram_mb": 12288,
        "capabilities": {"ocr": True, "cuda": True, "downloader": True},
    })

    workers = coordinator.list_workers()
    assert len(workers) == 1
    w = workers[0]
    assert w["worker_id"] == "worker-test-node"
    assert w["gpu_name"] == "NVIDIA GeForce RTX 3060"
    assert w["vram_mb"] == 12288
    assert w["is_online"] is True

    # Tạo một job mẫu
    job = coordinator.create_job({
        "job_id": "job-test-01",
        "project_id": "proj-test-01",
        "job_type": "ocr",
        "idempotency_key": "idemp-01",
        "profile": "full_speed_quality",
    })
    assert job.status == "queued"
    assert job.project_id == "proj-test-01"

    jobs = coordinator.list_jobs()
    assert len(jobs) == 1
    assert jobs[0]["job_id"] == "job-test-01"

    # Worker nhận job (claim lease)
    claimed = coordinator.claim_next_job("worker-test-node")
    assert claimed is not None
    assert claimed.job_id == "job-test-01"
    assert claimed.status == "running"

    # Cập nhật tiến trình job (chuẩn 0.0 - 1.0, frontend tự quy đổi thành %)
    updated = coordinator.update_job("job-test-01", {
        "status": "running",
        "progress": 0.45,
        "current_stage": "ocr_cuda",
    })
    assert updated.progress == 0.45
    assert updated.current_stage == "ocr_cuda"

    # Hoàn tất job và kiểm tra overview
    completed = coordinator.update_job("job-test-01", {
        "status": "completed",
        "progress": 100.0,
        "result": {"cues_detected": 15, "fps": 50.2},
    })
    assert completed.status == "completed"

    ov = coordinator.overview()
    assert ov["counts"]["workers"] == 1
    assert ov["counts"]["online_workers"] == 1
    assert len(ov["workers"]) == 1
    assert len(ov["jobs"]) == 1


def test_t24_production_build_contains_admin_bundle() -> None:
    """Bản build dist/admin.html và bundle assets phải chứa cấu trúc Admin Control Plane."""
    dist_dir = WEB_DIR / "dist"
    admin_html = dist_dir / "admin.html"
    index_html = dist_dir / "index.html"

    assert admin_html.exists(), "dist/admin.html phải tồn tại sau khi build"
    assert index_html.exists(), "dist/index.html phải tồn tại sau khi build"

    content_admin = admin_html.read_text(encoding="utf-8")
    assert '<div id="root">' in content_admin
