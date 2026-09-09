import cv2
import numpy as np

from subtitle_localizer.ocr.anti_noise import AntiNoiseFunnel


def test_geometry_rejects_narrow_or_oversized_candidates() -> None:
    funnel = AntiNoiseFunnel(ar_min=0.88, h_max=130)
    assert not funnel.check_geometry(86, 100)
    assert not funnel.check_geometry(200, 131)
    assert funnel.check_geometry(100, 100)
    assert funnel.check_geometry(360, 100)


def test_luminance_gate_requires_bright_high_contrast_text() -> None:
    funnel = AntiNoiseFunnel(lum_min=135)
    bright = np.full((20, 100, 3), 20, dtype=np.uint8)
    cv2.rectangle(bright, (10, 5), (90, 15), (245, 245, 245), -1)
    dark = np.full((20, 100, 3), 40, dtype=np.uint8)
    assert funnel.check_subtitle_luminance(bright)
    assert not funnel.check_subtitle_luminance(dark)


def test_stroke_hash_is_stable_for_same_mask_and_hamming_is_bounded() -> None:
    funnel = AntiNoiseFunnel()
    crop = np.zeros((32, 128, 3), dtype=np.uint8)
    cv2.putText(crop, "你好", (3, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 1)
    first = funnel.compute_stroke_mask_dhash(crop)
    second = funnel.compute_stroke_mask_dhash(crop.copy())
    assert first == second
    assert funnel.hamming_distance(first, second) == 0


def test_invalid_candidate_reports_reason() -> None:
    funnel = AntiNoiseFunnel()
    crop = np.zeros((10, 10, 3), dtype=np.uint8)
    valid, reason = funnel.is_valid_candidate(crop, 10, 140)
    assert not valid
    assert reason == "geometry_rejected"
