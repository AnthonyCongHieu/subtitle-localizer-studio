#!/usr/bin/env python3
"""Browser E2E cho giao diện Admin LAN và luồng điều phối worker/job."""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright
except ImportError as error:
    print("[LỖI] Thiếu Playwright Python. Chạy: pip install playwright")
    print("       Sau đó chạy: python -m playwright install chromium")
    raise SystemExit(2) from error

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "screenshots_admin_worker"
REPORT_PATH = OUTPUT_DIR / "e2e_admin_report.md"
BASE_URL = os.getenv("ADMIN_E2E_BASE_URL", "http://127.0.0.1:8899").rstrip("/")
API_BASE = f"{BASE_URL}/api/v1"
TOKEN = os.getenv("ADMIN_E2E_TOKEN", "dev-local-token")
VIEWPORT = {"width": 1440, "height": 900}


class E2EFailure(RuntimeError):
    pass


def api(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{API_BASE}{path}", data=body, method=method,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise E2EFailure(f"API {method} {path} trả về HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise E2EFailure(f"Không thể kết nối {API_BASE}: {error.reason}") from error

def wait_for_job(job_id: str, expected: str, timeout: float = 15.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = next((item for item in api("GET", "/admin/jobs") if item["job_id"] == job_id), None)
        if job and job.get("status") == expected:
            return job
        time.sleep(0.3)
    raise E2EFailure(f"Job {job_id} không chuyển sang {expected} trong {timeout:.0f} giây")


def assert_text(page: Page, text: str, message: str) -> None:
    try:
        page.get_by_text(text, exact=True).first.wait_for(state="visible", timeout=10_000)
    except PlaywrightTimeoutError as error:
        raise E2EFailure(message) from error


def capture(page: Page, filename: str, evidence: list[str]) -> None:
    path = OUTPUT_DIR / filename
    page.screenshot(path=str(path), full_page=True)
    evidence.append(filename)
    print(f"[ẢNH] {path.relative_to(ROOT)}")


def refresh_admin(page: Page) -> None:
    page.reload(wait_until="networkidle", timeout=30_000)
    page.get_by_role("heading", name="Điều phối Worker & Job").wait_for(timeout=15_000)
    page.wait_for_timeout(1000)


def row_for(page: Page, value: str):
    return page.locator("tr", has_text=value).first


def wait_for_job_ui(page: Page, job_id: str, expected_status: str, timeout: float = 20.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        refresh_admin(page)
        # Check in all tr elements or article elements
        match = page.locator(f"tr:has-text('{job_id}')")
        if match.count() > 0:
            text = match.first.inner_text()
            if expected_status in text.lower():
                print(f"[UI] Job {job_id} hiển thị trạng thái '{expected_status}'")
                return
        time.sleep(1.0)
    # Check fallback in entire body
    body_text = page.locator("body").inner_text()
    if job_id in body_text and expected_status in body_text.lower():
        print(f"[UI-FALLBACK] Tìm thấy {job_id} và {expected_status} trên trang")
        return
    raise E2EFailure(f"Không tìm thấy job {job_id} với trạng thái {expected_status} trên UI")


def markdown_report(results: list[tuple[str, bool, str]], evidence: list[str], error: str | None) -> str:
    passed = sum(1 for _, ok, _ in results if ok)
    lines = [
        "# Báo cáo Browser E2E — Admin LAN Worker",
        "",
        f"- Thời điểm: {datetime.now().astimezone().isoformat(timespec='seconds')}",
        f"- URL: `{BASE_URL}/admin.html`",
        f"- Viewport: `{VIEWPORT['width']}x{VIEWPORT['height']}`",
        f"- Kết quả: **{'PASS' if error is None else 'FAIL'}** ({passed}/{len(results)} assertion đạt)",
        "",
        "## Assertions",
        "",
        "| Trạng thái | Kiểm tra | Chi tiết |",
        "|---|---|---|",
    ]
    lines.extend(f"| {'PASS' if ok else 'FAIL'} | {name} | {detail} |" for name, ok, detail in results)
    lines.extend(["", "## Ảnh minh chứng", ""])
    lines.extend(f"- [{name}]({name})" for name in evidence)
    if error:
        lines.extend(["", "## Lỗi", "", f"```text\n{error}\n```"])
    return "\n".join(lines) + "\n"

def run() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results: list[tuple[str, bool, str]] = []
    evidence: list[str] = []
    failure: str | None = None
    worker_id = f"e2e-browser-{int(time.time())}"
    job_id = ""

    def passed(name: str, detail: str) -> None:
        results.append((name, True, detail))
        print(f"[PASS] {name}: {detail}")

    def check(condition: bool, name: str, detail: str) -> None:
        if not condition:
            results.append((name, False, detail))
            raise E2EFailure(f"{name}: {detail}")
        passed(name, detail)

    try:
        health = api("GET", "/health")
        check(health.get("status") == "healthy", "Backend sẵn sàng", str(health))
        api("POST", "/admin/workers/register", {
            "worker_id": worker_id, "hostname": "playwright-e2e", "platform": "windows",
            "app_version": "browser-e2e", "gpu_name": "E2E Virtual GPU", "vram_mb": 8192,
            "vram_free_mb": 7168, "disk_free_bytes": 100_000_000_000, "slots_available": 1,
            "capabilities": {"ocr": True, "download": True, "cuda": True},
        })
        api("POST", f"/admin/downloads/preview", {
            "request_id": f"download-{worker_id}", "worker_id": worker_id,
            "source": "https://example.invalid/e2e-video", "title": "Video kiểm thử Browser E2E",
            "duration_seconds": 42, "size_bytes": 12_345_678,
        })

        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(headless=True)
            except Exception as error:
                raise E2EFailure(
                    "Không thể mở Chromium. Chạy: python -m playwright install chromium"
                ) from error
            page = browser.new_page(viewport=VIEWPORT, locale="vi-VN")
            console_errors: list[str] = []
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
            page.goto(f"{BASE_URL}/admin.html", wait_until="networkidle", timeout=30_000)
            page.get_by_role("heading", name="Điều phối Worker & Job").wait_for(timeout=15_000)
            passed("Mở Admin LAN", "Tiêu đề Điều phối Worker & Job hiển thị")
            capture(page, "01_admin_overview.png", evidence)

            for label in ("Worker đã đăng ký", "Đang sẵn sàng", "Job đang chạy", "Item trong queue"):
                check(page.get_by_text(label, exact=True).is_visible(), f"KPI {label}", "Thẻ KPI hiển thị")
            check(page.get_by_text("Realtime đã kết nối", exact=True).is_visible(), "WebSocket realtime", "Đã kết nối")

            worker_row = row_for(page, worker_id)
            worker_row.wait_for(timeout=10_000)
            check(worker_row.get_by_text("online", exact=True).is_visible(), "Workers panel", f"{worker_id} đang online")
            capture(page, "02_workers_panel_live.png", evidence)

            worker_row.get_by_role("button", name=f"Drain worker {worker_id}").click()
            assert_text(page, "Đã cập nhật trạng thái worker.", "UI không báo cập nhật worker")
            worker_row = row_for(page, worker_id)
            worker_row.get_by_text("draining", exact=True).wait_for(timeout=10_000)
            capture(page, "03_worker_status_toggle.png", evidence)
            worker_row.get_by_role("button", name=f"Cho nhận job worker {worker_id}").click()
            worker_row = row_for(page, worker_id)
            worker_row.get_by_text("online", exact=True).wait_for(timeout=10_000)
            passed("Chuyển trạng thái worker", "online → draining → online phản ánh tức thời")

            stamp = int(time.time() * 1000)
            created = api("POST", "/admin/jobs", {
                "project_id": "e2e-admin-browser", "worker_id": worker_id,
                "idempotency_key": f"admin-browser-e2e-{stamp}", "job_type": "ocr",
                "profile": "e2e", "metrics": {"test": "Playwright Browser E2E"},
            })
            job_id = created["job_id"]
            check(created["status"] == "queued", "Job pending/queued", f"{job_id} đã vào queue")
            wait_for_job_ui(page, job_id, "queued")

            claimed = api("POST", f"/admin/workers/{worker_id}/claim")["job"]
            check(claimed and claimed["status"] == "running", "Worker nhận job", f"{job_id}: queued → running")
            lease_id = claimed["lease_id"]
            wait_for_job_ui(page, job_id, "running")
            capture(page, "04_jobs_panel_active.png", evidence)

            api("PATCH", f"/admin/jobs/{job_id}", {
                "worker_id": worker_id, "lease_id": lease_id, "status": "completed",
                "progress": 1.0, "current_stage": "publish",
                "metrics": {"test": "Playwright Browser E2E", "dispatch_verified": True},
                "result": {"summary": "Worker E2E hoàn thành thành công"},
            })
            completed = wait_for_job(job_id, "completed")
            wait_for_job_ui(page, job_id, "completed")
            check(completed.get("progress") == 1.0, "Job completed", f"{job_id}: running → completed, 100%")
            capture(page, "05_job_completed_success.png", evidence)

            download_row = row_for(page, "Video kiểm thử Browser E2E")
            download_row.wait_for(timeout=10_000)
            check(download_row.get_by_role("button", name="Duyệt tải").is_visible(), "Downloads panel", "Có nút Duyệt tải")
            check(download_row.get_by_role("button", name="Từ chối").is_visible(), "Downloads panel quyết định", "Có nút Từ chối")
            capture(page, "06_downloads_panel.png", evidence)
            check(not console_errors, "Console trình duyệt", "Không có console.error")
            browser.close()
    except Exception as error:
        failure = f"{type(error).__name__}: {error}"
        print(f"[FAIL] {failure}", file=sys.stderr)
        traceback.print_exc()
        if not results or results[-1][1]:
            results.append(("Luồng E2E tổng thể", False, failure))
    finally:
        if worker_id:
            try:
                api("POST", f"/admin/workers/{worker_id}/status?status=disabled")
            except Exception as cleanup_error:
                print(f"[CẢNH BÁO] Không dọn được worker E2E: {cleanup_error}")
        REPORT_PATH.write_text(markdown_report(results, evidence, failure), encoding="utf-8")
        print(f"[BÁO CÁO] {REPORT_PATH.relative_to(ROOT)}")

    print(f"Tổng kết: {sum(ok for _, ok, _ in results)}/{len(results)} assertions PASS")
    print("Ảnh: " + (", ".join(evidence) if evidence else "không có"))
    return 0 if failure is None else 1


if __name__ == "__main__":
    raise SystemExit(run())
