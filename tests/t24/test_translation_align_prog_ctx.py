import sys
import unittest
from pathlib import Path
from unittest.mock import patch

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.reconstruction.builder import normalize_sequential_cues
from subtitle_localizer.reconstruction.consensus import (
    calculate_text_similarity,
    is_progressive_text_growth,
)
from subtitle_localizer.translation.real import RealTranslationProvider


class ProgressiveShortAndContinuationTest(unittest.TestCase):
    def test_short_typewriter_prefix_merges(self) -> None:
        self.assertTrue(is_progressive_text_growth("不是", "不是一个"))
        self.assertTrue(is_progressive_text_growth("不是一个", "不是一个地方"))
        self.assertFalse(is_progressive_text_growth("去找", "还有哪里可以让他去找"))
        self.assertTrue(
            is_progressive_text_growth("还有哪里可以让他", "还有哪里可以让他去找")
        )

    def test_shared_core_boundary_continuation_merges(self) -> None:
        self.assertTrue(
            is_progressive_text_growth(
                "这是这份保护工作需要面对的内容",
                "需要面对的内容实在过于特殊",
            )
        )

    def test_short_mid_containment_dialogue_still_separate(self) -> None:
        self.assertFalse(is_progressive_text_growth("回戏班", "让我回戏班吧"))
        self.assertEqual(calculate_text_similarity("回戏班", "让我回戏班吧"), 0.0)
        # Suffix/prefix quá ngắn không được nuốt thoại khác.
        self.assertFalse(is_progressive_text_growth("吧", "让我回戏班吧"))
        self.assertFalse(is_progressive_text_growth("不是", "是不是"))
        self.assertFalse(is_progressive_text_growth("去", "我去"))

    def test_normalize_merges_shared_core_continuation(self) -> None:
        cues = [
            SubtitleCueV1(
                cue_id="79",
                start_pts=167.94,
                end_pts=170.46,
                source_text="这是这份保护工作需要面对的内容",
                translated_text="Cong viec bao ve nay phai doi mat voi noi dung dac biet",
            ),
            SubtitleCueV1(
                cue_id="80",
                start_pts=170.90,
                end_pts=171.62,
                source_text="需要面对的内容实在过于特殊",
                translated_text="Noi dung nay thuc su qua dac biet",
            ),
        ]
        merged = normalize_sequential_cues(cues)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].source_text, "这是这份保护工作需要面对的内容实在过于特殊")
        self.assertIn("merged_progressive", merged[0].quality_flags)

    def test_normalize_merges_short_typewriter_chain(self) -> None:
        cues = [
            SubtitleCueV1(cue_id="1", start_pts=1.0, end_pts=1.2, source_text="不是", translated_text="Khong phai"),
            SubtitleCueV1(cue_id="2", start_pts=1.2, end_pts=1.5, source_text="不是一个", translated_text="Khong phai mot"),
            SubtitleCueV1(
                cue_id="3",
                start_pts=1.5,
                end_pts=2.0,
                source_text="不是一个地方让他去找",
                translated_text="Khong phai mot noi de anh ay di tim",
            ),
        ]
        merged = normalize_sequential_cues(cues)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].source_text, "不是一个地方让他去找")
        self.assertIn("merged_progressive", merged[0].quality_flags)

    def test_normalize_gap_allows_progressive_up_to_reconstructor_default(self) -> None:
        cues = [
            SubtitleCueV1(
                cue_id="a",
                start_pts=1.0,
                end_pts=1.2,
                source_text="不是一个地方",
                translated_text="Khong phai mot noi",
            ),
            SubtitleCueV1(
                cue_id="b",
                start_pts=2.0,  # gap 0.8s — old normalize max_merge_gap=0.50 would miss
                end_pts=2.5,
                source_text="不是一个地方让他去找",
                translated_text="Khong phai mot noi de anh ay di tim",
            ),
        ]
        merged = normalize_sequential_cues(cues)
        self.assertEqual(len(merged), 1)
        self.assertIn("merged_progressive", merged[0].quality_flags)


