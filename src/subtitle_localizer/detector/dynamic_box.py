from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

from subtitle_localizer.domain.models import RegionTrackV1, SubtitleCueV1

logger = logging.getLogger(__name__)


class DynamicBoxDiscoverer:
    """Tự động dò tìm bounding box chuẩn xác theo từng phân đoạn âm thanh / câu phụ đề
    và thực hiện xác minh quang học (Optical Verification) với hình ảnh thực tế trên video."""

    def __init__(
        self,
        padding_x: float = 0.015,
        padding_y: float = 0.012,
        min_similarity: float = 0.35,
        optical_confidence_threshold: float = 0.85,
    ) -> None:
        self.padding_x = padding_x
        self.padding_y = padding_y
        self.min_similarity = min_similarity
        self.optical_confidence_threshold = optical_confidence_threshold

    @staticmethod
    def _calculate_similarity(src: str, cand: str) -> float:
        """Tính toán độ tương đồng giữa văn bản gốc và văn bản nhận diện qua OCR."""
        if not src or not cand:
            return 0.0
        clean_src = "".join(c for c in src if c.isalnum())
        clean_cand = "".join(c for c in cand if c.isalnum())
        if not clean_src or not clean_cand:
            return 0.0
        if clean_src in clean_cand or clean_cand in clean_src:
            return 1.0
        common = sum(1 for ch in clean_cand if ch in clean_src)
        return common / max(len(clean_src), len(clean_cand))

    def discover_and_verify_cues(
        self,
        video_path: str | Path,
        cues: List[SubtitleCueV1],
        base_roi: Optional[RegionTrackV1] = None,
        progress_callback: Optional[Callable[[int, int], None]] = None,
        detector_engine: Any = None,
    ) -> List[SubtitleCueV1]:
        """Quét video theo từng phân đoạn thời gian của cue để tìm khung phụ đề thực tế và kiểm tra chất lượng."""
        if not cues:
            return []

        # Short-circuit: Nếu tất cả cues đều đã có box chuẩn và đã được xác minh quang học từ trước
        all_verified = all(
            bool((cue.style or {}).get("box")) and "optical_verified" in (cue.quality_flags or [])
            for cue in cues
        )
        if all_verified:
            if progress_callback:
                progress_callback(len(cues), len(cues))
            return cues

        path_str = str(video_path)
        cap = cv2.VideoCapture(path_str)
        if not cap.isOpened():
            logger.warning("Không thể mở video để dò khung phụ đề động: %s", path_str)
            return cues

        # Khởi tạo OCR engine nếu chưa được cung cấp
        engine = detector_engine
        if engine is None:
            try:
                from rapidocr_onnxruntime import RapidOCR
                engine = RapidOCR()
            except Exception as e:
                logger.warning("Không thể khởi tạo RapidOCR cho dynamic box discovery: %s", e)
                cap.release()
                return cues

        total_cues = len(cues)
        updated_cues: List[SubtitleCueV1] = []

        try:
            for idx, cue in enumerate(cues):
                if progress_callback:
                    try:
                        progress_callback(idx + 1, total_cues)
                    except Exception:
                        pass

                # Bỏ qua quét lại nếu câu này đã có box chuẩn và đã được xác minh quang học
                if bool((cue.style or {}).get("box")) and "optical_verified" in (cue.quality_flags or []):
                    updated_cues.append(cue)
                    continue

                mid_pts = (cue.start_pts + cue.end_pts) / 2.0
                cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, mid_pts * 1000.0))
                ret, frame = cap.read()
                if not ret or frame is None:
                    updated_cues.append(cue)
                    continue

                h, w = frame.shape[:2]
                if h <= 0 or w <= 0:
                    updated_cues.append(cue)
                    continue

                # Tối ưu hóa vùng quét theo base_roi để tăng tốc và tránh bắt nhầm text nền
                if base_roi is not None and getattr(base_roi, "height", 0) > 0:
                    pad_y = 0.08
                    pad_x = 0.05
                    by = float(getattr(base_roi, "y", 0.60))
                    bh_val = float(getattr(base_roi, "height", 0.35))
                    bx_val = float(getattr(base_roi, "x", 0.0))
                    bw_val = float(getattr(base_roi, "width", 1.0))
                    crop_y1 = max(0, int(h * max(0.0, by - pad_y)))
                    crop_y2 = min(h, int(h * min(1.0, by + bh_val + pad_y)))
                    crop_x1 = max(0, int(w * max(0.0, bx_val - pad_x)))
                    crop_x2 = min(w, int(w * min(1.0, bx_val + bw_val + pad_x)))
                else:
                    crop_y1, crop_y2, crop_x1, crop_x2 = 0, h, 0, w

                if (crop_y2 - crop_y1 < 20) or (crop_x2 - crop_x1 < 20):
                    crop_y1, crop_y2, crop_x1, crop_x2 = 0, h, 0, w

                crop_frame = frame[crop_y1:crop_y2, crop_x1:crop_x2]

                best_match: Optional[Dict[str, Any]] = None
                best_score = 0.0

                def _scan_and_match(img_crop: np.ndarray, off_x: int, off_y: int) -> None:
                    nonlocal best_match, best_score
                    if img_crop is None or img_crop.size == 0 or img_crop.shape[0] < 10 or img_crop.shape[1] < 10:
                        return
                    try:
                        res, _ = engine(img_crop)
                    except Exception as ex:
                        logger.debug("Lỗi nhận diện OCR tại PTS %.2f: %s", mid_pts, ex)
                        return
                    if not res:
                        return
                    for item in res:
                        try:
                            poly = np.array(item[0], dtype=float)
                            text = str(item[1]).strip()
                            score = float(item[2])
                        except (IndexError, ValueError, TypeError):
                            continue

                        if poly.size < 8:
                            continue

                        poly[:, 0] += off_x
                        poly[:, 1] += off_y

                        x1, y1 = float(poly[:, 0].min()), float(poly[:, 1].min())
                        x2, y2 = float(poly[:, 0].max()), float(poly[:, 1].max())
                        if x2 <= x1 or y2 <= y1:
                            continue

                        norm_x = x1 / w
                        norm_y = y1 / h
                        norm_w = (x2 - x1) / w
                        norm_h = (y2 - y1) / h

                        sim = self._calculate_similarity(cue.source_text, text)
                        if sim >= self.min_similarity and sim > best_score:
                            best_score = sim
                            best_match = {
                                "text": text,
                                "score": score,
                                "x": norm_x,
                                "y": norm_y,
                                "width": norm_w,
                                "height": norm_h,
                                "sim": sim,
                            }

                # Tier 1: Quét nhanh trong vùng crop_frame định vị bởi base_roi
                _scan_and_match(crop_frame, crop_x1, crop_y1)

                # Tier 2 (Fallback cho sub dịch chuyển vị trí):
                # Nếu Tier 1 không tìm thấy text khớp và crop_frame nhỏ hơn khung hình thực tế,
                # mở rộng quét toàn khung hình / dải đối thoại rộng (12% - 98% chiều cao)
                if best_match is None and (crop_y1 > 0 or crop_y2 < h or crop_x1 > 0 or crop_x2 < w):
                    fb_y1 = max(0, int(h * 0.12))
                    fb_y2 = min(h, int(h * 0.98))
                    fb_crop = frame[fb_y1:fb_y2, 0:w]
                    _scan_and_match(fb_crop, 0, fb_y1)

                if not best_match:
                    # Không tìm thấy chữ trên khung hình tại thời điểm này
                    if cue.confidence < 0.70:
                        cue.quality_flags = list(cue.quality_flags or [])
                        if "audio_only_no_visual" not in cue.quality_flags:
                            cue.quality_flags.append("audio_only_no_visual")
                    updated_cues.append(cue)
                    continue

                if best_match:
                    # Tính toán bounding box có padding an toàn
                    bx = max(0.0, best_match["x"] - self.padding_x)
                    by = max(0.0, best_match["y"] - self.padding_y)
                    bw = min(1.0 - bx, best_match["width"] + self.padding_x * 2)
                    bh = min(1.0 - by, best_match["height"] + self.padding_y * 2)

                    box_dict = {
                        "x": round(bx, 4),
                        "y": round(by, 4),
                        "width": round(bw, 4),
                        "height": round(bh, 4),
                    }
                    cue.style = dict(cue.style or {})
                    cue.style["box"] = box_dict

                    cue.quality_flags = list(cue.quality_flags or [])
                    if "box_discovered" not in cue.quality_flags:
                        cue.quality_flags.append("box_discovered")

                    # Xác minh quang học: nếu ảnh thật trên video có chữ rõ ràng (score cao)
                    # và khớp tốt với ASR nhưng có từ chuẩn hơn, cập nhật ground truth
                    if best_match["score"] >= self.optical_confidence_threshold:
                        if "optical_verified" not in cue.quality_flags:
                            cue.quality_flags.append("optical_verified")
                        cue.confidence = max(cue.confidence, float(best_match["score"]))

                        # Nếu ASR nghe thiếu/sai nhẹ so với chữ nét trên video (vd '还不止次' vs '还不止一次')
                        if (
                            best_match["text"] != cue.source_text
                            and len(best_match["text"]) >= 2
                            and best_match["sim"] >= 0.65
                        ):
                            logger.info(
                                "Xác minh quang học hiệu chỉnh ASR: '%s' -> '%s' (PTS %.2f)",
                                cue.source_text,
                                best_match["text"],
                                mid_pts,
                            )
                            cue.source_text = best_match["text"]
                else:
                    # Không khớp với chữ nào phát hiện được
                    if cue.confidence < 0.70:
                        cue.quality_flags = list(cue.quality_flags or [])
                        if "audio_only_no_visual" not in cue.quality_flags:
                            cue.quality_flags.append("audio_only_no_visual")

                updated_cues.append(cue)
        finally:
            cap.release()

        return updated_cues
