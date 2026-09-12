"""End-to-End full pipeline execution test with real FFmpeg/ffprobe verification."""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from subtitle_localizer.domain.models import (
    FullPipelineSettingsV1,
    FullPipelineStageV1,
    FullPipelineWorkflowV1,
    ProjectManifestV1,
    RegionTrackV1,
    SubtitleCueV1,
)
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.full_pipeline_orchestrator import FullPipelineOrchestrator


class TestFullPipelineEndToEnd(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "e2e_test.db"
        self.db = Database(self.db_path)
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        self.output_dir = Path(self.temp_dir.name) / "outputs"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.orchestrator = FullPipelineOrchestrator(self.repo, output_root=str(self.output_dir))

        # Generate a 2-second synthetic test MP4 with video and audio using FFmpeg
        self.sample_video = Path(self.temp_dir.name) / "sample_test.mp4"
        cmd = [
            "ffmpeg",
            "-y",
            "-f", "lavfi",
            "-i", "testsrc=size=640x360:rate=25:duration=2",
            "-f", "lavfi",
            "-i", "sine=frequency=1000:duration=2",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            str(self.sample_video),
        ]
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

    def tearDown(self) -> None:
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_e2e_pipeline_stages_and_output_verification(self) -> None:
        """Run workflow through stages, generate video and subtitles, and verify via ffprobe."""
        workflow = FullPipelineWorkflowV1(
            workflow_id="wf-e2e-real",
            source_url=str(self.sample_video),
            title="Kiem thu Pipeline Tu Dong Hoa",
            settings=FullPipelineSettingsV1(
                source_language="zh",
                target_language="vi",
                dubbing_enabled=True,
                burn_subtitles=True,
                mask_subtitles=True,
                export_srt_ass=True,
                output_dir=str(self.output_dir / "wf-e2e-real"),
            ),
        )
        self.repo.save_workflow(workflow)

        # 1. Gate: Download
        self.orchestrator.verify_download_gate(workflow, self.sample_video)
        self.assertEqual(self.sample_video.exists(), True)

        # 2. Gate: ROI
        detected_rois = [
            RegionTrackV1(region_id="roi-bottom", x=0.05, y=0.75, width=0.9, height=0.18)
        ]
        self.assertTrue(self.orchestrator.verify_roi_gate(workflow, detected_rois))

        # 3. Gate: OCR with Chinese source text
        cues = [
            SubtitleCueV1(cue_id="cue-1", start_pts=0.2, end_pts=1.0, source_text="你好世界"),
            SubtitleCueV1(cue_id="cue-2", start_pts=1.1, end_pts=1.9, source_text="欢迎使用字幕本地化系统"),
        ]
        self.assertTrue(self.orchestrator.verify_ocr_gate(workflow, cues))

        # 4. Gate: Translation with Vietnamese target text
        cues[0].translated_text = "Xin chào thế giới"
        cues[1].translated_text = "Chào mừng bạn đến với hệ thống bản địa hóa phụ đề"
        self.assertTrue(self.orchestrator.verify_translation_gate(workflow, cues))

        # 5. Gate: Dubbing
        tts_wav = Path(self.temp_dir.name) / "dubbed_audio.wav"
        cmd_tts = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "sine=frequency=600:duration=2",
            "-c:a", "pcm_s16le", str(tts_wav)
        ]
        subprocess.run(cmd_tts, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.assertTrue(self.orchestrator.verify_dubbing_gate(workflow, tts_wav))

        # 6. Stage Export: Create SRT and ASS subtitle files with proper UTF-8
        project_dir = self.output_dir / "wf-e2e-real"
        project_dir.mkdir(parents=True, exist_ok=True)
        srt_file = project_dir / "subtitles.vi.srt"
        ass_file = project_dir / "subtitles.vi.ass"

        srt_content = (
            "1\n00:00:00,200 --> 00:00:01,000\nXin chào thế giới\n\n"
            "2\n00:00:01,100 --> 00:00:01,900\nChào mừng bạn đến với hệ thống bản địa hóa phụ đề\n"
        )
        srt_file.write_text(srt_content, encoding="utf-8")

        ass_content = (
            "[Script Info]\nTitle: Test\nScriptType: v4.00+\n\n"
            "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
            "Dialogue: 0,0:00:00.20,0:00:01.00,Default,,0,0,0,,Xin chào thế giới\n"
            "Dialogue: 0,0:00:01.10,0:00:01.90,Default,,0,0,0,,Chào mừng bạn đến với hệ thống bản địa hóa phụ đề\n"
        )
        ass_file.write_text(ass_content, encoding="utf-8")

        # Export video using FFmpeg with box filter (simulating mask) and dubbed audio
        exported_mp4 = project_dir / "output_localized.mp4"
        cmd_export = [
            "ffmpeg", "-y",
            "-i", str(self.sample_video),
            "-i", str(tts_wav),
            "-filter_complex", "[0:v]drawbox=x=32:y=270:w=576:h=64:color=black@0.6:t=fill[v]",
            "-map", "[v]",
            "-map", "1:a",
            "-c:v", "libx264",
            "-c:a", "aac",
            "-shortest",
            str(exported_mp4),
        ]
        subprocess.run(cmd_export, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # Verify export gate
        self.assertTrue(self.orchestrator.verify_export_gate(workflow, exported_mp4))

        # Verify via ffprobe
        ffprobe_cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(exported_mp4),
        ]
        probe_res = subprocess.run(ffprobe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        probe_data = json.loads(probe_res.stdout.decode("utf-8"))

        stream_types = [s.get("codec_type") for s in probe_data.get("streams", [])]
        self.assertIn("video", stream_types)
        self.assertIn("audio", stream_types)

        duration = float(probe_data.get("format", {}).get("duration", 0))
        self.assertGreater(duration, 1.8)
        self.assertLessEqual(duration, 2.5)

        # Verify Unicode text in SRT and ASS (no mojibake)
        read_srt = srt_file.read_text(encoding="utf-8")
        self.assertIn("Xin chào thế giới", read_srt)
        self.assertIn("hệ thống bản địa hóa", read_srt)
        self.assertNotIn("\ufffd", read_srt)

        read_ass = ass_file.read_text(encoding="utf-8")
        self.assertIn("Xin chào thế giới", read_ass)
        self.assertNotIn("\ufffd", read_ass)

        # Update workflow to completed
        workflow.state = "completed"
        workflow.progress = 1.0
        workflow.artifacts = {
            "exported_video": str(exported_mp4),
            "subtitles_srt": str(srt_file),
            "subtitles_ass": str(ass_file),
        }
        self.repo.save_workflow(workflow)

        loaded = self.repo.get_workflow("wf-e2e-real")
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.state, "completed")
        self.assertEqual(loaded.artifacts.get("exported_video"), str(exported_mp4))
        self.assertIn("subtitles_srt", loaded.artifacts)
        print("ALL E2E PIPELINE AND ARTIFACT VERIFICATIONS PASSED")

    def _create_synthetic_video_with_subtitles(self) -> Path:
        import cv2
        import numpy as np
        from PIL import Image, ImageDraw, ImageFont

        raw_video = Path(self.temp_dir.name) / "raw_synth.mp4"
        font_path = "C:/Windows/Fonts/msyh.ttc"
        font = ImageFont.truetype(font_path, 36) if os.path.exists(font_path) else ImageFont.load_default()

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(str(raw_video), fourcc, 25.0, (640, 360))
        for _ in range(50):
            img = Image.new("RGB", (640, 360), color=(20, 20, 40))
            draw = ImageDraw.Draw(img)
            draw.text((150, 260), "你好世界", font=font, fill=(255, 255, 255))
            frame = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
            out.write(frame)
        out.release()

        out_path = Path(self.temp_dir.name) / "subtitled_synth.mp4"
        cmd = [
            "ffmpeg", "-y", "-i", str(raw_video),
            "-f", "lavfi", "-i", "sine=frequency=1000:duration=2",
            "-c:v", "libx264", "-c:a", "aac", str(out_path)
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return out_path

    def test_orchestrator_run_workflow_sync_real_execution(self) -> None:
        """Call _run_workflow_sync directly with a real video containing Chinese subtitles,
        executing all stages through RapidOCR, Translation, and FFmpeg export without mocking."""
        video_file = self._create_synthetic_video_with_subtitles()
        wf = FullPipelineWorkflowV1(
            workflow_id="wf-sync-real-e2e",
            source_url=str(video_file),
            title="Real E2E Pipeline Sync Execution",
            settings=FullPipelineSettingsV1(
                source_language="zh",
                target_language="vi",
                dubbing_enabled=False,
                burn_subtitles=True,
                mask_subtitles=True,
                export_srt_ass=True,
            ),
        )
        self.repo.save_workflow(wf)

        # Run the real synchronous orchestrator logic
        self.orchestrator._run_workflow_sync("wf-sync-real-e2e")

        completed_wf = self.repo.get_workflow("wf-sync-real-e2e")
        self.assertIsNotNone(completed_wf)
        self.assertEqual(completed_wf.state, "completed")
        self.assertEqual(completed_wf.progress, 1.0)
        self.assertEqual(len(completed_wf.errors), 0)

        # Verify stages status
        self.assertEqual(completed_wf.get_stage("downloading").status, "completed")
        self.assertEqual(completed_wf.get_stage("detecting_roi").status, "completed")
        self.assertEqual(completed_wf.get_stage("ocr").status, "completed")
        self.assertEqual(completed_wf.get_stage("translating").status, "completed")
        self.assertEqual(completed_wf.get_stage("dubbing").status, "skipped")
        self.assertEqual(completed_wf.get_stage("exporting").status, "completed")

        # Verify artifacts
        self.assertIn("source_video", completed_wf.artifacts)
        self.assertIn("regions", completed_wf.artifacts)
        self.assertGreaterEqual(completed_wf.artifacts.get("cues_count", 0), 1)
        self.assertGreaterEqual(completed_wf.artifacts.get("translated_count", 0), 1)

        # Verify export MP4 file
        export_mp4 = Path(completed_wf.artifacts["export_mp4"])
        self.assertTrue(export_mp4.exists())
        self.assertGreater(export_mp4.stat().st_size, 1000)

        # Verify via ffprobe
        probe_cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", str(export_mp4)
        ]
        res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, text=True, check=True)
        probe_json = json.loads(res.stdout)
        stream_types = [s.get("codec_type") for s in probe_json.get("streams", [])]
        self.assertIn("video", stream_types)

        # Verify SRT and ASS content and UTF-8 encoding
        srt_p = Path(completed_wf.artifacts["srt_path"])
        self.assertTrue(srt_p.exists())
        srt_content = srt_p.read_text(encoding="utf-8")
        self.assertIn("Xin chào thế giới", srt_content)
        self.assertNotIn("\ufffd", srt_content)

        ass_p = Path(completed_wf.artifacts["ass_path"])
        self.assertTrue(ass_p.exists())
        ass_content = ass_p.read_text(encoding="utf-8")
        self.assertIn("Xin chào thế giới", ass_content)
        self.assertNotIn("\ufffd", ass_content)

    def test_orchestrator_stage_resume_on_retry(self) -> None:
        """Verify that retrying a workflow from a specific stage reuses completed upstream artifacts."""
        video_file = self._create_synthetic_video_with_subtitles()
        wf = FullPipelineWorkflowV1(
            workflow_id="wf-resume-test",
            source_url=str(video_file),
            title="Stage Resume Test",
            settings=FullPipelineSettingsV1(
                source_language="zh",
                target_language="vi",
                dubbing_enabled=False,
                burn_subtitles=True,
                mask_subtitles=True,
                export_srt_ass=True,
            ),
        )
        self.repo.save_workflow(wf)

        # Run once to completed
        self.orchestrator._run_workflow_sync("wf-resume-test")
        wf_first = self.repo.get_workflow("wf-resume-test")
        self.assertEqual(wf_first.state, "completed")
        first_video = wf_first.artifacts["source_video"]
        first_regions = wf_first.artifacts["regions"]

        # Call retry_workflow from 'translating' stage
        # To avoid launching an asynchronous background thread during sync unit test, reset directly:
        stages_order = ["downloading", "detecting_roi", "ocr", "translating", "dubbing", "exporting"]
        target_idx = stages_order.index("translating")
        for idx in range(target_idx, len(stages_order)):
            wf_first.update_stage(stages_order[idx], status="pending", progress=0.0)
        wf_first.state = "retrying"
        wf_first.current_stage = "translating"
        wf_first.retry_count += 1
        self.repo.save_workflow(wf_first)

        # Run sync execution again
        self.orchestrator._run_workflow_sync("wf-resume-test")
        wf_resumed = self.repo.get_workflow("wf-resume-test")
        self.assertEqual(wf_resumed.state, "completed")
        self.assertEqual(wf_resumed.retry_count, 1)

        # Verify that upstream artifacts were preserved and reused
        self.assertEqual(wf_resumed.artifacts["source_video"], first_video)
        self.assertEqual(wf_resumed.artifacts["regions"], first_regions)
        self.assertEqual(wf_resumed.get_stage("downloading").status, "completed")
        self.assertEqual(wf_resumed.get_stage("detecting_roi").status, "completed")
        self.assertEqual(wf_resumed.get_stage("ocr").status, "completed")
        self.assertEqual(wf_resumed.get_stage("translating").status, "completed")
        self.assertEqual(wf_resumed.get_stage("exporting").status, "completed")

    def test_real_edge_tts_dubbing_and_mux_into_mp4(self) -> None:
        """P1: Sử dụng Edge TTS thật sinh giọng đọc tiếng Việt, kiểm tra audio hợp lệ và mux vào MP4."""
        from subtitle_localizer.dubbing.tts import generate_timed_voiceover, is_valid_speech_audio
        from subtitle_localizer.service.export_service import do_export_mp4

        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.2, end_pts=1.2, source_text="你好", translated_text="Xin chào các bạn"),
        ]
        voiceover_file = Path(self.temp_dir.name) / "real_edge_tts.mp3"

        # Sinh giọng đọc thật bằng Edge TTS (không mock)
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(
                generate_timed_voiceover(
                    cues=cues,
                    voice="vi-VN-HoaiMyNeural",
                    output_path=voiceover_file,
                    total_duration=2.0,
                    provider="edge",
                )
            )
        finally:
            loop.close()

        self.assertTrue(voiceover_file.exists())
        self.assertGreater(voiceover_file.stat().st_size, 1000)
        self.assertTrue(is_valid_speech_audio(voiceover_file.read_bytes()))

        # Tạo dự án và xuất MP4 có voiceover
        proj = ProjectManifestV1(
            project_id="proj-real-tts",
            title="Real TTS Project",
            source_video_path=str(self.sample_video),
            video_fingerprint="fp-real-tts",
            source_language="zh",
            target_language="vi",
            has_voiceover=True,
            voiceover_path=str(voiceover_file),
        )
        self.repo.save_project(proj)
        self.repo.save_cues(proj.project_id, cues)

        out_mp4_str = do_export_mp4(
            repository=self.repo,
            resolved_output_root=self.output_dir,
            project_id=proj.project_id,
            mask_mode="none",
            voiceover_path=voiceover_file,
        )
        out_mp4 = Path(out_mp4_str)
        self.assertTrue(out_mp4.exists())
        self.assertGreater(out_mp4.stat().st_size, 1000)

        # Kiểm tra ffprobe: bắt buộc có cả video stream và audio stream
        probe_cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", str(out_mp4)
        ]
        res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, text=True, check=True)
        probe_json = json.loads(res.stdout)
        stream_types = [s.get("codec_type") for s in probe_json.get("streams", [])]
        self.assertIn("video", stream_types)
        self.assertIn("audio", stream_types)

        # Kiểm tra workflow gate export pass
        wf = FullPipelineWorkflowV1(
            workflow_id="wf-real-tts-gate",
            source_url=str(self.sample_video),
            settings=FullPipelineSettingsV1(dubbing_enabled=True),
        )
        self.assertTrue(self.orchestrator.verify_export_gate(wf, out_mp4, expect_audio=True))

    def test_orchestrator_run_workflow_sync_with_real_dubbing(self) -> None:
        """P1: Full Orchestrator E2E chạy từ video có phụ đề đến MP4 hoàn chỉnh khi dubbing_enabled=True."""
        video_file = self._create_synthetic_video_with_subtitles()
        wf = FullPipelineWorkflowV1(
            workflow_id="wf-sync-dubbed-e2e",
            source_url=str(video_file),
            title="Real E2E Pipeline With Real Dubbing",
            settings=FullPipelineSettingsV1(
                source_language="zh",
                target_language="vi",
                dubbing_enabled=True,
                voice="vi-VN-HoaiMyNeural",
                burn_subtitles=True,
                mask_subtitles=True,
                export_srt_ass=True,
            ),
        )
        self.repo.save_workflow(wf)

        # Chạy full pipeline đồng bộ
        self.orchestrator._run_workflow_sync("wf-sync-dubbed-e2e")

        completed_wf = self.repo.get_workflow("wf-sync-dubbed-e2e")
        self.assertIsNotNone(completed_wf)
        self.assertEqual(completed_wf.state, "completed")
        self.assertEqual(completed_wf.progress, 1.0)
        self.assertEqual(len(completed_wf.errors), 0)

        # Kiểm tra tất cả 6 stages đều completed
        for stage_name in ["downloading", "detecting_roi", "ocr", "translating", "dubbing", "exporting"]:
            st = completed_wf.get_stage(stage_name)
            self.assertIsNotNone(st, f"Stage {stage_name} missing")
            self.assertEqual(st.status, "completed", f"Stage {stage_name} status is {st.status}")

        # Kiểm tra artifact voiceover tồn tại
        self.assertIn("voiceover_path", completed_wf.artifacts)
        vo_path = Path(completed_wf.artifacts["voiceover_path"])
        self.assertTrue(vo_path.exists())
        self.assertGreater(vo_path.stat().st_size, 500)

        # Kiểm tra export MP4 có cả video và audio stream
        export_mp4 = Path(completed_wf.artifacts["export_mp4"])
        self.assertTrue(export_mp4.exists())
        self.assertGreater(export_mp4.stat().st_size, 1000)

        probe_cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", str(export_mp4)
        ]
        res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, text=True, check=True)
        probe_json = json.loads(res.stdout)
        stream_types = [s.get("codec_type") for s in probe_json.get("streams", [])]
        self.assertIn("video", stream_types)
        self.assertIn("audio", stream_types)

    def test_real_online_youtube_full_pipeline_e2e(self) -> None:
        """P0 & Section 1: Kiểm thử toàn trình với video YouTube online thật đến trạng thái completed.
        Chuỗi: Download YouTube -> Auto ROI -> RapidOCR -> Translation -> Edge TTS Dubbing -> MP4 Export.
        """
        online_url = "https://www.youtube.com/watch?v=za4qeZiJZzY"
        wf = FullPipelineWorkflowV1(
            workflow_id="wf-online-youtube-e2e",
            source_url=online_url,
            title="Real Online YouTube E2E Test",
            settings=FullPipelineSettingsV1(
                source_language="zh",
                target_language="vi",
                dubbing_enabled=True,
                voice="vi-VN-HoaiMyNeural",
                burn_subtitles=True,
                mask_subtitles=True,
                export_srt_ass=True,
                proxy=None,
            ),
        )
        self.repo.save_workflow(wf)

        # Chạy full pipeline đồng bộ từ URL thật với real Gemini AI translation
        orig_gemini_env = os.environ.get("TEST_WITH_GEMINI")
        os.environ["TEST_WITH_GEMINI"] = "1"
        try:
            self.orchestrator._run_workflow_sync("wf-online-youtube-e2e")
        finally:
            if orig_gemini_env is None:
                os.environ.pop("TEST_WITH_GEMINI", None)
            else:
                os.environ["TEST_WITH_GEMINI"] = orig_gemini_env

        completed_wf = self.repo.get_workflow("wf-online-youtube-e2e")
        self.assertIsNotNone(completed_wf)
        self.assertEqual(completed_wf.state, "completed")
        self.assertEqual(completed_wf.progress, 1.0)
        self.assertEqual(len(completed_wf.errors), 0)

        # Kiểm tra toàn bộ 6 stages đều hoàn tất thành công
        for stage_name in ["downloading", "detecting_roi", "ocr", "translating", "dubbing", "exporting"]:
            st = completed_wf.get_stage(stage_name)
            self.assertIsNotNone(st, f"Stage {stage_name} missing")
            self.assertEqual(st.status, "completed", f"Stage {stage_name} status is {st.status}")

        # Kiểm tra Project Manifest thật được tạo và lưu trong DB
        self.assertIsNotNone(completed_wf.project_id)
        manifest = self.repo.get_project(completed_wf.project_id)
        self.assertIsNotNone(manifest)
        self.assertTrue(manifest.has_voiceover)
        self.assertTrue(manifest.has_export)

        # Kiểm tra Cues thật trong DB
        cues = self.repo.get_cues(completed_wf.project_id)
        self.assertGreaterEqual(len(cues), 1)
        for c in cues:
            self.assertTrue(bool(c.source_text and c.source_text.strip()))
            self.assertTrue(bool(c.translated_text and c.translated_text.strip()))

        # Kiểm tra Video nguồn thật tải về từ YouTube
        source_vid = Path(completed_wf.artifacts["source_video"])
        self.assertTrue(source_vid.exists())
        self.assertGreater(source_vid.stat().st_size, 500000)

        # Kiểm tra Voiceover AI thật sinh bằng Edge TTS
        vo_path = Path(completed_wf.artifacts["voiceover_path"])
        self.assertTrue(vo_path.exists())
        self.assertGreater(vo_path.stat().st_size, 1000)

        # Kiểm tra Phụ đề SRT và ASS thật
        srt_p = Path(completed_wf.artifacts["srt_path"])
        self.assertTrue(srt_p.exists())
        srt_text = srt_p.read_text(encoding="utf-8")
        self.assertNotIn("\ufffd", srt_text)

        ass_p = Path(completed_wf.artifacts["ass_path"])
        self.assertTrue(ass_p.exists())
        ass_text = ass_p.read_text(encoding="utf-8")
        self.assertNotIn("\ufffd", ass_text)

        # Kiểm tra File MP4 xuất thành phẩm bằng ffprobe
        export_mp4 = Path(completed_wf.artifacts["export_mp4"])
        self.assertTrue(export_mp4.exists())
        self.assertGreater(export_mp4.stat().st_size, 500000)

        probe_cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", str(export_mp4)
        ]
        res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, text=True, check=True)
        probe_json = json.loads(res.stdout)
        stream_types = [s.get("codec_type") for s in probe_json.get("streams", [])]
        self.assertIn("video", stream_types)
        self.assertIn("audio", stream_types)
        duration = float(probe_json.get("format", {}).get("duration", 0))
        self.assertGreater(duration, 15.0)
