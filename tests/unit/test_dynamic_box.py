from __future__ import annotations

import numpy as np
import pytest

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.detector.dynamic_box import DynamicBoxDiscoverer


def test_similarity_calculation():
    discoverer = DynamicBoxDiscoverer()
    # Exact match
    assert discoverer._calculate_similarity("他们在一起", "他们在一起") == 1.0
    # Substring match
    assert discoverer._calculate_similarity("他们在一起已经有一段日子了", "他们在一起") == 1.0
    assert discoverer._calculate_similarity("他们在一起", "他们在一起已经有一段日子了") == 1.0
    # Partial match
    sim = discoverer._calculate_similarity("还不止次", "还不止一次")
    assert sim >= 0.75
    # Empty match
    assert discoverer._calculate_similarity("", "abc") == 0.0
    assert discoverer._calculate_similarity("abc", "") == 0.0


def test_discover_and_verify_cues_with_mock_engine(monkeypatch):
    discoverer = DynamicBoxDiscoverer()

    cues = [
        SubtitleCueV1(
            cue_id="c1",
            start_pts=10.0,
            end_pts=12.0,
            source_text="他们在一起已经有一段日子了",
            confidence=0.9,
        ),
        SubtitleCueV1(
            cue_id="c2",
            start_pts=14.0,
            end_pts=16.0,
            source_text="还不止次",
            confidence=0.8,
        ),
        SubtitleCueV1(
            cue_id="c3",
            start_pts=20.0,
            end_pts=22.0,
            source_text="[a的",
            confidence=0.4,
        ),
    ]

    # Mock cv2.VideoCapture
    class MockCap:
        def __init__(self, _path):
            self.opened = True
            self.pts_msec = 0.0

        def isOpened(self):
            return self.opened

        def set(self, prop, val):
            self.pts_msec = val

        def read(self):
            # Frame 1000x500
            frame = np.zeros((500, 1000, 3), dtype=np.uint8)
            return True, frame

        def release(self):
            self.opened = False

    monkeypatch.setattr("cv2.VideoCapture", MockCap)

    # Mock OCR engine
    class MockEngine:
        def __call__(self, frame):
            # For c1: text at mid-screen (y=240..270)
            # For c2: text at bottom (y=400..430) with corrected text "还不止一次"
            # For c3: no text
            return [
                (
                    [[100, 240], [800, 240], [800, 270], [100, 270]],
                    "他们在一起已经有一段日子了",
                    0.98,
                ),
                (
                    [[200, 400], [600, 400], [600, 430], [200, 430]],
                    "还不止一次",
                    0.96,
                ),
            ], None

    updated = discoverer.discover_and_verify_cues(
        video_path="dummy.mp4",
        cues=cues,
        detector_engine=MockEngine(),
    )

    assert len(updated) == 3

    # Check c1: mid-screen box
    c1 = updated[0]
    assert "box" in c1.style
    box1 = c1.style["box"]
    # y1=240/500=0.48, with pad 0.012 -> ~0.468
    assert 0.45 <= box1["y"] <= 0.48
    assert "box_discovered" in c1.quality_flags
    assert "optical_verified" in c1.quality_flags

    # Check c2: corrected text and optical verification
    c2 = updated[1]
    assert c2.source_text == "还不止一次"  # Corrected from "还不止次"
    assert "box_discovered" in c2.quality_flags
    assert "optical_verified" in c2.quality_flags

    # Check c3: low confidence and no visual match
    c3 = updated[2]
    # c3 does not match c1 or c2 text
    assert "audio_only_no_visual" in c3.quality_flags


