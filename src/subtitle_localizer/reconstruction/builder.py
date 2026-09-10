from __future__ import annotations

from dataclasses import replace
from typing import List

from subtitle_localizer.domain.models import OcrObservationV1, SubtitleCueV1
from subtitle_localizer.reconstruction.consensus import calculate_text_similarity, majority_vote_text
from subtitle_localizer.reconstruction.ordering import sort_reading_order


def _cue_text_similarity(left: SubtitleCueV1, right: SubtitleCueV1) -> float:
    left_source = (left.source_text or "").strip()
    right_source = (right.source_text or "").strip()
    left_translated = (left.translated_text or "").strip()
    right_translated = (right.translated_text or "").strip()
    scores = []
    if left_source and right_source:
        if _is_watermark_or_contained_duplicate(left_source, right_source):
            scores.append(1.0)
        else:
            scores.append(calculate_text_similarity(left_source, right_source))
    if left_translated and right_translated:
        scores.append(calculate_text_similarity(left_translated, right_translated))
    return max(scores) if scores else 0.0


def _is_watermark_or_contained_duplicate(left: str, right: str) -> bool:
    shorter, longer = (left, right) if len(left) <= len(right) else (right, left)
    if len(shorter) < 8 or shorter not in longer:
        return False
    extra = len(longer) - len(shorter)
    return extra <= max(8, int(len(shorter) * 0.30))


def _merge_adjacent_cues(left: SubtitleCueV1, right: SubtitleCueV1) -> SubtitleCueV1:
    left_source = left.source_text or ""
    right_source = right.source_text or ""
    source_text = left_source if len(left_source) >= len(right_source) else right_source
    left_translated = left.translated_text or ""
    right_translated = right.translated_text or ""
    translated_text = left_translated if len(left_translated) >= len(right_translated) else right_translated
    flags = list(dict.fromkeys([*(left.quality_flags or []), *(right.quality_flags or []), "merged_duplicate"]))
    return replace(
        left,
        start_pts=min(left.start_pts, right.start_pts),
        end_pts=max(left.end_pts, right.end_pts),
        source_text=source_text,
        translated_text=translated_text,
        confidence=max(left.confidence, right.confidence),
        quality_flags=flags,
    )


def normalize_sequential_cues(
    cues: List[SubtitleCueV1],
    *,
    similarity_threshold: float = 0.90,
    max_merge_gap: float = 0.50,
    max_padding_overlap: float = 0.25,
) -> List[SubtitleCueV1]:
    """Gộp câu trùng kề nhau và cắt phần đuôi ASR bị đệm (khoảng 200ms)."""
    if not cues:
        return []

    ordered = sorted(cues, key=lambda cue: (cue.start_pts, cue.end_pts, cue.cue_id))
    merged: List[SubtitleCueV1] = [ordered[0]]
    for cue in ordered[1:]:
        previous = merged[-1]
        gap = cue.start_pts - previous.end_pts
        if gap <= max_merge_gap and _cue_text_similarity(previous, cue) >= similarity_threshold:
            merged[-1] = _merge_adjacent_cues(previous, cue)
        else:
            merged.append(cue)

    trimmed: List[SubtitleCueV1] = []
    for index, cue in enumerate(merged):
        end_pts = cue.end_pts
        if index + 1 < len(merged):
            next_start = merged[index + 1].start_pts
            overlap = end_pts - next_start
            if 0 < overlap <= max_padding_overlap:
                end_pts = max(cue.start_pts + 0.05, next_start)
        trimmed.append(replace(cue, start_pts=round(cue.start_pts, 3), end_pts=round(end_pts, 3)))
    return trimmed


