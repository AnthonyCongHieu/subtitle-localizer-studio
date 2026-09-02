from __future__ import annotations

from typing import List

import cv2
import numpy as np


def build_ocr_candidates(crop: np.ndarray) -> List[np.ndarray]:
    """Build deterministic image variants for subtitle OCR selection."""
    if not isinstance(crop, np.ndarray) or crop.size == 0:
        raise ValueError("OCR crop must be a non-empty numpy image")

    if crop.ndim == 3:
        grayscale = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    elif crop.ndim == 2:
        grayscale = crop.copy()
    else:
        raise ValueError("OCR crop must be a grayscale or BGR image")

    contrast = cv2.normalize(grayscale, None, 0, 255, cv2.NORM_MINMAX)
    _, thresholded = cv2.threshold(
        contrast,
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )
    return [crop, contrast, thresholded]


def enhance_text_contrast(raw_bytes: bytes, width: int, height: int) -> bytes:
    """Tăng độ tương phản của crop ảnh để cải thiện tỷ lệ nhận dạng chữ nét mảnh."""
    if not raw_bytes:
        return b""
    # Thực hiện phép co dãn dải tương phản đơn giản
    min_val = min(raw_bytes)
    max_val = max(raw_bytes)
    if max_val == min_val:
        return raw_bytes

    scale = 255.0 / (max_val - min_val)
    return bytes(int((b - min_val) * scale) for b in raw_bytes)


def binarize_crop(grayscale_bytes: bytes, threshold: int = 128) -> bytes:
    """Nhị phân hóa ảnh đen trắng phục vụ OCR."""
    return bytes(255 if b >= threshold else 0 for b in grayscale_bytes)