class TranslationAlignRepairTest(unittest.TestCase):
    def test_rejects_source_echo_and_cjk_residue(self) -> None:
        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="这里专门负责审核网络内容"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="韩组长安排三组的姜代理负责带丹菲"),
            SubtitleCueV1(cue_id="c3", start_pts=2.0, end_pts=3.0, source_text="姜代理瞬间来了精神"),
        ]
        response = (
            "[1] Hàn trưởng nhóm giao cho姜代理负责带丹菲。\n"
            "[2] 姜代理瞬间来了精神。\n"
            "[3] Đại lý Khương lập tức hứng khởi"
        )
        updated = provider._apply_model_response(cues, [0, 1, 2], response)
        self.assertEqual(cues[0].translated_text, "")
        self.assertEqual(cues[1].translated_text, "")
        self.assertEqual(cues[2].translated_text, "Đại lý Khương lập tức hứng khởi")
        self.assertEqual(updated, 1)

    def test_echo_cascade_keeps_trailing_good_for_retry_holes(self) -> None:
        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="可就在几小时以前"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="他还在认真写辞职报告"),
            SubtitleCueV1(cue_id="c3", start_pts=2.0, end_pts=3.0, source_text="只因入职六年"),
        ]
        response = (
            "[1] 他还在认真写辞职报告\n"
            "[2] 只因入职六年\n"
            "[3] Chỉ vì vào làm sáu năm"
        )
        provider._apply_model_response(cues, [0, 1, 2], response)
        self.assertEqual(cues[0].translated_text, "")
        self.assertEqual(cues[1].translated_text, "")
        self.assertEqual(cues[2].translated_text, "Chỉ vì vào làm sáu năm")
        self.assertEqual(provider.list_untranslated_indices(cues), [0, 1])

    def test_list_untranslated_includes_cjk_residue_and_empty(self) -> None:
        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="a", start_pts=0, end_pts=1, source_text="你好", translated_text=""),
            SubtitleCueV1(cue_id="b", start_pts=1, end_pts=2, source_text="再见", translated_text="再见"),
            SubtitleCueV1(cue_id="c", start_pts=2, end_pts=3, source_text="谢谢", translated_text="姜代理来了精神"),
            SubtitleCueV1(cue_id="d", start_pts=3, end_pts=4, source_text="早上", translated_text="Xin chào"),
        ]
        idxs = provider.list_untranslated_indices(cues)
        self.assertEqual(idxs, [0, 1, 2])

    def test_retry_untranslated_fills_holes(self) -> None:
        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="a", start_pts=0, end_pts=1, source_text="你好", translated_text=""),
            SubtitleCueV1(cue_id="b", start_pts=1, end_pts=2, source_text="再见", translated_text="Tạm biệt"),
            SubtitleCueV1(cue_id="c", start_pts=2, end_pts=3, source_text="谢谢", translated_text=""),
        ]

        def fake_batch(batch_items, chunk_indices, **kwargs):
            mapping = {0: "Xin chào", 2: "Cảm ơn"}
            for idx in chunk_indices:
                if idx in mapping:
                    cues[idx].translated_text = mapping[idx]
            return True

        with patch.object(provider, "_translate_batch_with_context", side_effect=fake_batch):
            filled = provider.retry_untranslated_cues(cues, source_lang="zh", target_lang="vi")
        self.assertEqual(filled, 2)
        self.assertEqual(cues[0].translated_text, "Xin chào")
        self.assertEqual(cues[2].translated_text, "Cảm ơn")


    def test_retry_clears_leak_against_good_neighbor_outside_chunk(self) -> None:
        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(
                cue_id="a",
                start_pts=0,
                end_pts=1,
                source_text="这里专门负责审核网络内容",
                translated_text="Hàn trưởng nhóm giao cho姜代理负责带丹菲",
            ),
            SubtitleCueV1(
                cue_id="b",
                start_pts=1,
                end_pts=2,
                source_text="韩组长安排三组的姜代理负责带丹菲",
                translated_text="Trưởng nhóm Hàn giao việc cho đại lý Khương dẫn Đan Phi",
            ),
        ]
        self.assertEqual(provider.list_untranslated_indices(cues), [0])

        def fake_batch(batch_items, chunk_indices, **kwargs):
            for idx in chunk_indices:
                cues[idx].translated_text = "Văn phòng này chuyên kiểm duyệt nội dung mạng"
            return True

        with patch.object(provider, "_translate_batch_with_context", side_effect=fake_batch):
            filled = provider.retry_untranslated_cues(cues, source_lang="zh", target_lang="vi")
        self.assertEqual(filled, 1)
        self.assertEqual(cues[0].translated_text, "Văn phòng này chuyên kiểm duyệt nội dung mạng")


