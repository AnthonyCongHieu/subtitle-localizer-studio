"""Deterministic planning helpers for cue-local video slowdown rescue."""
from __future__ import annotations

from dataclasses import dataclass
from copy import deepcopy
from typing import Iterable, List


@dataclass(frozen=True)
class VideoRescueSegment:
    cue_id: str
    start: float
    end: float
    factor: float

    @property
    def added_seconds(self) -> float:
        return max(0.0, (self.end - self.start) * (self.factor - 1.0))


def build_video_rescue_plan(cues: Iterable[object], overflow_by_id: dict[str, float], *,
                            max_slowdown: float = 1.25) -> List[VideoRescueSegment]:
    """Create non-overlapping slowdown segments from measured cue overflow.

    ``overflow_by_id`` is seconds required beyond each cue's current slot.
    Cues without positive overflow are ignored; overlapping cues are rejected
    because independent retiming would make subtitle mapping ambiguous.
    """
    ordered = sorted(cues, key=lambda c: (float(c.start_pts), float(c.end_pts), str(c.cue_id)))
    result: List[VideoRescueSegment] = []
    previous_end = -1.0
    cap = max(1.0, float(max_slowdown))
    for cue in ordered:
        start, end = float(cue.start_pts), float(cue.end_pts)
        if end <= start or start < previous_end:
            continue
        overflow = max(0.0, float(overflow_by_id.get(str(cue.cue_id), 0.0)))
        if overflow <= 0.0:
            previous_end = end
            continue
        duration = end - start
        factor = min(cap, 1.0 + overflow / duration)
        result.append(VideoRescueSegment(str(cue.cue_id), start, end, factor))
        previous_end = end
    return result


def retime_cues_for_video_rescue(cues: Iterable[object], plan: Iterable[VideoRescueSegment]) -> list[object]:
    """Return copied cues with cumulative slowdown offsets and segment expansions applied."""
    offsets = sorted(plan, key=lambda s: s.start)
    out = []
    for cue in sorted(cues, key=lambda c: float(c.start_pts)):
        shift = sum(s.added_seconds for s in offsets if s.end <= float(cue.start_pts))
        matching_seg = next((s for s in offsets if s.cue_id == str(getattr(cue, "cue_id", ""))), None)
        if shift <= 0 and matching_seg is None:
            out.append(cue)
            continue
        if hasattr(cue, "model_copy"):
            clone = cue.model_copy(deep=True)
        elif hasattr(cue, "copy"):
            clone = cue.copy(deep=True)
        else:
            clone = deepcopy(cue)
        clone.start_pts = float(clone.start_pts) + shift
        if matching_seg is not None:
            duration = (float(cue.end_pts) - float(cue.start_pts)) * matching_seg.factor
            clone.end_pts = clone.start_pts + duration
        else:
            clone.end_pts = float(clone.end_pts) + shift
        out.append(clone)
    return out
