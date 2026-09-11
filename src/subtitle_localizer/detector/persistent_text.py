from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from subtitle_localizer.domain.models import OcrObservationV1, RegionTrackV1

Box = List[float]
FramesData = List[Tuple[float, List[Box]]]

# Platform / short-drama watermarks & fixed branding commonly burned into CN shorts.
PLATFORM_BRANDING_PATTERNS: Tuple[re.Pattern[str], ...] = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"^红果(?:短剧)?(?:免费看)?$",
        r"^红果短剧免费看$",
        r"^红果免费看$",
        r"^红果短剧$",
        r"^免费看$",
        r"^抖音(?:号)?$",
        r"^快手$",
        r"^西瓜视频$",
        r"^腾讯视频$",
        r"^爱奇艺$",
        r"^优酷$",
        r"^哔哩哔哩$",
        r"^bilibili$",
        r"^网易(?:云)?(?:剧场|追剧)?$",
        r"^点众(?:短剧)?$",
        r"^河马(?:剧场)?$",
        r"^番茄(?:小说|短剧)?$",
        r"^畅听(?:免费)?$",
        r"^追剧(?:神器)?$",
        r"^本集完$",
        r"^未完待续$",
        r"^关注(?:我|我们)?(?:领取|解锁)?",
        r"^扫码(?:观看|追剧)",
        r"^微信(?:公众号|视频号)?",
        r"^点击(?:左下角|首页)",
    )
)


def is_platform_branding_text(text: str) -> bool:
    """Return True when OCR text is platform watermark / fixed branding junk."""
    raw = (text or "").strip()
    if not raw:
        return False
    compact = re.sub(r"[\s\u3000\|｜/／·•\-_/\\]+", "", raw)
    candidates = {raw, compact}
    # Also evaluate individual lines for multi-line OCR blobs.
    for line in re.split(r"[\n\r]+", raw):
        line = line.strip()
        if line:
            candidates.add(line)
            candidates.add(re.sub(r"[\s\u3000\|｜/／·•\-_/\\]+", "", line))
    for candidate in candidates:
        if not candidate:
            continue
        for pattern in PLATFORM_BRANDING_PATTERNS:
            # Prefer full-line branding matches to avoid killing dialogue that merely mentions a brand.
            if pattern.fullmatch(candidate):
                return True
            if pattern.pattern.startswith(r"^") and pattern.pattern.endswith(r"$") and pattern.search(candidate):
                return True
    return False


def strip_branding_lines(text: str) -> str:
    """Remove branding-only lines/tokens from an OCR string."""
    if not text:
        return ""
    kept: List[str] = []
    token_split = re.compile(r"[\s\u3000|\uFF0F\uFF5C/]+")
    for line in re.split(r"[\n\r]+", text):
        piece = line.strip()
        if not piece:
            continue
        if is_platform_branding_text(piece):
            continue
        tokens = [tok for tok in token_split.split(piece) if tok]
        if len(tokens) >= 2:
            tokens = [tok for tok in tokens if not is_platform_branding_text(tok)]
            if not tokens:
                continue
            piece = " ".join(tokens)
        kept.append(piece)
    if kept:
        return "\n".join(kept) if "\n" in text else " ".join(kept)
    if is_platform_branding_text(text):
        return ""
    return text.strip()


def box_iou(a: Sequence[float], b: Sequence[float]) -> float:
    """IoU for boxes in [x1, y1, x2, y2] format."""
    if len(a) < 4 or len(b) < 4:
        return 0.0
    ax1, ay1, ax2, ay2 = (float(a[0]), float(a[1]), float(a[2]), float(a[3]))
    bx1, by1, bx2, by2 = (float(b[0]), float(b[1]), float(b[2]), float(b[3]))
    if ax2 <= ax1 or ay2 <= ay1 or bx2 <= bx1 or by2 <= by1:
        return 0.0
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0.0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter
    if union <= 0.0:
        return 0.0
    return inter / union


