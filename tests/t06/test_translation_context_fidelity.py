from __future__ import annotations

import unittest

from subtitle_localizer.domain.models import SubtitleCueV1


class TranslationContextFidelityTests(unittest.TestCase):
    def test_refine_fixes_common_calques_without_video_specific_names(self) -> None:
        from subtitle_localizer.translation.real import _refine_subtitles

        self.assertEqual(
            _refine_subtitles("Đó là vấn đề của tôi", "是我的问题"),
            "Lỗi là của tôi",
        )
        self.assertEqual(
            _refine_subtitles("Bạn sao rồi", "你怎么了"),
            "Bạn sao vậy?",
        )
        self.assertEqual(
            _refine_subtitles("Tôi làm không tốt", "是我做得不好"),
            "Là do tôi làm không tốt",
        )

    def test_refine_repairs_narration_idioms_seen_in_ocr_subtitles(self) -> None:
        from subtitle_localizer.translation.real import _refine_subtitles

        self.assertEqual(
            _refine_subtitles(
                "Hình Ảnh Phim Ảnh Đánh Giá là người kiểm duyệt phim ảnh nhiều năm",
                "影视鉴赏君男人是从业多年的影视审核员",
            ),
            "Người chuyên review phim là một kiểm duyệt viên phim ảnh nhiều năm kinh nghiệm",
        )
        self.assertEqual(
            _refine_subtitles(
                "Hàng ngày lăn lộn trong hàng loạt video đảo quốc",
                "常年泡在海量岛国视频里",
            ),
            "Suốt nhiều năm đắm mình trong vô số video Nhật Bản",
        )
        self.assertEqual(
            _refine_subtitles(
                "Đã lâu không còn cảm xúc",
                "早就把身体熬成了“挂机模式’",
            ),
            "Đã sớm vắt kiệt cơ thể đến mức rơi vào chế độ treo máy",
        )

    def test_refine_collapses_repeated_ellipsis_markers(self) -> None:
        from subtitle_localizer.translation.real import _refine_subtitles

        self.assertEqual(
            _refine_subtitles("Chờ tôi... ...……", "等我..."),
            "Chờ tôi...",
        )

    def test_refine_removes_model_ellipsis_when_ocr_has_none(self) -> None:
        from subtitle_localizer.translation.real import _refine_subtitles

        self.assertEqual(
            _refine_subtitles("...mà vô tình chữa khỏi bệnh...", "居然治好了隐疾"),
            "Mà vô tình chữa khỏi bệnh",
        )

    def test_addressing_polish_is_mode_driven_not_hardcoded_cast(self) -> None:
        from subtitle_localizer.translation.real import _polish_addressing

        self.assertEqual(
            _polish_addressing(
                "Bạn nói đúng",
                "您说得对",
                speaker_gender="female",
                addressing_mode="couple_anh_em",
            ),
            "Anh nói đúng",
        )
        self.assertEqual(
            _polish_addressing(
                "Bạn sao vậy?",
                "你怎么了",
                speaker_gender="male",
                addressing_mode="couple_anh_em",
            ),
            "Em sao vậy?",
        )
        self.assertEqual(
            _polish_addressing(
                "Bạn nói đúng",
                "您说得对",
                speaker_gender="female",
                addressing_mode="neutral",
            ),
            "Bạn nói đúng",
        )

    def test_prompt_injects_optional_character_context_and_fidelity_rules(self) -> None:
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        prompt = provider._build_narrative_prompt(
            batch_items=["[1] 您说得对"],
            source_lang="zh",
            target_lang="vi",
            prompt_tone="dramatic",
            addressing_mode="auto",
            character_context="Nữ chính nói với chồng/bạn trai; giữ anh-em.",
        )
        self.assertIn("Nữ chính nói với chồng/bạn trai", prompt)
        self.assertIn("bám sát ý gốc", prompt.lower())
        self.assertIn("không dịch word-by-word thô", prompt.lower())
        self.assertIn("CẤM dùng 'bạn'", prompt)
        self.assertIn("KHÓA NGÔN NGỮ", prompt)
        self.assertIn("CẤM English", prompt)

    def test_apply_model_response_applies_refine_and_couple_polish(self) -> None:
        from subtitle_localizer.service.pipeline_settings import (
            GlobalPipelineSettings,
            TranslationSettings,
            set_global_pipeline_settings,
        )
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="您说得对"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="是我的问题"),
        ]
        settings = GlobalPipelineSettings(
            translation=TranslationSettings(
                addressing_mode="couple_anh_em",
                character_context="",
                use_glossary=True,
            )
        )
        try:
            set_global_pipeline_settings(settings)
            updated = provider._apply_model_response(
                cues,
                [0, 1],
                "[1] [Nữ] Bạn nói đúng\n[2] [Nam] Đó là vấn đề của tôi",
            )
        finally:
            set_global_pipeline_settings(GlobalPipelineSettings())

        self.assertEqual(updated, 2)
        self.assertEqual(cues[0].translated_text, "Anh nói đúng")
        self.assertEqual(cues[0].style.get("speaker"), "female")
        self.assertEqual(cues[1].translated_text, "Lỗi là của tôi")
        self.assertEqual(cues[1].style.get("speaker"), "male")

    def test_apply_model_response_keeps_one_terminal_ellipsis(self) -> None:
        from subtitle_localizer.translation.real import RealTranslationProvider

        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="等我"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="我不知道"),
        ]
        updated = RealTranslationProvider()._apply_model_response(
            cues,
            [0, 1],
            "[1] [Nữ] Chờ tôi... ...……\n[2] [Nam] Tôi không biết......",
        )

        self.assertEqual(updated, 2)
        self.assertEqual(cues[0].translated_text, "Chờ tôi")
        self.assertEqual(cues[1].translated_text, "Tôi không biết")

    def test_rejects_english_drift_when_target_is_vietnamese(self) -> None:
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        self.assertTrue(
            provider._is_invalid_translation(
                "Decided to do his best to keep Dan Fei",
                "姜代理决定拼尽全力留住丹菲",
                target_lang="vi",
            )
        )
        cues = [
            SubtitleCueV1(cue_id="c1", start_pts=0.0, end_pts=1.0, source_text="请问这里没有女士吗", translated_text="Is there no lady here?"),
            SubtitleCueV1(cue_id="c2", start_pts=1.0, end_pts=2.0, source_text="你怎么了", translated_text="Em sao vậy?"),
        ]
        holes = provider.list_untranslated_indices(cues, target_lang="vi")
        self.assertEqual(holes, [0])

    def test_rejects_short_cjk_residue_in_vietnamese(self) -> None:
        from subtitle_localizer.translation.real import RealTranslationProvider

        provider = RealTranslationProvider()
        self.assertTrue(provider._is_invalid_translation("Một đồng nghiệp kéo dây耳机", "同事扯掉耳机线", target_lang="vi"))

    def test_translation_settings_defaults_are_video_agnostic(self) -> None:
        from subtitle_localizer.service.pipeline_settings import TranslationSettings

        settings = TranslationSettings()
        self.assertEqual(settings.addressing_mode, "auto")
        self.assertEqual(settings.character_context, "")


class TtsSpokenLanguageGuardTests(unittest.TestCase):
    def test_resolve_ignores_stale_cjk_spoken_text(self) -> None:
        from subtitle_localizer.dubbing.tts import resolve_tts_spoken_text

        cue = SubtitleCueV1(
            cue_id="c1",
            start_pts=0.0,
            end_pts=1.0,
            source_text="女人只是啃了一根老冰棍樣",
            translated_text="Chỉ ăn một cây kem cũ kỹ thôi",
            style={"spoken_text": "女 人 只 是 啃 了 一 根"},
        )
        self.assertEqual(resolve_tts_spoken_text(cue), "Chỉ ăn một cây kem cũ kỹ thôi")

    def test_adapt_refuses_cjk_input_for_vi_pipeline(self) -> None:
        from subtitle_localizer.dubbing.tts import adapt_spoken_text_for_slot

        spoken, meta = adapt_spoken_text_for_slot("女 人 只 是 啃 了 一 根", slot_sec=0.8)
        self.assertEqual(spoken, "")
        self.assertEqual(meta.get("timing_warning"), "hard")


if __name__ == "__main__":
    unittest.main()
