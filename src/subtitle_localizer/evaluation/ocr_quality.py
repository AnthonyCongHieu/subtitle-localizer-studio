from __future__ import annotations

import re
import statistics
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class EvalCue:
    start: float
    end: float
    text: str


_TIME_RE = re.compile(r"^(\d+):(\d{2}):(\d{2})[,\.](\d{3})$")


def _parse_time(value: str) -> float:
    match = _TIME_RE.match(value.strip())
    if not match:
        raise ValueError(f"Invalid SRT timestamp: {value!r}")
    hours, minutes, seconds, millis = (int(part) for part in match.groups())
    if minutes >= 60 or seconds >= 60:
        raise ValueError(f"Invalid SRT timestamp: {value!r}")
    return hours * 3600 + minutes * 60 + seconds + millis / 1000


def parse_srt(path: Path | str) -> list[EvalCue]:
    """Parse UTF-8 SRT without silently replacing malformed text."""
    content = Path(path).read_text(encoding="utf-8")
    cues: list[EvalCue] = []
    for block in re.split(r"\r?\n\s*\r?\n", content.strip()):
        lines = block.splitlines()
        if len(lines) < 3 or "-->" not in lines[1]:
            raise ValueError(f"Malformed SRT block in {path}: {block[:40]!r}")
        start_raw, end_raw = (part.strip() for part in lines[1].split("-->", 1))
        start, end = _parse_time(start_raw), _parse_time(end_raw)
        if end < start:
            raise ValueError("SRT cue end precedes start")
        text = "\n".join(lines[2:]).strip()
        cues.append(EvalCue(start, end, text))
    return cues


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFC", text).replace("\r\n", "\n").strip()


def _distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for i, left_char in enumerate(left, 1):
        current = [i]
        for j, right_char in enumerate(right, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (left_char != right_char)))
        previous = current
    return previous[-1]


def _overlap(left: EvalCue, right: EvalCue) -> float:
    intersection = max(0.0, min(left.end, right.end) - max(left.start, right.start))
    union = max(left.end, right.end) - min(left.start, right.start)
    return intersection / union if union else 0.0


def evaluate_srt_pair(ground_truth: Path | str, output: Path | str, *, overlap_threshold: float = 0.5) -> dict[str, Any]:
    """Return reproducible cue recall, CER and timing metrics for two SRT files."""
    if not 0.0 < overlap_threshold <= 1.0:
        raise ValueError("overlap_threshold must be in (0, 1]")
    truth, predicted = parse_srt(ground_truth), parse_srt(output)
    matched: list[tuple[EvalCue, EvalCue]] = []
    used: set[int] = set()
    for expected in truth:
        candidates = [(index, actual) for index, actual in enumerate(predicted) if index not in used and _overlap(expected, actual) >= overlap_threshold]
        if candidates:
            index, actual = max(candidates, key=lambda item: _overlap(expected, item[1]))
            used.add(index)
            matched.append((expected, actual))
    expected_text = "".join(_normalize(cue.text) for cue in truth)
    predicted_text = "".join(_normalize(actual.text) for _, actual in matched)
    errors = _distance(expected_text, predicted_text)
    timing_errors = [abs(actual.start - expected.start) * 1000 for expected, actual in matched]
    return {
        "ground_truth_cues": len(truth),
        "predicted_cues": len(predicted),
        "matched_cues": len(matched),
        "cue_recall": len(matched) / len(truth) if truth else 1.0,
        "ocr_cer": errors / len(expected_text) if expected_text else 0.0,
        "timing_median_ms": round(statistics.median(timing_errors), 3) if timing_errors else 0.0,
        "timing_p95_ms": (round(sorted(timing_errors)[max(0, min(len(timing_errors) - 1, int((0.95 * len(timing_errors)) + 0.999999) - 1))], 3) if timing_errors else 0.0),
        "missing_cues": len(truth) - len(matched),
        "duplicate_or_extra_cues": max(0, len(predicted) - len(matched)),
    }
