from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.render.video_rescue import build_video_rescue_plan, retime_cues_for_video_rescue


def test_video_rescue_caps_factor_and_shifts_following_cues():
    cues = [
        SubtitleCueV1(cue_id="a", start_pts=0.0, end_pts=5.0, translated_text="A"),
        SubtitleCueV1(cue_id="b", start_pts=5.0, end_pts=6.0, translated_text="B"),
    ]
    plan = build_video_rescue_plan(cues, {"a": 2.0}, max_slowdown=1.25)
    assert plan[0].factor == 1.25
    shifted = retime_cues_for_video_rescue(cues, plan)
    assert shifted[1].start_pts == 6.25
    assert shifted[1].end_pts == 7.25


def test_video_rescue_rejects_overlapping_segments():
    cues = [
        SubtitleCueV1(cue_id="a", start_pts=0.0, end_pts=2.0, translated_text="A"),
        SubtitleCueV1(cue_id="b", start_pts=1.0, end_pts=3.0, translated_text="B"),
    ]
    plan = build_video_rescue_plan(cues, {"a": 0.5, "b": 0.5})
    assert [s.cue_id for s in plan] == ["a"]
