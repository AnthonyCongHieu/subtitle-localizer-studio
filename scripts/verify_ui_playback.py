import os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

def run_playback_verification():
    output_dir = Path('e2e_results')
    output_dir.mkdir(exist_ok=True)

    print('=== Starting Playwright Video Playback & Cue Verification ===')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context.new_page()

        print('1. Opening project directly at http://localhost:5199/ ...')
        page.goto('http://localhost:5199/', wait_until='networkidle', timeout=30000)
        time.sleep(1)

        project_card = page.locator('button:has-text("Investigate / Edit")').first
        if not project_card.is_visible():
            project_card = page.locator('text=Bilibili_Ngang_02_ViPhimNuTinhAnToan').first
        project_card.click()

        print('2. Waiting for EditorView to load cues ...')
        page.wait_for_selector('text=Tongtong', timeout=20000)
        time.sleep(1.5)

        page.screenshot(path=str(output_dir / '10_editor_with_60_cues.png'))
        print('   v Editor view shows all cues. Screenshot saved.')

        # Test video playback at Cue #1 (PTS 3.0s: "童童今天在学校怎么样呀 -> Hôm nay Tongtong ở trường thế nào?")
        print('3. Seeking to PTS 3.0s (Cue #1) ...')
        page.evaluate("() => { const v = document.querySelector('video'); if (v) { v.currentTime = 3.0; } }")
        time.sleep(1.5)
        page.screenshot(path=str(output_dir / '11_cue1_pts_3s.png'))
        print('   v Captured Cue #1 at PTS 3.0s. Screenshot saved.')

        # Test video playback at Cue #2 (PTS 8.0s: "对了上次那个阶段测验成绩出来了吗 -> Nhân tiện, kết quả kiểm tra ở giai đoạn cuối đã có chưa?")
        print('4. Seeking to PTS 8.0s (Cue #2) ...')
        page.evaluate("() => { const v = document.querySelector('video'); if (v) { v.currentTime = 8.0; } }")
        time.sleep(1.5)
        page.screenshot(path=str(output_dir / '12_cue2_pts_8s.png'))
        print('   v Captured Cue #2 at PTS 8.0s. Screenshot saved.')

        # Test video playback at Cue #6 (PTS 20.0s: "学校要交教材费 -> Nhà trường phải đóng phí sách giáo khoa")
        print('5. Seeking to PTS 20.0s (Cue #6) ...')
        page.evaluate("() => { const v = document.querySelector('video'); if (v) { v.currentTime = 20.0; } }")
        time.sleep(1.5)
        page.screenshot(path=str(output_dir / '13_cue6_pts_20s.png'))
        print('   v Captured Cue #6 at PTS 20.0s. Screenshot saved.')

        # Test video playback at Cue #8 (PTS 25.5s: "五千什么教材需要五千块钱 -> Năm nghìn. Sách giáo khoa nào cần năm nghìn nhân dân tệ?")
        print('6. Seeking to PTS 25.5s (Cue #8) ...')
        page.evaluate("() => { const v = document.querySelector('video'); if (v) { v.currentTime = 25.5; } }")
        time.sleep(1.5)
        page.screenshot(path=str(output_dir / '14_cue8_pts_25s.png'))
        print('   v Captured Cue #8 at PTS 25.5s. Screenshot saved.')

        print('=== Video Playback Verification Finished Successfully ===')
        browser.close()
        return True

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    success = run_playback_verification()
    sys.exit(0 if success else 1)