def classify_persistent_boxes(
    frames_data: FramesData,
    persistent_ratio: float = 0.55,
    iou_threshold: float = 0.55,
) -> List[Box]:
    """Find boxes that remain present across enough sampled frames (watermarks/logos)."""
    if not frames_data:
        return []
    if not 0.0 < persistent_ratio <= 1.0:
        raise ValueError("persistent_ratio must be in (0, 1]")
    total_frames = len(frames_data)
    presence: List[Tuple[Box, int]] = []
    for _, boxes in frames_data:
        for box in boxes or []:
            if len(box) < 4:
                continue
            matched = False
            for idx, (known, count) in enumerate(presence):
                if box_iou(known, box) >= iou_threshold:
                    # Keep a running average box to stabilize jitter.
                    merged = [
                        (known[0] * count + float(box[0])) / (count + 1),
                        (known[1] * count + float(box[1])) / (count + 1),
                        (known[2] * count + float(box[2])) / (count + 1),
                        (known[3] * count + float(box[3])) / (count + 1),
                    ]
                    presence[idx] = (merged, count + 1)
                    matched = True
                    break
            if not matched:
                presence.append(([float(v) for v in box[:4]], 1))
    return [
        box
        for box, count in presence
        if (count / max(1, total_frames)) >= persistent_ratio
    ]


def filter_dialogue_boxes(
    boxes: Iterable[Box],
    persistent_boxes: Sequence[Box],
    iou_threshold: float = 0.55,
) -> List[Box]:
    """Drop boxes that overlap known persistent watermark/logo boxes."""
    out: List[Box] = []
    for box in boxes or []:
        if len(box) < 4:
            continue
        if any(box_iou(box, wb) >= iou_threshold for wb in persistent_boxes):
            continue
        out.append([float(v) for v in box[:4]])
    return out


def split_persistent_and_dialogue(
    frames_data: FramesData,
    persistent_ratio: float = 0.55,
    iou_threshold: float = 0.55,
) -> Dict[str, Any]:
    persistent_boxes = classify_persistent_boxes(
        frames_data,
        persistent_ratio=persistent_ratio,
        iou_threshold=iou_threshold,
    )
    dialogue_frames: FramesData = []
    for pts, boxes in frames_data:
        kept = filter_dialogue_boxes(boxes, persistent_boxes, iou_threshold=iou_threshold)
        dialogue_frames.append((pts, kept))
    return {
        "persistent_boxes": persistent_boxes,
        "dialogue_frames_data": dialogue_frames,
    }


def _observation_overlaps_persistent(
    observation: OcrObservationV1,
    persistent_boxes: Sequence[Box],
    iou_threshold: float,
) -> bool:
    boxes = getattr(observation, "boxes", None) or []
    if not boxes or not persistent_boxes:
        return False
    # If every box is persistent, drop; if mixed, caller may strip text instead.
    hits = sum(
        1
        for box in boxes
        if len(box) >= 4 and any(box_iou(box, wb) >= iou_threshold for wb in persistent_boxes)
    )
    return hits > 0 and hits >= len(boxes)


def filter_observations_from_persistent_text(
    observations: Sequence[OcrObservationV1],
    persistent_boxes: Optional[Sequence[Box]] = None,
    drop_branding_text: bool = True,
    iou_threshold: float = 0.55,
) -> List[OcrObservationV1]:
    """Drop branding / persistent-watermark observations before cue reconstruction."""
    persistent_boxes = list(persistent_boxes or [])
    kept: List[OcrObservationV1] = []
    for obs in observations:
        raw = getattr(obs, "raw_text", "") or ""
        cleaned = strip_branding_lines(raw) if drop_branding_text else raw
        if drop_branding_text and not cleaned.strip():
            continue
        if drop_branding_text and is_platform_branding_text(cleaned):
            continue

        boxes = list(obs.boxes or [])
        filtered_boxes = (
            filter_dialogue_boxes(boxes, persistent_boxes, iou_threshold)
            if persistent_boxes
            else boxes
        )
        fully_persistent = bool(boxes) and persistent_boxes and not filtered_boxes
        if fully_persistent and (not cleaned.strip() or is_platform_branding_text(cleaned)):
            continue
        if fully_persistent and _observation_overlaps_persistent(obs, persistent_boxes, iou_threshold):
            # No dialogue boxes remain — drop watermark-only observation.
            continue

        meta = dict(getattr(obs, "preprocessing_metadata", {}) or {})
        changed = False
        if persistent_boxes and filtered_boxes != boxes:
            meta["persistent_text_filtered"] = True
            changed = True
        if cleaned.strip() != raw.strip():
            meta["branding_text_stripped"] = True
            changed = True

        if changed:
            kept.append(
                OcrObservationV1(
                    pts=obs.pts,
                    boxes=filtered_boxes,
                    raw_text=cleaned.strip(),
                    normalized_text=cleaned.strip(),
                    confidence=obs.confidence,
                    preprocessing_metadata=meta,
                    model_metadata=dict(getattr(obs, "model_metadata", {}) or {}),
                    schema_version=getattr(obs, "schema_version", "ocr-observation-v1"),
                )
            )
        else:
            kept.append(obs)
    return kept


