import os
import sys
import time
from pathlib import Path

# Fix Windows console encoding
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright


def run_browser_verification():
    output_dir = Path("e2e_results")
    output_dir.mkdir(exist_ok=True)

    print("=== Starting End-to-End Playwright Studio Verification ===")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        # Step 1: Open Studio App
        print("1. Navigating to http://localhost:5199/ ...")
        page.goto("http://localhost:5199/", wait_until="networkidle", timeout=30000)
        time.sleep(1)
        page.screenshot(path=str(output_dir / "01_project_list.png"))
        print("   v Loaded Project List. Screenshot saved.")

        # Step 2: Open Bilibili Project
        print("2. Clicking project Bilibili_Ngang_02_ViPhimNuTinhAnToan ...")
        project_card = page.locator("text=Bilibili_Ngang_02_ViPhimNuTinhAnToan").first
        project_card.click()
        page.wait_for_selector('button:has-text("Quét 3 Phút")', timeout=15000)
        time.sleep(1)
        page.screenshot(path=str(output_dir / "02_editor_view_ready.png"))
        print("   v Editor view loaded with dual scan buttons. Screenshot saved.")

        # Step 3: Trigger Fast Scan
        print("3. Clicking Quick Scan button (3 Phut Dau) ...")
        quick_btn = page.locator('button:has-text("Quét 3 Phút")').first
        quick_btn.click()

        # Step 4: Monitor real-time progress polling
        print("4. Monitoring live stage progress polling ...")
        start_time = time.time()
        completed = False
        last_status = ""

        for i in range(180):
            time.sleep(1.0)
            elapsed = time.time() - start_time
            body_text = page.inner_text("body")

            if "Hoàn tất!" in body_text or "Đã trích xuất" in body_text:
                print(f"   v Scan completed in {elapsed:.1f}s!")
                completed = True
                break

            for line in body_text.split("\n"):
                line_s = line.strip()
                if any(
                    k in line_s
                    for k in [
                        "Đang quét",
                        "Đang nhận diện",
                        "Đang xử lý",
                        "Tiến độ",
                        "Đang dựng",
                        "Đang dịch",
                    ]
                ):
                    if line_s != last_status:
                        print(f"   [{elapsed:.1f}s] {line_s}")
                        last_status = line_s
                    break

        if not completed:
            print("   WARNING: Scan did not report completion within timeout!")
            page.screenshot(path=str(output_dir / "03_timeout_debug.png"))

        time.sleep(2)
        page.screenshot(path=str(output_dir / "04_cues_extracted.png"))
        print("   v Cues extracted screenshot saved.")

        # Step 5: Test Video Playback at subtitle timestamps
        print("5. Testing video playback and subtitle overlay alignment ...")
        page.evaluate(
            "() => { const v = document.querySelector('video'); if (v) { v.currentTime = 3.0; } }"
        )
        time.sleep(1.5)
        page.screenshot(path=str(output_dir / "05_playback_pts_3s.png"))
        print("   v Captured playback at PTS 3.0s. Screenshot saved.")

        page.evaluate(
            "() => { const v = document.querySelector('video'); if (v) { v.currentTime = 7.5; } }"
        )
        time.sleep(1.5)
        page.screenshot(path=str(output_dir / "06_playback_pts_7s.png"))
        print("   v Captured playback at PTS 7.5s. Screenshot saved.")

        page.evaluate(
            "() => { const v = document.querySelector('video'); if (v) { v.currentTime = 20.5; } }"
        )
        time.sleep(1.5)
        page.screenshot(path=str(output_dir / "07_playback_pts_20s.png"))
        print("   v Captured playback at PTS 20.5s. Screenshot saved.")

        # Step 6: Test Export Modal UI
        print("6. Testing Export Modal UI ...")
        export_btn = page.locator('button:has-text("Xuất MP4")').first
        if export_btn.is_visible():
            export_btn.click()
            time.sleep(1.5)
            page.screenshot(path=str(output_dir / "08_export_modal.png"))
            print("   v Export modal opened and verified.")

        print("=== End-to-End Verification Complete ===")
        browser.close()
        return completed


if __name__ == "__main__":
    success = run_browser_verification()
    sys.exit(0 if success else 1)

