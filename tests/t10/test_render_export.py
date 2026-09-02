import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.render.ass import AssExporter
from subtitle_localizer.render.export import VideoExporter
from subtitle_localizer.render.mask import SubtitleMasker
from subtitle_localizer.render.srt import SrtExporter


class RenderAndExportTest(unittest.TestCase):
    def test_srt_export_formatting_and_utf8(self) -> None:
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=1.25, end_pts=3.5, source_text="你好", translated_text="Xin chào thế giới"),
            SubtitleCueV1(cue_id="c2", start_pts=4.0, end_pts=5.8, source_text="再见", translated_text="Tạm biệt và hẹn gặp lại"),
        ]
        exporter = SrtExporter()
        srt_content = exporter.export_srt_text(cues, use_translated=True)
        self.assertIn("1\n00:00:01,250 --> 00:00:03,500\nXin chào thế giới", srt_content)
        self.assertIn("2\n00:00:04,000 --> 00:00:05,800\nTạm biệt và hẹn gặp lại", srt_content)

    def test_ass_export_styles_and_events(self) -> None:
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=1.0, end_pts=2.5, translated_text="Phụ đề kiểu ASS"),
        ]
        exporter = AssExporter(font_name="Arial", font_size=24, primary_color="&H00FFFFFF")
        ass_content = exporter.export_ass_text(cues, script_title="Test ASS")
        self.assertIn("[Script Info]", ass_content)
        self.assertIn("[V4+ Styles]", ass_content)
        self.assertIn("[Events]", ass_content)
        self.assertIn("Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,Phụ đề kiểu ASS", ass_content)

    def test_mask_filter_generation(self) -> None:
        masker = SubtitleMasker()
        # Box filter
        box_filter = masker.get_filter_string(mode="box", x=100, y=800, width=800, height=150)
        self.assertIn("drawbox", box_filter)
        self.assertIn("color=black@0.85", box_filter)

        # Blur filter
        blur_filter = masker.get_filter_string(mode="blur", x=100, y=800, width=800, height=150)
        self.assertIn("boxblur", blur_filter)

    def test_sttn_lama_fallback_safety(self) -> None:
        masker = SubtitleMasker()
        # Khi STTN/LAMA weights không sẵn sàng, fallback về box filter an toàn
        fallback_filter = masker.get_filter_string(mode="sttn_lama", x=100, y=800, width=800, height=150)
        self.assertIn("drawbox", fallback_filter)

    def test_video_exporter_encoder_selection(self) -> None:
        exporter = VideoExporter()
        cmd = exporter.build_ffmpeg_render_command(
            source_video_path="input.mp4",
            output_video_path="output.mp4",
            ass_path="sub.ass",
            use_nvenc=True,
        )
        self.assertIn("h264_nvenc", cmd)
        self.assertIn("-c:a", cmd)


if __name__ == "__main__":
    unittest.main()
