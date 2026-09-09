import sys
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import OcrObservationV1, SubtitleCueV1
from subtitle_localizer.fusion.consensus import (
    compute_temporal_iou,
    resolve_text_conflict,
    clean_speech_fillers,
)
try:
    from subtitle_localizer.fusion.hybrid_engine import LocalHybridFusionEngine
except ImportError:
    LocalHybridFusionEngine = None


@unittest.skipUnless(LocalHybridFusionEngine is not None, "Hybrid/Whisper provider retired")
class LocalHybridFusionTest(unittest.TestCase):
    def test_compute_temporal_iou(self) -> None:
        # Trường hợp giao nhau 50%
        iou = compute_temporal_iou(1.0, 3.0, 2.0, 4.0)
        # Giao: [2.0, 3.0] = 1.0; Hợp: [1.0, 4.0] = 3.0; IoU = 1/3 ~ 0.333
        self.assertAlmostEqual(iou, 1.0 / 3.0, places=2)

        # Trường hợp không giao nhau
        iou_zero = compute_temporal_iou(1.0, 2.0, 3.0, 4.0)
        self.assertEqual(iou_zero, 0.0)

        # Trường hợp bao trọn
        iou_inside = compute_temporal_iou(1.0, 4.0, 2.0, 3.0)
        # Giao: [2.0, 3.0] = 1.0; Hợp: [1.0, 4.0] = 3.0; IoU = 1/3
        self.assertAlmostEqual(iou_inside, 1.0 / 3.0, places=2)

    def test_resolve_text_conflict_chinese_homophones(self) -> None:
        # Trường hợp 1: Từ đồng âm tiếng Trung (Homophone)
        # OCR nhận diện đúng chữ '座' (tòa nhà / chỗ ngồi), Whisper nghe ra '坐' (ngồi)
        # Cả 2 cùng phát âm 'zuò', OCR có độ tin cậy tốt -> Ưu tiên giữ chữ OCR
        resolved = resolve_text_conflict(
            ocr_text="这是一座大楼",
            asr_text="这是一坐大楼",
            ocr_conf=0.88,
            lang="zh",
        )
        self.assertEqual(resolved, "这是一座大楼")

    def test_resolve_text_conflict_chinese_visual_confusion(self) -> None:
        # Trường hợp 2: Chữ hình cận (Visually Confusable Glyphs) do OCR bị mờ
        # Diễn viên nói '已经' (yǐ jīng - đã), nhưng OCR mờ nhận nhầm nét thành '己经' (jǐ jīng - kỷ)
        # Điểm conf OCR thấp (< 0.70) -> Ưu tiên mượn âm chuẩn của ASR
        resolved = resolve_text_conflict(
            ocr_text="我己经知道了",
            asr_text="我已经知道了",
            ocr_conf=0.62,
            lang="zh",
        )
        self.assertEqual(resolved, "我已经知道了")

    def test_clean_speech_fillers_english(self) -> None:
        # Loại bỏ thán từ đệm trong tiếng Anh
        raw = "Um, you know, we are going to, uh, start right now."
        cleaned = clean_speech_fillers(raw, lang="en")
        self.assertEqual(cleaned, "we are going to start right now.")

    def test_hybrid_engine_missing_subtitle_rescue(self) -> None:
        # Kiểm tra tính năng cứu phụ đề bị sót:
        # OCR chỉ bắt được câu ở 1.0 -> 2.5s
        # VAD & Audio phát hiện nhân vật nói thêm một câu ở 4.0 -> 6.0s
        engine = LocalHybridFusionEngine()
        existing_cues = [
            SubtitleCueV1(cue_id="c1", start_pts=1.0, end_pts=2.5, source_text="First line"),
        ]
        audio_segments = [
            {"start": 1.1, "end": 2.4, "text": "First line", "conf": 0.95},
            {"start": 4.0, "end": 5.8, "text": "Rescued second line", "conf": 0.92},
        ]
        merged_cues = engine.fuse_cues_with_audio(existing_cues, audio_segments, lang="en")
        self.assertEqual(len(merged_cues), 2)
        self.assertEqual(merged_cues[0].source_text, "First line")
        self.assertEqual(merged_cues[1].source_text, "Rescued second line")
        self.assertIn("rescued_by_audio", merged_cues[1].quality_flags)

    def test_ocr_preprocessing_advanced_clahe_and_unsharp(self) -> None:
        import numpy as np
        from subtitle_localizer.ocr.preprocessing import build_ocr_candidates

        crop = np.full((32, 64, 3), 120, dtype=np.uint8)
        # Default returns 4 candidates
        candidates_default = build_ocr_candidates(crop, include_advanced=False)
        self.assertEqual(len(candidates_default), 4)

        # Advanced returns 6 candidates (including CLAHE and Unsharp Mask)
        candidates_adv = build_ocr_candidates(crop, include_advanced=True)
        self.assertEqual(len(candidates_adv), 6)
        # Check that CLAHE (idx 4) and Unsharp Mask (idx 5) have valid shapes
        self.assertEqual(candidates_adv[4].shape, (32, 64))
        self.assertEqual(candidates_adv[5].shape, (32, 64))

    def test_hybrid_engine_high_quality_defaults(self) -> None:
        engine = LocalHybridFusionEngine()
        self.assertEqual(engine.whisper_model_size, "small")
        self.assertEqual(engine.device, "cuda")
        self.assertEqual(engine.compute_type, "float16")


if __name__ == "__main__":
    unittest.main()