def xyxy_to_norm_region(
    box: Sequence[float],
    frame_width: float,
    frame_height: float,
    region_id: str,
    role: str = "always_mask",
    roi_norm: Optional[Tuple[float, float, float, float]] = None,
) -> RegionTrackV1:
    """Convert absolute/normalized xyxy box into a RegionTrackV1.

    Absolute pixel boxes are interpreted in the OCR crop space. When ``roi_norm``
    is provided as (x, y, w, h) of that crop inside the full frame, boxes are
    mapped into full-frame normalized coordinates.
    """
    x1, y1, x2, y2 = (float(box[0]), float(box[1]), float(box[2]), float(box[3]))
    # Heuristic: values <= 1.5 are already normalized in the current space.
    already_norm = max(abs(x1), abs(y1), abs(x2), abs(y2)) <= 1.5
    if already_norm:
        nx1, ny1, nx2, ny2 = x1, y1, x2, y2
        if roi_norm is not None:
            rx, ry, rw, rh = (float(v) for v in roi_norm)
            nx1 = rx + nx1 * rw
            nx2 = rx + nx2 * rw
            ny1 = ry + ny1 * rh
            ny2 = ry + ny2 * rh
    else:
        if frame_width <= 1.0 or frame_height <= 1.0:
            raise ValueError("absolute boxes require real crop/frame pixel dimensions")
        lx1 = x1 / frame_width
        ly1 = y1 / frame_height
        lx2 = x2 / frame_width
        ly2 = y2 / frame_height
        if roi_norm is not None:
            rx, ry, rw, rh = (float(v) for v in roi_norm)
            nx1 = rx + lx1 * rw
            nx2 = rx + lx2 * rw
            ny1 = ry + ly1 * rh
            ny2 = ry + ly2 * rh
        else:
            nx1, ny1, nx2, ny2 = lx1, ly1, lx2, ly2
    nx1 = min(max(0.0, nx1), 1.0)
    ny1 = min(max(0.0, ny1), 1.0)
    nx2 = min(max(0.0, nx2), 1.0)
    ny2 = min(max(0.0, ny2), 1.0)
    width = max(0.01, nx2 - nx1)
    height = max(0.01, ny2 - ny1)
    if nx1 + width > 1.0:
        width = max(0.01, 1.0 - nx1)
    if ny1 + height > 1.0:
        height = max(0.01, 1.0 - ny1)
    return RegionTrackV1(
        region_id=region_id,
        x=round(nx1, 4),
        y=round(ny1, 4),
        width=round(width, 4),
        height=round(height, 4),
        mask_enabled=(role != "ignore"),
        role=role,
    )


def regions_from_persistent_boxes(
    persistent_boxes: Sequence[Box],
    frame_width: float = 1.0,
    frame_height: float = 1.0,
    role: str = "always_mask",
    roi_norm: Optional[Tuple[float, float, float, float]] = None,
) -> List[RegionTrackV1]:
    regions: List[RegionTrackV1] = []
    for idx, box in enumerate(persistent_boxes):
        try:
            region = xyxy_to_norm_region(
                box,
                frame_width=frame_width,
                frame_height=frame_height,
                region_id=f"persistent-{idx + 1:02d}",
                role=role,
                roi_norm=roi_norm,
            )
        except ValueError:
            continue
        if not region.is_valid():
            continue
        # Skip huge bands that look like full dialogue ROI.
        if float(region.height) > 0.25 or float(region.width) > 0.95 and float(region.height) > 0.18:
            continue
        regions.append(region)
    return regions
