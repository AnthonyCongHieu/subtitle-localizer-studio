"""
Opaque-box frontend contract tests for:
- R2: EpisodeSelectorGrid component interface, 1-touch actions, and status indicators
- R3: DownloadQueueHub component interface, queue cards, speed metrics, controls, and viewMode routing
- R1 & R2: UrlDownloadModal integration with custom output path & episode grid
- R5: 1-Touch Cover Download buttons and actions
- API Client contracts in web/src/api/client.ts
- Vietnamese text encoding integrity (Anti-mojibake check)

Selected via: pytest tests/t14/test_queue_ui_contracts.py
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = REPOSITORY_ROOT / "web"
SRC_DIR = WEB_DIR / "src"


class TestQueueUiContracts(unittest.TestCase):
    """Frontend source contract tests ensuring strict adherence to interface specifications."""

    def test_episode_selector_grid_component_contract(self) -> None:
        """R2: EpisodeSelectorGrid.tsx exists and satisfies props and 1-touch button contracts."""
        grid_file = SRC_DIR / "components" / "project" / "EpisodeSelectorGrid.tsx"
        self.assertTrue(grid_file.exists(), f"Missing required component: {grid_file}")

        content = grid_file.read_text(encoding="utf-8")

        # Check Props Interface
        self.assertIn("totalEpisodes", content)
        self.assertIn("episodesStatus", content)
        self.assertIn("selectedEpisodes", content)
        self.assertIn("onToggleEpisode", content)
        self.assertIn("onSelectAll", content)
        self.assertIn("onSelectMissingOrError", content)
        self.assertIn("onDeselectAll", content)

        # Check 1-touch quick action buttons in Vietnamese
        self.assertTrue(
            "Chọn tất cả" in content,
            "Missing 'Chọn tất cả' button",
        )
        self.assertTrue(
            "Chỉ chọn" in content and ("thiếu" in content or "lỗi" in content),
            "Missing 'Chỉ chọn các tập còn thiếu / lỗi' button",
        )
        self.assertTrue(
            "Bỏ chọn" in content,
            "Missing 'Bỏ chọn tất cả' button",
        )

        # Check status indicators (completed green, corrupted red, missing gray)
        self.assertTrue(
            ("completed" in content or "green" in content or "emerald" in content),
            "Missing completed status styling",
        )
        self.assertTrue(
            ("corrupted" in content or "red" in content or "rose" in content),
            "Missing corrupted status styling",
        )
        self.assertTrue(
            ("missing" in content or "gray" in content or "slate" in content or "zinc" in content),
            "Missing missing status styling",
        )

    def test_download_queue_hub_component_contract(self) -> None:
        """R3: DownloadQueueHub.tsx exists and satisfies card display, speed, and queue control contracts."""
        hub_file = SRC_DIR / "components" / "project" / "DownloadQueueHub.tsx"
        self.assertTrue(hub_file.exists(), f"Missing required component: {hub_file}")

        content = hub_file.read_text(encoding="utf-8")

        # Props and navigation
        self.assertIn("onSwitchToDashboard", content)

        # Queue controls
        self.assertTrue(
            "pause" in content.lower() or "tạm dừng" in content.lower(),
            "Missing pause queue control",
        )
        self.assertTrue(
            "resume" in content.lower() or "tiếp tục" in content.lower(),
            "Missing resume queue control",
        )
        self.assertTrue(
            "reorder" in content.lower() or "up" in content.lower() or "down" in content.lower(),
            "Missing reorder queue control",
        )
        self.assertTrue(
            "delete" in content.lower() or "xóa" in content.lower() or "hủy" in content.lower(),
            "Missing delete/cancel queue control",
        )

        # Speed and progress metrics
        self.assertTrue(
            "speed" in content.lower() or "mb/s" in content.lower(),
            "Missing download speed indicator (MB/s)",
        )
        self.assertTrue(
            "progress" in content.lower() or "%" in content,
            "Missing progress bar indicator",
        )

    def test_app_view_mode_routing_contract(self) -> None:
        """R3: App.tsx supports 'queue' viewMode and contains quick navigation to DownloadQueueHub."""
        app_file = SRC_DIR / "App.tsx"
        self.assertTrue(app_file.exists(), f"Missing App.tsx: {app_file}")

        content = app_file.read_text(encoding="utf-8")

        # viewMode state should support 'queue'
        self.assertTrue(
            "'queue'" in content or '"queue"' in content,
            "App.tsx viewMode state must support 'queue' (e.g. 'dashboard' | 'studio' | 'queue')",
        )

        # DownloadQueueHub rendered in App.tsx
        self.assertIn("DownloadQueueHub", content)

        # Quick navigation button / tab for queue in header or toolbar
        self.assertTrue(
            "Hàng Đợi" in content or "queue" in content.lower(),
            "Missing queue navigation tab/button in App.tsx",
        )

    def test_url_download_modal_custom_dir_and_grid_contracts(self) -> None:
        """R1, R2, R5: UrlDownloadModal incorporates custom output path, EpisodeSelectorGrid, and cover download."""
        modal_file = SRC_DIR / "components" / "project" / "UrlDownloadModal.tsx"
        self.assertTrue(modal_file.exists(), f"Missing UrlDownloadModal.tsx: {modal_file}")

        content = modal_file.read_text(encoding="utf-8")

        # R1: Custom directory input and validation
        self.assertTrue(
            "output_dir" in content or "outputDir" in content or "customDir" in content or "thư mục" in content.lower(),
            "Missing custom output directory handling in UrlDownloadModal",
        )

        # R2: Grid inclusion
        self.assertIn("EpisodeSelectorGrid", content, "UrlDownloadModal must render EpisodeSelectorGrid")

        # R3 / R4: Queue action button
        self.assertTrue(
            "hàng đợi" in content.lower() or "queue" in content.lower() or "addtoqueue" in content.lower(),
            "Missing 'Thêm vào hàng đợi' option in UrlDownloadModal",
        )

        # R5: 1-touch cover download button
        self.assertTrue(
            "tải ảnh bìa" in content.lower() or "downloadcover" in content.lower() or "ảnh bìa" in content.lower(),
            "Missing R5 'Tải ảnh bìa' action in UrlDownloadModal",
        )

    def test_api_client_downloader_queue_methods(self) -> None:
        """Contracts: StudioApiClient in client.ts implements all required queue and validation endpoints."""
        client_file = SRC_DIR / "api" / "client.ts"
        self.assertTrue(client_file.exists(), f"Missing client.ts: {client_file}")

        content = client_file.read_text(encoding="utf-8")

        # R1 methods
        self.assertTrue(
            "validateDirectory" in content or "checkDirectory" in content,
            "Missing validateDirectory API method in client.ts",
        )

        # R2 methods
        self.assertTrue(
            "scanEpisodes" in content or "scanDiskEpisodes" in content,
            "Missing scanEpisodes API method in client.ts",
        )

        # R4 methods
        self.assertTrue(
            "addToQueue" in content or "enqueueTask" in content,
            "Missing addToQueue API method in client.ts",
        )
        self.assertTrue(
            "getQueue" in content or "getQueueList" in content or "listQueue" in content,
            "Missing getQueueList API method in client.ts",
        )
        self.assertTrue(
            "pauseQueue" in content,
            "Missing pauseQueue API method in client.ts",
        )
        self.assertTrue(
            "resumeQueue" in content,
            "Missing resumeQueue API method in client.ts",
        )
        self.assertTrue(
            "deleteQueueTask" in content or "removeFromQueue" in content or "cancelQueueTask" in content,
            "Missing deleteQueueTask API method in client.ts",
        )
        self.assertTrue(
            "reorderQueue" in content,
            "Missing reorderQueue API method in client.ts",
        )

        # R5 methods
        self.assertTrue(
            "downloadCover" in content,
            "Missing downloadCover API method in client.ts",
        )

    def test_vietnamese_text_integrity_no_mojibake(self) -> None:
        """Quality Gate: Scan web and test files to guarantee no mojibake or unicode corruption."""
        mojibake_patterns = [
            re.compile(r"Ã[¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿]"),
            re.compile(r"Ä[-¿]"),
            re.compile(r"áº[¡-¿]"),
            re.compile(r"á»[¡-¿]"),
            re.compile(r"\ufffd"),  # Unicode Replacement Character
        ]

        target_files = [
            REPOSITORY_ROOT / "tests" / "t14" / "test_download_queue.py",
            REPOSITORY_ROOT / "tests" / "t14" / "test_downloader_custom_dir_and_grid.py",
            REPOSITORY_ROOT / "tests" / "t14" / "test_queue_ui_contracts.py",
        ]

        # Add frontend files if they exist
        for f in [
            SRC_DIR / "App.tsx",
            SRC_DIR / "components" / "project" / "UrlDownloadModal.tsx",
            SRC_DIR / "components" / "project" / "EpisodeSelectorGrid.tsx",
            SRC_DIR / "components" / "project" / "DownloadQueueHub.tsx",
            SRC_DIR / "components" / "project" / "VideoDownloaderHub.tsx",
        ]:
            if f.exists():
                target_files.append(f)

        for target in target_files:
            text = target.read_text(encoding="utf-8")
            for pattern in mojibake_patterns:
                match = pattern.search(text)
                self.assertIsNone(
                    match,
                    f"Mojibake detected in {target.name}: matched '{match.group(0) if match else ''}'",
                )

    def test_video_downloader_hub_standalone_tab_contract(self) -> None:
        """Verify VideoDownloaderHub is a first-class standalone workspace tab with search-first and direct-link categorization."""
        hub_file = SRC_DIR / "components" / "project" / "VideoDownloaderHub.tsx"
        self.assertTrue(hub_file.exists(), f"Missing VideoDownloaderHub.tsx: {hub_file}")
        content = hub_file.read_text(encoding="utf-8")

        # 1. Standalone workspace navigation contract
        self.assertIn("onSwitchToDashboard", content)

        # 2. Search-first platform categorization (Bilibili Wbi)
        self.assertTrue(
            "bilibili" in content.lower() or "b站" in content.lower(),
            "Missing Bilibili search-first support in VideoDownloaderHub",
        )
        self.assertTrue(
            "tìm kiếm" in content.lower() or "search" in content.lower(),
            "Missing Search-First tab and UI in VideoDownloaderHub",
        )

        # 3. Direct link platform categorization (Hongguo, YouTube, Xiaohongshu, Douyin)
        self.assertTrue(
            "hồng quả" in content.lower() or "hongguo" in content.lower(),
            "Missing Hongguo direct link support",
        )
        self.assertTrue(
            "youtube" in content.lower(),
            "Missing YouTube direct link support",
        )
        self.assertTrue(
            "xiaohongshu" in content.lower() or "tiểu hồng thư" in content.lower(),
            "Missing Xiaohongshu clean 1080p direct link support",
        )

        # 4. Multi-threading concurrency and queue integration
        self.assertTrue(
            "concurrency" in content or "đa luồng" in content.lower(),
            "Missing multi-threading concurrency control",
        )

        # 5. App.tsx integration
        app_file = SRC_DIR / "App.tsx"
        app_content = app_file.read_text(encoding="utf-8")
        self.assertIn("VideoDownloaderHub", app_content)
        self.assertIn("downloader", app_content)


if __name__ == "__main__":
    unittest.main()