class TranslationRollingContextTest(unittest.TestCase):
    def test_prompt_uses_chunk_label_and_prior_context(self) -> None:
        provider = RealTranslationProvider()
        batch_items = ["[1] 你好", "[2] 再见"]
        prior = ["[P1] 早上好 => Chào buổi sáng", "[P2] 晚安 => Chúc ngủ ngon"]
        prompt = provider._build_narrative_prompt(
            batch_items,
            "zh",
            "vi",
            "dramatic",
            prior_context_lines=prior,
            batch_ordinal=2,
            batch_total=3,
        )
        self.assertIn("ĐOẠN KỊCH BẢN", prompt)
        self.assertNotIn("KỊCH BẢN GỐC TOÀN BỘ CÂU CHUYỆN", prompt)
        self.assertIn("NGỮ CẢNH ĐÃ DỊCH", prompt)
        self.assertIn("Chào buổi sáng", prompt)
        self.assertIn("batch 2/3", prompt)

    def test_prompt_without_prior_still_avoids_full_story_claim_for_partial(self) -> None:
        provider = RealTranslationProvider()
        prompt = provider._build_narrative_prompt(
            ["[1] 你好"],
            "zh",
            "vi",
            "dramatic",
            prior_context_lines=None,
            batch_ordinal=1,
            batch_total=2,
        )
        self.assertIn("ĐOẠN KỊCH BẢN", prompt)
        self.assertNotIn("KỊCH BẢN GỐC TOÀN BỘ CÂU CHUYỆN", prompt)

    def test_single_batch_may_use_full_script_wording(self) -> None:
        provider = RealTranslationProvider()
        prompt = provider._build_narrative_prompt(
            ["[1] 你好", "[2] 再见"],
            "zh",
            "vi",
            "dramatic",
            prior_context_lines=None,
            batch_ordinal=1,
            batch_total=1,
        )
        self.assertIn("KỊCH BẢN GỐC TOÀN BỘ CÂU CHUYỆN", prompt)


class RetryAfterNormalizeTest(unittest.TestCase):
    """worker.py swaps cue objects (normalize_sequential_cues) before retrying."""

    def test_retry_writes_into_live_cue_objects_after_normalize(self) -> None:
        import dataclasses
        import json
        from unittest.mock import MagicMock

        from subtitle_localizer.translation.key_pool import GeminiKeyPool

        provider = RealTranslationProvider()
        pool = GeminiKeyPool(["key_mock"])
        cues = [
            SubtitleCueV1(cue_id="a", start_pts=0.0, end_pts=1.0, source_text="你好"),
            SubtitleCueV1(cue_id="b", start_pts=1.0, end_pts=2.0, source_text="再见"),
        ]
        calls = {"n": 0}

        def fake_urlopen(request, *args, **kwargs):
            text = "[1] Xin chào" if calls["n"] == 0 else "[1] Tạm biệt"
            calls["n"] += 1
            response = MagicMock()
            response.status = 200
            response.read.return_value = json.dumps(
                {"candidates": [{"content": {"parts": [{"text": text}]}}]}
            ).encode("utf-8")
            response.__enter__.return_value = response
            return response

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            provider._translate_with_gemini(cues, "zh", "vi", key_pool=pool)

        # Production replaces the cue list with fresh objects before the retry pass.
        normalized = normalize_sequential_cues(cues)
        self.assertTrue(normalized[1].source_text.strip())

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            filled = provider.retry_untranslated_cues(normalized, source_lang="zh", target_lang="vi")

        self.assertGreaterEqual(filled, 1)
        self.assertEqual(normalized[1].translated_text, "Tạm biệt")


if __name__ == "__main__":
    unittest.main()
