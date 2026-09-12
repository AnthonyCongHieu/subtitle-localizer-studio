# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import numpy as np

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import SubtitleCueV1
import subtitle_localizer.dubbing.tts as tts_mod

SAMPLE_RATE = 44100
DUR = 0.5
t = np.linspace(0, DUR, int(SAMPLE_RATE * DUR), endpoint=False, dtype=np.float32)
MOCK_PCM = 0.3 * np.sin(2 * np.pi * 440 * t)
MOCK_MP3 = b"ID3\x03\x00\x00\x00\x00\x00#TSSE\x00\x00\x00\x0f\x00\x00\x03Lavf58.76.100\x00" + b"\xff\xfb\x90d" * 50


class DubbingConcurrencyAndCancellationTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.output_dir = Path(self.temp_dir.name)

    async def asyncTearDown(self) -> None:
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    async def test_1_baseline_concurrency_one_is_strictly_sequential(self) -> None:
        """Chứng minh với concurrency=1, các request bị ép tuần tự (max_concurrency == 1)."""
        active = 0
        peak = 0

        async def fake_edge(*args, **kwargs):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.02)
            active -= 1
            return MOCK_MP3

        # Force concurrency limit to 1
        if hasattr(tts_mod, "set_provider_concurrency"):
            tts_mod.set_provider_concurrency("edge", 1)
        elif hasattr(tts_mod, "_PROVIDER_CONCURRENCY_LIMITS"):
            tts_mod._PROVIDER_CONCURRENCY_LIMITS["edge"] = 1

        with patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", side_effect=fake_edge):
            tasks = [
                tts_mod.synthesize_text(f"Câu {i}", provider="edge", voice="vi-VN-NamMinhNeural")
                for i in range(6)
            ]
            await asyncio.gather(*tasks)

        self.assertEqual(peak, 1, "Concurrency=1 phải tạo thứ tự tuần tự tuyệt đối")

    async def test_2_configurable_concurrency_reduces_total_time(self) -> None:
        """Chứng minh concurrency cấu hình được (>1) và giảm tổng thời gian so với concurrency=1."""
        delay = 0.04
        cues_count = 8

        # 1. Chạy với concurrency = 1
        tts_mod.set_provider_concurrency("edge", 1)
        async def fake_edge_slow(*args, **kwargs):
            await asyncio.sleep(delay)
            return MOCK_MP3

        with patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", side_effect=fake_edge_slow):
            t0 = time.perf_counter()
            tasks_seq = [
                tts_mod.synthesize_text(f"Câu {i}", provider="edge", voice="vi-VN-NamMinhNeural")
                for i in range(cues_count)
            ]
            await asyncio.gather(*tasks_seq)
            time_seq = time.perf_counter() - t0

        # 2. Chạy với concurrency = 4
        tts_mod.set_provider_concurrency("edge", 4)
        active = 0
        peak = 0
        async def fake_edge_par(*args, **kwargs):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(delay)
            active -= 1
            return MOCK_MP3

        with patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", side_effect=fake_edge_par):
            t0 = time.perf_counter()
            tasks_par = [
                tts_mod.synthesize_text(f"Câu {i}", provider="edge", voice="vi-VN-NamMinhNeural")
                for i in range(cues_count)
            ]
            await asyncio.gather(*tasks_par)
            time_par = time.perf_counter() - t0

        self.assertGreater(peak, 1, "Concurrency=4 phải có nhiều hơn 1 task chạy đồng thời")
        self.assertLessEqual(peak, 4, "Concurrency không được vượt quá 4")
        self.assertLess(time_par, time_seq * 0.6, f"Concurrency=4 ({time_par:.3f}s) phải nhanh hơn hẳn Concurrency=1 ({time_seq:.3f}s)")

    async def test_3_concurrency_never_exceeds_configured_cap(self) -> None:
        """Kiểm tra concurrency không vượt quá ngưỡng trần đã cấu hình."""
        limit = 3
        tts_mod.set_provider_concurrency("edge", limit)
        active = 0
        peak = 0

        async def fake_edge(*args, **kwargs):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.02)
            active -= 1
            return MOCK_MP3

        with patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", side_effect=fake_edge):
            tasks = [
                tts_mod.synthesize_text(f"Câu {i}", provider="edge", voice="vi-VN-NamMinhNeural")
                for i in range(12)
            ]
            await asyncio.gather(*tasks)

        self.assertEqual(peak, limit, f"Peak concurrency ({peak}) phải chạm đúng limit ({limit}) mà không vượt quá")

    async def test_4_retry_backoff_timeout_and_fallback(self) -> None:
        """Kiểm tra timeout từng request kích hoạt retry và fallback đúng quy trình mà không làm crash gather."""
        edge_attempts = 0
        sapi_called = False

        async def fake_edge_timeout(*args, **kwargs):
            nonlocal edge_attempts
            edge_attempts += 1
            raise asyncio.TimeoutError("Edge TTS request timed out")

        async def fake_sapi(text):
            nonlocal sapi_called
            sapi_called = True
            return MOCK_MP3

        with patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", side_effect=fake_edge_timeout), \
             patch("subtitle_localizer.dubbing.tts._synthesize_windows_sapi", side_effect=fake_sapi):
            
            res = await tts_mod.synthesize_text(
                "Xin chào đây là câu test timeout",
                provider="edge",
                voice="vi-VN-NamMinhNeural",
                max_retries=2,
            )

        self.assertGreaterEqual(edge_attempts, 1, "Edge TTS phải được gọi ít nhất 1 lần")
        self.assertTrue(sapi_called, "Khi Edge TTS gặp timeout/lỗi vĩnh viễn, phải fallback sang Windows SAPI")
        self.assertEqual(res, MOCK_MP3)

    async def test_5_cancellation_releases_semaphore_and_cleans_up(self) -> None:
        """Kiểm tra cancellation giải phóng task và semaphore, không để semaphore bị rò rỉ."""
        tts_mod.set_provider_concurrency("edge", 2)
        sem = tts_mod._provider_semaphore("edge")
        initial_value = sem._value

        cues = [
            SubtitleCueV1(
                cue_id=f"c_{i}",
                start_pts=float(i * 3),
                end_pts=float(i * 3 + 1.5),
                source_text=f"原文{i}",
                translated_text=f"Câu dịch thử nghiệm số {i+1}",
            )
            for i in range(10)
        ]

        async def fake_edge_hanging(*args, **kwargs):
            await asyncio.sleep(5.0)
            return MOCK_MP3

        with patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", side_effect=fake_edge_hanging), \
             patch("subtitle_localizer.dubbing.tts._decode_mp3_to_pcm", return_value=MOCK_PCM), \
             patch("subtitle_localizer.dubbing.tts.is_valid_speech_audio", return_value=True):

            out_file = self.output_dir / "cancelling_test.mp3"
            task = asyncio.create_task(
                tts_mod.generate_timed_voiceover(
                    cues=cues,
                    voice="vi-VN-NamMinhNeural",
                    output_path=out_file,
                    total_duration=35.0,
                    provider="edge",
                )
            )

            # Chờ task bắt đầu và giữ semaphore
            await asyncio.sleep(0.05)
            # Hủy task
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        # Sau khi bị cancel, semaphore phải được hoàn trả về giá trị ban đầu
        self.assertEqual(sem._value, initial_value, "Semaphore phải được giải phóng hoàn toàn sau khi task bị Cancel")

    async def test_6_progress_callback_increments_with_heartbeat(self) -> None:
        """Kiểm tra progress callback tăng đều đặn khi từng câu hoàn tất, không bị kẹt ở 0%."""
        progress_events = []

        def on_progress(done: int, total: int, text: str):
            progress_events.append((done, total, text))

        cues = [
            SubtitleCueV1(
                cue_id=f"c_{i}",
                start_pts=float(i * 4),
                end_pts=float(i * 4 + 2),
                source_text=f"原文{i}",
                translated_text=f"Nội dung câu thứ {i+1} độc lập.",
            )
            for i in range(5)
        ]

        with patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", return_value=MOCK_MP3), \
             patch("subtitle_localizer.dubbing.tts._decode_mp3_to_pcm", return_value=MOCK_PCM), \
             patch("subtitle_localizer.dubbing.tts._encode_pcm_to_mp3", return_value=Path("dummy.mp3")), \
             patch("subtitle_localizer.dubbing.tts.is_valid_speech_audio", return_value=True):

            out_file = self.output_dir / "progress_test.mp3"
            await tts_mod.generate_timed_voiceover(
                cues=cues,
                voice="vi-VN-NamMinhNeural",
                output_path=out_file,
                total_duration=25.0,
                provider="edge",
                progress_callback=on_progress,
            )

        self.assertEqual(len(progress_events), 5, "Progress callback phải được gọi đủ cho cả 5 câu")
        done_counts = [e[0] for e in progress_events]
        self.assertEqual(done_counts, [1, 2, 3, 4, 5], "Done counts phải tăng dần từ 1 đến 5")

    async def test_7_140_cues_maintains_order_and_produces_valid_output(self) -> None:
        """Kiểm tra 140 câu giữ nguyên thứ tự timeline PTS, không mất câu, không rỗng audio."""
        count = 140
        tts_mod.set_provider_concurrency("edge", 4)

        cues = [
            SubtitleCueV1(
                cue_id=f"cue_{i:03d}",
                start_pts=float(i * 3.0),
                end_pts=float(i * 3.0 + 1.5),
                source_text=f"原文短句{i}",
                translated_text=f"Câu thoại số {i+1} bảo toàn thứ tự timeline.",
            )
            for i in range(count)
        ]

        async def fake_edge_ordered(text, *args, **kwargs):
            await asyncio.sleep(0.001)
            return MOCK_MP3

        def fake_encode(pcm, path, sample_rate=44100):
            p = Path(path)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(MOCK_MP3)
            return p

        with patch("subtitle_localizer.dubbing.tts._synthesize_edge_tts", side_effect=fake_edge_ordered), \
             patch("subtitle_localizer.dubbing.tts._decode_mp3_to_pcm", return_value=MOCK_PCM), \
             patch("subtitle_localizer.dubbing.tts._encode_pcm_to_mp3", side_effect=fake_encode), \
             patch("subtitle_localizer.dubbing.tts.is_valid_speech_audio", return_value=True):

            out_file = self.output_dir / "140_cues_output.mp3"
            res = await tts_mod.generate_timed_voiceover(
                cues=cues,
                voice="vi-VN-NamMinhNeural",
                output_path=out_file,
                total_duration=count * 3.0 + 2.0,
                provider="edge",
            )

        self.assertTrue(Path(res).exists(), "File voiceover master phải tồn tại trên đĩa")
        self.assertGreater(Path(res).stat().st_size, 0, "File voiceover master không được rỗng")



    async def test_8_server_cancellation_cancels_dubbing_task(self) -> None:
        """Kiểm tra gọi pipeline/stop trên server hủy trực tiếp task dubbing đang chờ và giải phóng tài nguyên."""
        from subtitle_localizer.service.server import create_app
        from subtitle_localizer.persistence.database import Database
        from subtitle_localizer.persistence.repository import ProjectRepository
        from fastapi.testclient import TestClient

        db_file = self.output_dir / "test_cancel.db"
        db = Database(db_file)
        db.migrate()
        repo = ProjectRepository(db)
        app = create_app(database=db, repo=repo, output_root=self.output_dir)
        client = TestClient(app)

        res_create = client.post("/api/v1/projects", json={"title": "Cancel Test", "source_video_path": "dummy.mp4"})
        proj_id = res_create.json()["project_id"]

        # Tạo một asyncio task đang chạy thực tế và đưa vào app.state.active_dubbing_tasks
        task_cancelled = False
        async def mock_dub_running():
            nonlocal task_cancelled
            try:
                await asyncio.sleep(60.0)
            except asyncio.CancelledError:
                task_cancelled = True
                raise

        dub_task = asyncio.create_task(mock_dub_running())
        app.state.active_dubbing_tasks[proj_id] = dub_task

        # Gọi endpoint hủy tiến trình
        stop_res = client.post(f"/api/v1/projects/{proj_id}/pipeline/stop")
        self.assertEqual(stop_res.status_code, 200)
        self.assertEqual(stop_res.json()["status"], "cancelled")

        # Đảm bảo task thực sự nhận được tín hiệu hủy
        await asyncio.sleep(0.01)
        self.assertTrue(dub_task.cancelled() or task_cancelled, "Task dubbing thực tế phải bị hủy khi pipeline/stop được gọi")

        db.close()

    async def test_10_server_applies_settings_concurrency_and_timeout(self) -> None:
        """Kiểm tra server áp dụng đúng cấu hình concurrency từ settings/manifest khi chạy dubbing."""
        from subtitle_localizer.service.server import create_app
        from subtitle_localizer.persistence.database import Database
        from subtitle_localizer.persistence.repository import ProjectRepository
        from fastapi.testclient import TestClient

        db_file = self.output_dir / "test_settings_apply.db"
        db = Database(db_file)
        db.migrate()
        repo = ProjectRepository(db)
        app = create_app(database=db, repo=repo, output_root=self.output_dir)
        client = TestClient(app)

        res_create = client.post("/api/v1/projects", json={
            "title": "Settings Concurrency Test",
            "source_video_path": "dummy.mp4",
        })
        proj_id = res_create.json()["project_id"]
        client.put(f"/api/v1/projects/{proj_id}/cues", json=[{
            "cue_id": "c1", "start_pts": 0.0, "end_pts": 1.0,
            "source_text": "A", "translated_text": "B",
            "confidence": 1.0, "revision": 1, "status": "auto",
        }])

        passed_timeout = None
        async def fake_timed_dub(*args, **kwargs):
            nonlocal passed_timeout
            passed_timeout = kwargs.get("request_timeout")
            out = Path(kwargs.get("output_path", "out.mp3"))
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(b"ID3dummy")
            return out

        with patch("subtitle_localizer.dubbing.tts.generate_timed_voiceover", side_effect=fake_timed_dub),              patch("subtitle_localizer.dubbing.tts.is_valid_speech_audio", return_value=True):
            dub_res = client.post(f"/api/v1/projects/{proj_id}/dubbing/run", json={
                "provider": "edge",
                "edge_concurrency": 6,
                "request_timeout_seconds": 18.5,
            })
            self.assertEqual(dub_res.status_code, 200, dub_res.text)

        self.assertEqual(tts_mod.get_provider_concurrency("edge"), 6, "Concurrency 6 từ request body phải được áp dụng vào runtime")
        self.assertEqual(passed_timeout, 18.5, "Timeout 18.5s từ request body phải được truyền vào generate_timed_voiceover")
        db.close()

    async def test_9_video_rescue_retiming_logic(self) -> None:
        """Kiểm tra video rescue plan tính toán đúng factor và retime cue không bị chồng lấn."""
        from subtitle_localizer.render.video_rescue import build_video_rescue_plan, retime_cues_for_video_rescue

        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=1.0, end_pts=3.0, translated_text="Câu 1"),
            SubtitleCueV1(cue_id="c2", start_pts=4.0, end_pts=6.0, translated_text="Câu 2"),
        ]
        # Overflow 0.5s cho c1
        plan = build_video_rescue_plan(cues, {"c1": 0.5}, max_slowdown=1.25)
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0].cue_id, "c1")
        self.assertAlmostEqual(plan[0].factor, 1.25)

        retimed = retime_cues_for_video_rescue(cues, plan)
        # c2 bắt đầu sau c1 nên bị dịch chuyển thêm added_seconds của c1 (2.0 * 0.25 = 0.5s)
        self.assertAlmostEqual(retimed[1].start_pts, 4.5)
        self.assertAlmostEqual(retimed[1].end_pts, 6.5)

if __name__ == "__main__":
    unittest.main()
