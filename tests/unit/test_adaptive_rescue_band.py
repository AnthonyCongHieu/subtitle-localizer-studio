import cv2
import numpy as np

from subtitle_localizer.domain.models import OcrObservationV1
from subtitle_localizer.ocr.anti_noise import AntiNoiseFilter
from subtitle_localizer.reconstruction.builder import CueReconstructor
from subtitle_localizer.service.pipeline_settings import ExtractionSettings
from subtitle_localizer.service.worker import BackgroundWorker


class _BandDetector:
    def __init__(self):
        self.engine = self
        self.calls = []

    def load(self):
        return None

    def __call__(self, image, **_kwargs):
        self.calls.append(image.copy())
        mask = cv2.inRange(image, (250, 250, 250), (255, 255, 255))
        points = cv2.findNonZero(mask)
        if points is None:
            return [], None
        x, y, w, h = cv2.boundingRect(points)
        return [[[x, y], [x + w - 1, y], [x + w - 1, y + h - 1], [x, y + h - 1]]], None


def _frame_with_text(y1, y2):
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    for x1 in range(40, 150, 20):
        cv2.rectangle(frame, (x1, y1), (x1 + 8, y2), (255, 255, 255), -1)
    return frame


def test_primary_text_does_not_open_mid_band():
    detector = _BandDetector()
    crops, pts, bands = BackgroundWorker._prepare_adaptive_rescue_inputs(
        [_frame_with_text(76, 88)],
        [1.25],
        detector,
        AntiNoiseFilter(swt_cov_max=10.0),
        (0.0, 0.70, 1.0, 0.25),
        0.35,
        0.30,
    )

    assert len(detector.calls) == 1
    assert len(crops) == 1
    assert pts == [1.25]
    assert bands == ["primary"]


def test_empty_primary_opens_mid_band_and_builds_dialogue():
    detector = _BandDetector()
    crops, pts, bands = BackgroundWorker._prepare_adaptive_rescue_inputs(
        [_frame_with_text(45, 57)],
        [2.0],
        detector,
        AntiNoiseFilter(swt_cov_max=10.0),
        (0.0, 0.70, 1.0, 0.25),
        0.35,
        0.30,
    )

    assert len(detector.calls) == 2
    assert len(crops) == 1
    assert pts == [2.0]
    assert bands == ["mid_rescued"]

    observation = OcrObservationV1(
        pts=pts[0],
        raw_text="Đây là câu thoại được cứu",
        normalized_text="Đây là câu thoại được cứu",
        confidence=0.98,
        preprocessing_metadata={"band": bands[0]},
    )
    cues = CueReconstructor(min_cue_duration=0.20).build_cues([observation])

    assert [cue.source_text for cue in cues] == ["Đây là câu thoại được cứu"]
    assert observation.preprocessing_metadata["band"] == "mid_rescued"


def test_adaptive_rescue_settings_default_to_enabled():
    settings = ExtractionSettings()
    assert settings.enable_adaptive_rescue is True
    assert settings.adaptive_rescue_mid_y == 0.35
    assert settings.adaptive_rescue_mid_h == 0.30