class CueReconstructor:
    """Xây dựng và tái tạo phụ đề SubtitleCueV1 từ chuỗi quan sát OCR."""

    def __init__(
        self,
        min_cue_duration: float = 0.25,
        max_merge_gap: float = 1.2,
        similarity_threshold: float = 0.78,
        lead_in: float = 0.0,
        lead_out: float = 0.0,
    ) -> None:
        self.min_cue_duration = min_cue_duration
        self.max_merge_gap = max_merge_gap
        self.similarity_threshold = similarity_threshold
        self.lead_in = lead_in
        self.lead_out = lead_out

    def build_cues(self, observations: List[OcrObservationV1]) -> List[SubtitleCueV1]:
        """Tái cấu trúc danh sách OcrObservationV1 thành danh sách SubtitleCueV1 ổn định."""
        if not observations:
            return []

        # 1. Nhóm các observation xảy ra cùng thời điểm PTS (ví dụ multi-line boxes)
        pts_groups: dict[float, List[OcrObservationV1]] = {}
        disputed_pts = set()
        for obs in observations:
            pts_groups.setdefault(obs.pts, []).append(obs)
            if obs.preprocessing_metadata.get("candidate_disagreement"):
                disputed_pts.add(obs.pts)

        # Tạo frame items gồm (pts, combined_text, avg_confidence, boxes)
        frame_items: List[tuple[float, str, float]] = []
        for pts in sorted(pts_groups.keys()):
            group = pts_groups[pts]
            if len(group) == 1:
                text = group[0].raw_text.strip()
                conf = group[0].confidence
            else:
                text = sort_reading_order(group)
                conf = sum(g.confidence for g in group) / len(group)
            if text:
                frame_items.append((pts, text, conf))

        if not frame_items:
            return []

        # 2. Gom cụm các frame items thành các cue segments
        clusters: List[List[tuple[float, str, float]]] = []
        cur_cluster = [frame_items[0]]

        for item in frame_items[1:]:
            last_item = cur_cluster[-1]
            gap = item[0] - last_item[0]
            sim = calculate_text_similarity(item[1], last_item[1])

            if gap <= self.max_merge_gap and sim >= self.similarity_threshold:
                cur_cluster.append(item)
            else:
                clusters.append(cur_cluster)
                cur_cluster = [item]

        if cur_cluster:
            clusters.append(cur_cluster)

        # 3. Tạo các SubtitleCueV1 từ clusters
        cues: List[SubtitleCueV1] = []
        cue_index = 1

        for i, cluster in enumerate(clusters):
            start_pts = cluster[0][0]
            end_pts = cluster[-1][0]

            # Nếu cluster chỉ có 1 sample frame (thoại ngắn xuất hiện giữa các frame),
            # mở rộng thời lượng tối thiểu 0.40s để không bị coi là 0s flicker
            if end_pts <= start_pts:
                end_pts = start_pts + 0.40

            duration = end_pts - start_pts

            # Bỏ qua các cue có thời lượng tổng thể nhỏ hơn min_cue_duration (flicker)
            if duration < self.min_cue_duration and self.min_cue_duration > 0.0:
                continue

            # Áp dụng Lead-In Buffer (xuất hiện sớm một chút tránh chữ hiện trước khung che)
            if self.lead_in > 0:
                prev_end = cues[-1].end_pts if cues else 0.0
                start_pts = max(prev_end, start_pts - self.lead_in)

            # Áp dụng Lead-Out Buffer (giữ khung che đủ thời lượng frame mẫu cuối)
            if self.lead_out > 0:
                next_start = clusters[i + 1][0][0] if i + 1 < len(clusters) else None
                if next_start is not None:
                    end_pts = min(next_start - 0.05, end_pts + self.lead_out)
                else:
                    end_pts = end_pts + self.lead_out

            # Majority vote cho từng dòng text
            texts = [c[1] for c in cluster]
            final_text = majority_vote_text(texts).strip()

            # Lọc bỏ các cue rác: không có chữ/số hoặc chỉ là ký tự lẻ / rác vô nghĩa (C, CC, D, Y...)
            from subtitle_localizer.ocr.rapid import is_trash_sub
            if is_trash_sub(final_text):
                continue

            avg_conf = sum(c[2] for c in cluster) / len(cluster)
            flags: List[str] = []
            if any(item[0] in disputed_pts for item in cluster):
                flags.append("ocr_candidate_disagreement")
            if avg_conf < 0.70:
                flags.append("low_confidence")
            if "\n" in final_text:
                flags.append("multiline")

            cue = SubtitleCueV1(
                cue_id=f"cue-{cue_index:04d}",
                start_pts=round(start_pts, 3),
                end_pts=round(max(start_pts + 0.3, end_pts), 3),
                source_text=final_text,
                translated_text="",
                confidence=round(avg_conf, 3),
                quality_flags=flags,
                status="auto",
            )
            cues.append(cue)
            cue_index += 1

        return cues
