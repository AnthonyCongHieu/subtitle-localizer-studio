# -*- coding: utf-8 -*-
"""
Test Suite T18: Đồng bộ editor nguyên tử và trạng thái thao tác trung thực.
Kiểm thử xử lý Race Condition khi lưu settings & regions song song,
hợp đồng endpoint editor-state, và chặn các thao tác Dịch/TTS khi dự án có 0 câu phụ đề.
"""

from __future__ import annotations

import concurrent.futures
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from subtitle_localizer.domain.models import ProjectManifestV1, RegionTrackV1
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.server import create_app


class AtomicEditorSyncTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.temp_dir.name) / "t18_atomic.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.output_root = Path(self.temp_dir.name) / "outputs"
        self.token = "t18-secret-token"
        self.app = create_app(
            database=self.db,
            repo=self.repo,
            auth_token=self.token,
            output_root=self.output_root,
        )
        self.client = TestClient(self.app)
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def tearDown(self) -> None:
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_concurrent_regions_and_settings_update_preserves_both(self) -> None:
        """
        Xác minh xử lý Race Condition:
        Khi 2 request PUT /regions và PUT /settings được gửi song song,
        cả regions và custom_pipeline_settings đều phải được lưu đầy đủ vào SQLite,
        không bên nào bị ghi đè mất dữ liệu.
        """
        proj = ProjectManifestV1(
            project_id="proj-race-test",
            title="Kiểm Thử Race Condition",
            source_video_path="C:/videos/test.mp4",
            video_fingerprint="fp-race",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(proj)

        regions_payload = [
            {
                "region_id": "roi-box-1",
                "x": 0.1,
                "y": 0.8,
                "width": 0.8,
                "height": 0.15,
                "label": "Subtitle Bottom ROI",
                "mask_style": "blur",
                "blur_strength": 30,
            }
        ]
        settings_payload = {
            "aspect_ratio": "16:9",
            "fit_mode": "contain",
            "dubbing": {
                "mode": "single",
                "voice": "vi-VN-HoaiMyNeural",
            },
        }

        def send_regions():
            return self.client.put(
                "/api/v1/projects/proj-race-test/regions",
                headers=self.headers,
                json=regions_payload,
            )

        def send_settings():
            return self.client.put(
                "/api/v1/projects/proj-race-test/settings",
                headers=self.headers,
                json=settings_payload,
            )

        # Chạy song song 2 request đồng thời qua ThreadPoolExecutor
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            f1 = executor.submit(send_regions)
            f2 = executor.submit(send_settings)
            res1 = f1.result()
            res2 = f2.result()

        self.assertEqual(res1.status_code, 200, f"Lỗi PUT /regions: {res1.text}")
        self.assertEqual(res2.status_code, 200, f"Lỗi PUT /settings: {res2.text}")

        # Kiểm tra manifest sau khi hoàn thành cả 2 request
        updated = self.repo.get_project("proj-race-test")
        self.assertIsNotNone(updated)
        self.assertEqual(len(updated.regions), 1, "Dữ liệu regions bị mất do race condition!")
        self.assertEqual(updated.regions[0].region_id, "roi-box-1")
        self.assertIsNotNone(updated.custom_pipeline_settings, "Dữ liệu settings bị mất do race condition!")
        self.assertEqual(updated.custom_pipeline_settings.get("aspect_ratio"), "16:9")
        self.assertEqual(updated.custom_pipeline_settings["dubbing"]["voice"], "vi-VN-HoaiMyNeural")

    def test_put_editor_state_endpoint_atomic_update(self) -> None:
        """
        Kiểm thử endpoint gộp PUT /api/v1/projects/{project_id}/editor-state:
        Cập nhật đồng thời cả regions và settings trong 1 request duy nhất.
        """
        proj = ProjectManifestV1(
            project_id="proj-editor-state-1",
            title="Kiểm Thử Editor State Gộp",
            source_video_path="C:/videos/test.mp4",
            video_fingerprint="fp-editor",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(proj)

        payload = {
            "regions": [
                {
                    "region_id": "roi-state-1",
                    "x": 0.05,
                    "y": 0.75,
                    "width": 0.9,
                    "height": 0.2,
                    "label": "Unified ROI",
                    "mask_style": "feather_tight",
                    "blur_strength": 25,
                }
            ],
            "settings": {
                "aspect_ratio": "9:16",
                "fit_mode": "cover",
                "preview_mask": True,
            },
        }

        res = self.client.put(
            "/api/v1/projects/proj-editor-state-1/editor-state",
            headers=self.headers,
            json=payload,
        )
        self.assertEqual(res.status_code, 200, f"Lỗi PUT /editor-state: {res.text}")
        data = res.json()
        self.assertEqual(data["status"], "success")

        updated = self.repo.get_project("proj-editor-state-1")
        self.assertIsNotNone(updated)
        self.assertEqual(len(updated.regions), 1)
        self.assertEqual(updated.regions[0].region_id, "roi-state-1")
        self.assertEqual(updated.custom_pipeline_settings.get("fit_mode"), "cover")

    def test_retranslate_with_zero_cues_returns_400(self) -> None:
        """
        Khi dự án có 0 subtitle cue, gọi POST /retranslate phải trả về mã lỗi 400 Bad Request
        kèm thông báo tiếng Việt giải thích rõ ràng, không được trả về 200 'empty' gây hiểu lầm thành công.
        """
        proj = ProjectManifestV1(
            project_id="proj-zero-cues",
            title="Dự Án Chưa Quét OCR",
            source_video_path="C:/videos/test.mp4",
            video_fingerprint="fp-zero",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(proj)

        res = self.client.post(
            "/api/v1/projects/proj-zero-cues/retranslate",
            headers=self.headers,
        )
        self.assertEqual(res.status_code, 400)
        detail = res.json().get("detail", "")
        self.assertIn("chưa có phụ đề", detail.lower())

    def test_dubbing_with_zero_cues_returns_400(self) -> None:
        """
        Khi dự án có 0 subtitle cue, gọi POST /dubbing/run phải trả về mã lỗi 400 Bad Request.
        """
        proj = ProjectManifestV1(
            project_id="proj-zero-cues-dub",
            title="Dự Án Chưa Quét OCR Cho TTS",
            source_video_path="C:/videos/test.mp4",
            video_fingerprint="fp-zero-dub",
            source_language="zh",
            target_language="vi",
        )
        self.repo.save_project(proj)

        res = self.client.post(
            "/api/v1/projects/proj-zero-cues-dub/dubbing/run",
            headers=self.headers,
            json={"mode": "single", "voice": "vi-VN-HoaiMyNeural"},
        )
        self.assertEqual(res.status_code, 400)
        detail = res.json().get("detail", "")
        self.assertIn("chưa có phụ đề", detail.lower())


if __name__ == "__main__":
    unittest.main()
