import sys
import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import OcrObservationV1, SubtitleCueV1
from subtitle_localizer.dubbing.tts import (
    _decode_mp3_to_pcm,
    _encode_pcm_to_mp3,
    available_voiceover_slot,
    fade_trim_pcm,
    generate_voiceover_sync,
    generate_timed_voiceover,
    mix_voice_pcm,
)
from subtitle_localizer.reconstruction.builder import normalize_sequential_cues
from subtitle_localizer.service.capcut_api import CapCutSubtitleClient
from subtitle_localizer.service.worker import BackgroundWorker


class SequentialCueNormalizeTest(unittest.TestCase):
    def test_merges_adjacent_duplicate_iron_bowl_cues(self) -> None:
        cues = [
            SubtitleCueV1(
                cue_id="capcut-ad31bc0b",
                start_pts=48.38,
                end_pts=51.04,
                source_text="在她看来有了这个铁饭碗",
                translated_text='Theo cô, có được "chiếc bát cơm sắt" này',
            ),
            SubtitleCueV1(
                cue_id="capcut-996c8ed1",
                start_pts=51.18,
                end_pts=54.20,
                source_text="在她看来有了这个铁饭碗",
                translated_text='Theo cô, có được "chiếc bát cơm sắt" này',
            ),
        ]
        merged = normalize_sequential_cues(cues)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].start_pts, 48.38)
        self.assertEqual(merged[0].end_pts, 54.20)
        self.assertEqual(merged[0].source_text, "在她看来有了这个铁饭碗")
        self.assertIn("merged_duplicate", merged[0].quality_flags)

    def test_trims_capcut_end_padding_without_merging_distinct_lines(self) -> None:
        cues = [
            SubtitleCueV1(cue_id="a", start_pts=0.00, end_pts=1.82, source_text="女人只是啃了一根老冰棍"),
            SubtitleCueV1(cue_id="b", start_pts=1.70, end_pts=4.74, source_text="居然阴差阳错治好旁边男人的隐疾"),
        ]
        normalized = normalize_sequential_cues(cues)
        self.assertEqual(len(normalized), 2)
        self.assertLessEqual(normalized[0].end_pts, normalized[1].start_pts)
        self.assertEqual(normalized[1].source_text, "居然阴差阳错治好旁边男人的隐疾")

    def test_does_not_trim_large_distinct_overlaps(self) -> None:
        cues = [
            SubtitleCueV1(cue_id="a", start_pts=0.0, end_pts=2.0, source_text="Câu nam"),
            SubtitleCueV1(cue_id="b", start_pts=1.0, end_pts=3.0, source_text="Câu nữ"),
        ]
        normalized = normalize_sequential_cues(cues)
        self.assertEqual(len(normalized), 2)
        self.assertEqual(normalized[0].end_pts, 2.0)

    def test_does_not_merge_cues_that_only_share_empty_source_text(self) -> None:
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, translated_text="(Nhạc)"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, translated_text="Xin chào thế giới!"),
        ]
        self.assertEqual(len(normalize_sequential_cues(cues)), 2)

    def test_keeps_repeated_line_when_gap_is_large(self) -> None:
        cues = [
            SubtitleCueV1(cue_id="a", start_pts=1.0, end_pts=2.0, source_text="走吧"),
            SubtitleCueV1(cue_id="b", start_pts=8.0, end_pts=9.0, source_text="走吧"),
        ]
        normalized = normalize_sequential_cues(cues)
        self.assertEqual(len(normalized), 2)

    def test_merges_watermark_prefix_when_vietnamese_matches(self) -> None:
        same_vi = "Khi vô số hình ảnh lướt qua tâm trí người đàn ông"
        cues = [
            SubtitleCueV1(
                cue_id="3",
                start_pts=4.62,
                end_pts=5.82,
                source_text="就在男人脑海里飞速闪过无数画面时",
                translated_text=same_vi,
            ),
            SubtitleCueV1(
                cue_id="4",
                start_pts=5.82,
                end_pts=8.00,
                source_text="影视鉴君就在男人脑海里飞速闪过无数画面时",
                translated_text=same_vi,
            ),
        ]
        merged = normalize_sequential_cues(cues)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].start_pts, 4.62)
        self.assertEqual(merged[0].end_pts, 8.0)
        self.assertEqual(merged[0].source_text, "影视鉴君就在男人脑海里飞速闪过无数画面时")
        self.assertEqual(merged[0].translated_text, same_vi)

    def test_merges_watermark_prefix_from_source_containment(self) -> None:
        cues = [
            SubtitleCueV1(cue_id="3", start_pts=4.62, end_pts=5.82, source_text="就在男人脑海里飞速闪过无数画面时"),
            SubtitleCueV1(cue_id="4", start_pts=5.82, end_pts=8.00, source_text="影视鉴君就在男人脑海里飞速闪过无数画面时"),
        ]
        merged = normalize_sequential_cues(cues)
        self.assertEqual(len(merged), 1)


