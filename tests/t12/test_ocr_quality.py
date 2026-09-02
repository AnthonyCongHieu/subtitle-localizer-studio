import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from subtitle_localizer.ocr.rapid import RapidOcrProvider
from subtitle_localizer.domain.models import OcrObservationV1
from subtitle_localizer.reconstruction.builder import CueReconstructor


BOX = [[20, 10], [100, 10], [100, 40], [20, 40]]


class CandidateEngine:
    """Replace expensive inference only; exercise real provider selection."""

    def __init__(self, detections, rereads=None):
        self.detections = iter(detections)
        self.rereads = iter(rereads or [None, None, None])

    def __call__(self, image, use_det=True, use_cls=True):
        if not use_det:
            assert use_cls is False
            return next(self.rereads), 0.01
        return next(self.detections), 0.01


def recognize(engine):
    provider = RapidOcrProvider()
    provider.is_loaded = True
    provider.engine = engine
    return provider.recognize([np.zeros((60, 140, 3), dtype=np.uint8)], [2.5], "zh")


@pytest.mark.parametrize("text", ["6x6=36,", "6X7=42,", "6×8=48...", "6*9=54", "第6趟车"])
def test_chinese_filter_preserves_math_and_chinese(text):
    result = recognize(CandidateEngine([[[BOX, text, .98]]] * 3))
    assert result[0].raw_text == text


@pytest.mark.parametrize("text", ["Based on a true story", "x train 36", "6x6 trailer", "x"])
def test_chinese_filter_still_rejects_english(text):
    assert recognize(CandidateEngine([[[BOX, text, .99]]] * 3)) == []


def test_reread_preserves_verified_leading_character_despite_high_detector_score():
    result = recognize(CandidateEngine(
        [[[BOX, "般跑六天。", .999457]], [[BOX, "般跑六天。", .998967]],
         [[BOX, "一般跑六天。", .997702]]],
        [[["一般跑六天。", .941483]], [["-般跑六天。", .917049]],
         [["一般跑六天。", .999745]]],
    ))
    assert result[0].raw_text == "一般跑六天。"
    assert result[0].preprocessing_metadata["candidate_disagreement"] is True


def test_reread_recovers_one_low_contrast_han_character_on_all_candidates():
    result = recognize(CandidateEngine(
        [[[BOX, "般跑六天。", .999]]] * 3,
        [[["一般跑六天。", .948]]] * 3,
    ))
    assert result[0].raw_text == "一般跑六天。"


def test_verified_han_edge_beats_higher_confidence_truncated_candidate():
    result = recognize(CandidateEngine(
        [[[BOX, "般跑六天。", .999]], [[BOX, "般跑六天。", .999]],
         [[BOX, "般跑六天。", .998]]],
        [None, None, [["一般跑六天。", .948]]],
    ))
    assert result[0].raw_text == "一般跑六天。"


def test_low_confidence_detector_edge_cannot_override_high_confidence_text():
    result = recognize(CandidateEngine(
        [[[BOX, "般跑六天。", .999]], [[BOX, "般跑六天。", .999]],
         [[BOX, "一般跑六天。", .40]]],
    ))
    assert result[0].raw_text == "般跑六天。"


def test_padded_source_reread_recovers_trailing_punctuation():
    result = recognize(CandidateEngine(
        [[[BOX, "前几天我妹突然跟我说", .997]]] * 3,
        [[["前几天我妹突然跟我说，", .996]]] * 3,
    ))
    assert result[0].raw_text == "前几天我妹突然跟我说，"
    assert result[0].boxes == [[12.0, 8.0, 108.0, 42.0]]


@pytest.mark.parametrize("reread,score", [
    ("完全不同的句子", .999), ("广告字幕前几天我妹突然跟我说", .999),
    ("前几天我妹突然跟我说，", .60), ("前几天我妹突然跟我", .999),
])
def test_reread_cannot_replace_interior_delete_text_or_add_untrusted_context(reread, score):
    result = recognize(CandidateEngine(
        [[[BOX, "前几天我妹突然跟我说", .997]]] * 3,
        [[[reread, score]]] * 3,
    ))
    assert result[0].raw_text == "前几天我妹突然跟我说"


def test_observation_preserves_real_detection_box_when_no_reread():
    result = recognize(CandidateEngine([[[BOX, "字幕", .98]]] * 3))
    assert result[0].boxes == [[20.0, 10.0, 100.0, 40.0]]


def test_reconstruction_does_not_merge_different_multiplication_subtitles():
    observations = [OcrObservationV1(pts=t, raw_text=text, confidence=.98)
                    for t, text in [(1., "6x6=36,"), (1.5, "6x6=36,"),
                                    (2., "6x7=42,"), (2.5, "6x7=42,")]]
    cues = CueReconstructor().build_cues(observations)
    assert [cue.source_text for cue in cues] == ["6x6=36,", "6x7=42,"]


def test_candidate_disagreement_survives_as_cue_review_flag():
    observations = [OcrObservationV1(
        pts=t, raw_text="字幕", confidence=.99,
        preprocessing_metadata={"candidate_disagreement": t == 1.},
    ) for t in [1., 1.5]]
    cues = CueReconstructor().build_cues(observations)
    assert "ocr_candidate_disagreement" in cues[0].quality_flags