def test_discover_and_verify_cues_with_base_roi_crop(monkeypatch):
    from subtitle_localizer.domain.models import RegionTrackV1

    discoverer = DynamicBoxDiscoverer()
    cue = SubtitleCueV1(
        cue_id="c1",
        start_pts=5.0,
        end_pts=7.0,
        source_text="你好世界",
        confidence=0.9,
    )

    class MockCap:
        def __init__(self, _path):
            self.opened = True

        def isOpened(self):
            return self.opened

        def set(self, prop, val):
            pass

        def read(self):
            frame = np.zeros((1000, 1000, 3), dtype=np.uint8)
            return True, frame

        def release(self):
            self.opened = False

    monkeypatch.setattr("cv2.VideoCapture", MockCap)

    # Frame is 1000x1000. base_roi is y=0.60..0.75 (y=600..750).
    # With pad_y=0.08, crop_y1=max(0, 600-80)=520, crop_y2=min(1000, 750+80)=830.
    # Crop height = 310.
    # Text in crop is at crop_y = 100..130 (which is frame y = 620..650).
    received_crop_shapes = []

    class CroppedMockEngine:
        def __call__(self, crop):
            received_crop_shapes.append(crop.shape)
            # Box inside crop coordinates: y=100..130, x=200..400
            return [
                (
                    [[200, 100], [400, 100], [400, 130], [200, 130]],
                    "你好世界",
                    0.99,
                ),
            ], None

    roi = RegionTrackV1(region_id="roi-main", x=0.05, y=0.60, width=0.90, height=0.15)
    updated = discoverer.discover_and_verify_cues(
        video_path="dummy.mp4",
        cues=[cue],
        base_roi=roi,
        detector_engine=CroppedMockEngine(),
    )

    assert len(received_crop_shapes) == 1
    # Crop shape height must be ~310, not 1000
    assert received_crop_shapes[0][0] < 500
    # Frame y was 520 + 100 = 620 -> norm_y = 0.620
    # With padding_y = 0.012, box y should be ~0.608
    box = updated[0].style["box"]
    assert 0.60 <= box["y"] <= 0.62
    assert "optical_verified" in updated[0].quality_flags


def test_discover_and_verify_cues_shifted_subtitle_tier2_fallback(monkeypatch):
    from subtitle_localizer.domain.models import RegionTrackV1

    discoverer = DynamicBoxDiscoverer()
    # Cue text is at y=0.48 (shifted subtitle above actor head), while base_roi is at y=0.62..0.85
    cue = SubtitleCueV1(
        cue_id="c_moved",
        start_pts=36.0,
        end_pts=38.0,
        source_text="他们在一起已经有一段日子了",
        confidence=0.9,
    )

    class MockCap:
        def __init__(self, _path):
            self.opened = True

        def isOpened(self):
            return self.opened

        def set(self, prop, val):
            pass

        def read(self):
            # 1000x1000 frame
            frame = np.zeros((1000, 1000, 3), dtype=np.uint8)
            return True, frame

        def release(self):
            self.opened = False

    monkeypatch.setattr("cv2.VideoCapture", MockCap)

    call_count = 0
    received_shapes = []

    class MovingSubtitleMockEngine:
        def __call__(self, crop):
            nonlocal call_count
            call_count += 1
            received_shapes.append(crop.shape)
            # If it's the Tier 1 bottom crop (height ~330 at y=540..870), return no matching text
            if crop.shape[0] < 500:
                return [], None
            # If it's Tier 2 fallback dialogue band crop (height ~860 at y=120..980), return the moved subtitle at y=480..520 (which is crop y=360..400)
            return [
                (
                    [[120, 360], [880, 360], [880, 400], [120, 400]],
                    "他们在一起已经有一段日子了",
                    0.99,
                ),
            ], None

    roi = RegionTrackV1(region_id="roi-bottom", x=0.05, y=0.62, width=0.90, height=0.17)
    updated = discoverer.discover_and_verify_cues(
        video_path="dummy.mp4",
        cues=[cue],
        base_roi=roi,
        detector_engine=MovingSubtitleMockEngine(),
    )

    # Tier 1 failed -> triggered Tier 2
    assert call_count == 2
    assert "box" in updated[0].style
    box = updated[0].style["box"]
    # y in frame is 120 (fallback offset) + 360 = 480 -> norm_y = 0.48
    # with padding 0.012 -> ~0.468
    assert 0.45 <= box["y"] <= 0.48
    assert "box_discovered" in updated[0].quality_flags
    assert "optical_verified" in updated[0].quality_flags