class RetranslateDuplicateMergeTest(unittest.TestCase):
    def setUp(self) -> None:
        from subtitle_localizer.persistence.database import Database
        from subtitle_localizer.persistence.repository import ProjectRepository
        from subtitle_localizer.service.server import create_app
        from subtitle_localizer.service.worker import BackgroundWorker
        from subtitle_localizer.domain.models import ProjectManifestV1

        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db = Database(Path(self.temp_dir.name) / "retranslate.db")
        self.db.migrate()
        self.repo = ProjectRepository(self.db)
        worker = BackgroundWorker(self.repo)
        translator = MagicMock()

        def translate_cues(cues, source_lang="zh", target_lang="vi"):
            same = "Khi vô số hình ảnh lướt qua tâm trí người đàn ông"
            for cue in cues:
                cue.translated_text = same
            return cues

        translator.translate_cues.side_effect = translate_cues
        worker.translation_registry.get_provider_for_pair = MagicMock(return_value=translator)
        self.app = create_app(
            database=self.db,
            repo=self.repo,
            auth_token="test-token-retranslate",
            output_root=Path(self.temp_dir.name) / "outputs",
            worker=worker,
        )
        self.project_id = "proj-retranslate-dup"
        self.repo.save_project(
            ProjectManifestV1(
                project_id=self.project_id,
                title="Retranslate dup",
                source_video_path="E:/dummy.mp4",
                video_fingerprint="fp-retranslate",
                source_language="zh",
                target_language="vi",
            )
        )
        self.repo.save_cues(
            self.project_id,
            [
                SubtitleCueV1(cue_id="3", start_pts=4.62, end_pts=5.82, source_text="就在男人脑海里飞速闪过无数画面时"),
                SubtitleCueV1(cue_id="4", start_pts=5.82, end_pts=8.00, source_text="影视鉴君就在男人脑海里飞速闪过无数画面时"),
                SubtitleCueV1(cue_id="iron-a", start_pts=48.38, end_pts=51.04, source_text="在她看来有了这个铁饭碗"),
                SubtitleCueV1(cue_id="iron-b", start_pts=51.18, end_pts=54.20, source_text="在她看来有了这个铁饭碗"),
            ],
        )

    def tearDown(self) -> None:
        self.db.close()
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_retranslate_saves_merged_duplicate_cues(self) -> None:
        from fastapi.testclient import TestClient

        client = TestClient(self.app)
        res = client.post(
            f"/api/v1/projects/{self.project_id}/retranslate",
            headers={"Authorization": "Bearer test-token-retranslate"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(data["cues_count"], 2)
        saved = self.repo.get_cues(self.project_id)
        self.assertEqual(len(saved), 2)
        self.assertEqual(saved[0].start_pts, 4.62)
        self.assertEqual(saved[0].end_pts, 8.0)
        self.assertEqual(saved[1].start_pts, 48.38)
        self.assertEqual(saved[1].end_pts, 54.2)


class CapCutUtteranceNormalizeTest(unittest.TestCase):
    def test_parse_utterances_merges_duplicates_and_trims_padding(self) -> None:
        client = CapCutSubtitleClient()
        cues = client.parse_utterances_to_cues(
            [
                {"start_time": 0, "end_time": 1820, "text": "女人只是啃了一根老冰棍"},
                {"start_time": 1700, "end_time": 4740, "text": "居然阴差阳错治好旁边男人的隐疾"},
                {"start_time": 48380, "end_time": 51040, "text": "在她看来有了这个铁饭碗"},
                {"start_time": 51180, "end_time": 54200, "text": "在她看来有了这个铁饭碗"},
            ]
        )
        self.assertEqual(len(cues), 3)
        self.assertLessEqual(cues[0].end_pts, cues[1].start_pts)
        self.assertEqual(cues[2].source_text, "在她看来有了这个铁饭碗")
        self.assertEqual(cues[2].start_pts, 48.38)
        self.assertEqual(cues[2].end_pts, 54.2)


class OcrObservationPairingTest(unittest.TestCase):
    def test_pairs_by_pts_when_provider_skips_a_crop(self) -> None:
        metadata = [
            (0, {"x": 0.1}, 1.0),
            (1, {"x": 0.2}, 2.0),
            (2, {"x": 0.3}, 3.0),
        ]
        observations = [
            OcrObservationV1(pts=2.0, raw_text="câu 2", confidence=0.9),
            OcrObservationV1(pts=3.0, raw_text="câu 3", confidence=0.9),
        ]
        paired = BackgroundWorker._pair_ocr_observations(observations, metadata)
        self.assertEqual([cue_idx for _, cue_idx, _ in paired], [1, 2])
        self.assertEqual([obs.raw_text for obs, _, _ in paired], ["câu 2", "câu 3"])


class SingleVoiceMixTest(unittest.TestCase):
    def test_single_mode_preserves_full_sentence_when_audio_exceeds_next_slot(self) -> None:
        """A long narrator cue is shifted, never hard-trimmed into the next cue."""
        sample_rate = 1000
        first = np.full(900, 0.2, dtype=np.float32)
        second = np.full(100, 0.4, dtype=np.float32)
        master = np.zeros(2000, dtype=np.float32)
        master = mix_voice_pcm(master, first, 0, mode="single", next_start_sample=None)
        master = mix_voice_pcm(master, second, 900, mode="single", next_start_sample=None)
        # The first 900 samples must remain; the second starts after it.
        self.assertGreaterEqual(len(master), 1000)
        self.assertAlmostEqual(float(master[800]), 0.2, places=3)
        self.assertAlmostEqual(float(master[900]), 0.4, places=3)
    def test_available_slot_uses_next_start_in_single_mode(self) -> None:
        current = SubtitleCueV1(cue_id="a", start_pts=0.0, end_pts=1.12, source_text="một")
        nxt = SubtitleCueV1(cue_id="b", start_pts=1.00, end_pts=2.12, source_text="hai")
        self.assertAlmostEqual(available_voiceover_slot(current, nxt, "single"), 1.00)
        self.assertAlmostEqual(available_voiceover_slot(current, nxt, "multi"), 1.12)

    def test_fade_trim_shortens_pcm_with_tail_fade(self) -> None:
        pcm = np.ones(44100, dtype=np.float32)
        trimmed = fade_trim_pcm(pcm, 22050, fade_ms=20.0, sample_rate=44100)
        self.assertEqual(len(trimmed), 22050)
        self.assertLess(float(trimmed[-1]), 0.05)

    def test_single_mode_does_not_sum_overlapping_tails(self) -> None:
        sample_rate = 44100
        master = np.zeros(sample_rate * 3, dtype=np.float32)
        first = np.full(int(sample_rate * 1.10), 0.4, dtype=np.float32)
        second = np.full(int(sample_rate * 1.00), 0.4, dtype=np.float32)
        master = mix_voice_pcm(
            master,
            first,
            0,
            mode="single",
            next_start_sample=sample_rate,
        )
        master = mix_voice_pcm(
            master,
            second,
            sample_rate,
            mode="single",
            next_start_sample=sample_rate * 2,
        )
        overlap = master[sample_rate - 1000 : sample_rate]
        after = master[sample_rate : sample_rate + 1000]
        self.assertLess(float(np.max(np.abs(overlap))), 0.45)
        self.assertGreater(float(np.max(np.abs(after))), 0.30)

    def test_generate_timed_voiceover_single_mode_avoids_overlap_mix(self) -> None:
        from unittest.mock import AsyncMock, patch

        sample_rate = 44100
        synth_duration = 1.10
        t = np.linspace(0, synth_duration, int(sample_rate * synth_duration), endpoint=False, dtype=np.float32)
        dummy_pcm = np.full_like(t, 0.4, dtype=np.float32)
        temp_mp3 = Path("temp_t24_overlap_synth.mp3")
        _encode_pcm_to_mp3(dummy_pcm, temp_mp3, sample_rate=sample_rate)
        dummy_mp3_bytes = temp_mp3.read_bytes()
        temp_mp3.unlink(missing_ok=True)

        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.12, translated_text="Câu một"),
            SubtitleCueV1(cue_id="c2", start_pts=1.00, end_pts=2.12, translated_text="Câu hai"),
        ]
        out_voiceover = Path("test_t24_timed_voiceover.mp3")
        try:
            with patch("subtitle_localizer.dubbing.tts.synthesize_text", new_callable=AsyncMock) as mock_synth:
                mock_synth.return_value = dummy_mp3_bytes
                out_path = generate_voiceover_sync(
                    cues=cues,
                    output_path=out_voiceover,
                    total_duration=3.0,
                    max_stretch_rate=1.45,
                    mode="single",
                )
                pcm = _decode_mp3_to_pcm(out_path.read_bytes(), sample_rate=sample_rate)
                boundary = sample_rate
                overlap_window = pcm[max(0, boundary - 800) : boundary]
                self.assertLess(float(np.max(np.abs(overlap_window))), 0.70)
        finally:
            if out_voiceover.exists():
                out_voiceover.unlink(missing_ok=True)


class TimelineSingleLaneContractTest(unittest.TestCase):
    def test_bottom_timeline_uses_capcut_padding_tolerance_and_single_lane(self) -> None:
        timeline_file = REPOSITORY_ROOT / "web" / "src" / "components" / "timeline" / "BottomTimeline.tsx"
        content = timeline_file.read_text(encoding="utf-8")
        self.assertIn("dubbingMode?: 'single' | 'multi'", content)
        self.assertRegex(content, r"cue\.start_pts \+ 0\.2[0-9]")
        self.assertIn("dubbingMode !== 'multi'", content)
        self.assertIn("maxLanes = 1", content)

    def test_app_passes_dubbing_mode_to_timeline(self) -> None:
        app_file = REPOSITORY_ROOT / "web" / "src" / "App.tsx"
        content = app_file.read_text(encoding="utf-8")
        self.assertIn("dubbingMode=", content)


if __name__ == "__main__":
    unittest.main()
