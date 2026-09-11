import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import OcrObservationV1, SubtitleCueV1
from subtitle_localizer.reconstruction.builder import CueReconstructor, normalize_sequential_cues
from subtitle_localizer.reconstruction.consensus import (
    calculate_text_similarity,
    is_progressive_text_growth,
)
from subtitle_localizer.translation.real import RealTranslationProvider


class ProgressiveHardsubMergeTest(unittest.TestCase):
    def test_detects_test1_progressive_pairs_but_not_short_dialogue(self) -> None:
        self.assertTrue(
            is_progressive_text_growth(
                "单飞碰见一位在办公楼前",
                "丹菲碰见一位在办公楼前抗议的大叔",
            )
        )
        self.assertTrue(
            is_progressive_text_growth(
                "不过组长给他画了个大饼",
                "组长给他画了个大饼只要成功留下",
            )
        )
        self.assertFalse(is_progressive_text_growth("回戏班", "让我回戏班吧"))
        self.assertEqual(calculate_text_similarity("回戏班", "让我回戏班吧"), 0.0)

    def test_normalize_merges_half_plus_full_and_clears_shifted_echo(self) -> None:
        cues = [
            SubtitleCueV1(
                cue_id="110",
                start_pts=225.76,
                end_pts=227.84,
                source_text="单飞碰见一位在办公楼前",
                translated_text="丹菲碰见一位在办公楼前抗议的大叔",
            ),
            SubtitleCueV1(
                cue_id="111",
                start_pts=227.84,
                end_pts=229.10,
                source_text="丹菲碰见一位在办公楼前抗议的大叔",
                translated_text="要求保护创作自由",
            ),
            SubtitleCueV1(
                cue_id="112",
                start_pts=229.20,
                end_pts=231.84,
                source_text="要求保护创作自由",
                translated_text="Yeu cau bao ve tu do sang tao",
            ),
        ]
        merged = normalize_sequential_cues(cues)
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0].source_text, "丹菲碰见一位在办公楼前抗议的大叔")
        self.assertEqual(merged[0].translated_text, "")
        self.assertIn("merged_progressive", merged[0].quality_flags)
        self.assertEqual(merged[1].source_text, "要求保护创作自由")
        self.assertEqual(merged[1].translated_text, "Yeu cau bao ve tu do sang tao")

    def test_normalize_merges_shared_core_progressive_pair(self) -> None:
        cues = [
            SubtitleCueV1(
                cue_id="57",
                start_pts=121.40,
                end_pts=121.76,
                source_text="不过组长给他画了个大饼",
                translated_text="不过组长给他画了个大饼。",
            ),
            SubtitleCueV1(
                cue_id="58",
                start_pts=121.76,
                end_pts=124.20,
                source_text="组长给他画了个大饼只要成功留下",
                translated_text="只要成功留下，",
            ),
        ]
        merged = normalize_sequential_cues(cues)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].source_text, "组长给他画了个大饼只要成功留下")
        self.assertIn("merged_progressive", merged[0].quality_flags)

    def test_build_cues_merges_progressive_ocr_frames(self) -> None:
        reconstructor = CueReconstructor(
            min_cue_duration=0.2,
            max_merge_gap=1.0,
            similarity_threshold=0.78,
        )
        observations = [
            OcrObservationV1(pts=1.0, raw_text="单飞碰见一位在办公楼前", confidence=0.90),
            OcrObservationV1(pts=1.2, raw_text="单飞碰见一位在办公楼前", confidence=0.91),
            OcrObservationV1(pts=1.4, raw_text="丹菲碰见一位在办公楼前抗议的大叔", confidence=0.95),
            OcrObservationV1(pts=1.8, raw_text="丹菲碰见一位在办公楼前抗议的大叔", confidence=0.96),
        ]
        cues = reconstructor.build_cues(observations)
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0].source_text, "丹菲碰见一位在办公楼前抗议的大叔")


class TranslationAlignmentGuardTest(unittest.TestCase):
    def test_rejects_source_echo_shift_cascade(self) -> None:
        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="单飞碰见一位在办公楼前"),
            SubtitleCueV1(
                cue_id="c2",
                start_pts=1.0,
                end_pts=2.0,
                source_text="丹菲碰见一位在办公楼前抗议的大叔",
            ),
            SubtitleCueV1(cue_id="c3", start_pts=2.0, end_pts=3.0, source_text="要求保护创作自由"),
        ]
        response = (
            "[1] 丹菲碰见一位在办公楼前抗议的大叔\n"
            "[2] 要求保护创作自由\n"
            "[3] Yeu cau bao ve tu do sang tao"
        )
        updated = provider._apply_model_response(cues, [0, 1, 2], response)
        self.assertEqual(updated, 1)
        self.assertEqual(cues[0].translated_text, "")
        self.assertEqual(cues[1].translated_text, "")
        self.assertEqual(cues[2].translated_text, "Yeu cau bao ve tu do sang tao")

    def test_accepts_batch_local_1_based_markers(self) -> None:
        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="你好"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="再见"),
        ]
        updated = provider._apply_model_response(
            cues,
            [0, 1],
            "[1] [Nam] Xin chao\n[2] [Nu] Tam biet",
        )
        self.assertEqual(updated, 2)
        self.assertEqual(cues[0].translated_text, "Xin chao")
        self.assertEqual(cues[1].translated_text, "Tam biet")


if __name__ == "__main__":
    unittest.main()
