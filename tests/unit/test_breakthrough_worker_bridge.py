import cv2
import numpy as np

from subtitle_localizer.ocr.anti_noise import AntiNoiseFunnel
from subtitle_localizer.service.pipeline_settings import ExtractionSettings
from subtitle_localizer.service.worker import BackgroundWorker


class _Detector:
    def __init__(self):
        self.engine = self

    def load(self):
        return None

    def unload(self):
        return None

    def __call__(self, image, **_kwargs):
        h, w = image.shape[:2]
        return [[[0, 0], [w, 0], [w, h], [0, h]]], None


class _DetectorWithMetadata(_Detector):
    def __call__(self, image, **_kwargs):
        h, w = image.shape[:2]
        return [[[[0, 0], [w, 0], [w, h], [0, h]], "ignored", 0.99]], None


def test_settings_accept_breakthrough_fields_without_changing_legacy_defaults():
    settings = ExtractionSettings(
        engine="ppocrv5",
        primary_backend="ppocrv5",
        enable_nvdec_hwaccel=True,
        enable_anti_noise_funnel=True,
        recognition_batch_size=32,
    )
    assert settings.engine == "ppocrv5"
    assert settings.recognition_batch_size == 32
    assert ExtractionSettings().engine == "rapidocr"


def test_ppocr_bridge_extracts_tight_detector_boxes_and_preserves_pts():
    image = np.zeros((40, 120, 3), dtype=np.uint8)
    cv2.rectangle(image, (5, 5), (110, 30), (255, 255, 255), -1)
    crops, pts = BackgroundWorker._prepare_ppocrv5_inputs([image], [3.25], _Detector())
    assert len(crops) == 1
    assert crops[0].shape[:2] == (40, 120)
    assert pts == [3.25]


def test_ppocr_bridge_accepts_detector_results_with_metadata():
    image = np.zeros((20, 80, 3), dtype=np.uint8)
    crops, pts = BackgroundWorker._prepare_ppocrv5_inputs([image], [1.0], _DetectorWithMetadata())
    assert len(crops) == 1
    assert pts == [1.0]


def test_auto_backend_prefers_ppocrv5_mobile_for_hardware_tuning():
    assert BackgroundWorker._resolve_primary_backend("rapidocr", "auto", "mobile") == "ppocrv5-mobile"
    assert BackgroundWorker._resolve_primary_backend("rapidocr", "auto", "server") == "ppocrv5-server"
