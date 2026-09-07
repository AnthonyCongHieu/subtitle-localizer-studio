from __future__ import annotations

from typing import List

import cv2
import numpy as np


def build_ocr_candidates(crop: np.ndarray, include_advanced: bool = False) -> List[np.ndarray]:
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
    # White subtitle glyphs with a dark outline are common in hard-subbed video.
    # A fixed high-luminance mask removes bright scene signage that survives
    # global contrast normalization while retaining the subtitle cores.
    bright_subtitle = np.where(grayscale >= 200, 255, 0).astype(np.uint8)
    candidates = [crop, contrast, thresholded, bright_subtitle]

    if include_advanced:
        # 1. CLAHE (Contrast Limited Adaptive Histogram Equalization - Zuiderveld, 1994):
        # Tăng tương phản thích nghi cục bộ, bóc tách chữ khỏi nền phức tạp / ánh sáng gradient.
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        clahe_img = clahe.apply(grayscale)

        # 2. Unsharp Masking (USM):
        # Làm sắc nét viền tần số cao, tách các nét chữ Hán/Latin dày đặc, chống dính nét.
        gaussian = cv2.GaussianBlur(grayscale, (0, 0), sigmaX=1.5)
        unsharp_img = cv2.addWeighted(grayscale, 1.5, gaussian, -0.5, 0)
        candidates.extend([clahe_img, unsharp_img])

    return candidates


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
