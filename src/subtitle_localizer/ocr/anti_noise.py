"""Cheap, deterministic gates for rejecting likely scene-text false positives.

The funnel is intentionally independent from an OCR engine so it can be used by
the sampler, a detector adapter, or tests without loading a model.
"""

from __future__ import annotations

from typing import Tuple

import cv2
import numpy as np


class AntiNoiseFunnel:
    """Five-tier subtitle prior (geometry, stroke, luminance and hash helpers).

    The class only makes a decision about the supplied crop.  Temporal cache
    ownership remains with the caller because a cache must also carry the OCR
    observation and its timestamp.
    """

    def __init__(
        self,
        ar_min: float = 0.88,
        h_max: int = 130,
        swt_cov_max: float = 0.40,
        lum_min: int = 135,
        dhash_thresh: int = 4,
    ) -> None:
        if ar_min < 0 or h_max <= 0 or swt_cov_max < 0 or not 0 <= lum_min <= 255:
            raise ValueError("Invalid anti-noise funnel thresholds")
        if dhash_thresh < 0:
            raise ValueError("dhash_thresh must be non-negative")
        self.ar_min = float(ar_min)
        self.h_max = int(h_max)
        self.swt_cov_max = float(swt_cov_max)
        self.lum_min = int(lum_min)
        self.dhash_thresh = int(dhash_thresh)

    def check_geometry(self, w: int, h: int) -> bool:
        """Reject empty, very tall, or implausibly narrow text boxes."""
        if w <= 0 or h <= 0 or h > self.h_max:
            return False
        return (float(w) / float(h)) >= self.ar_min

    @staticmethod
    def _gray(crop_bgr: np.ndarray) -> np.ndarray:
        if crop_bgr is None or not isinstance(crop_bgr, np.ndarray) or crop_bgr.size == 0:
            return np.empty((0, 0), dtype=np.uint8)
        if crop_bgr.ndim == 2:
            gray = crop_bgr
        elif crop_bgr.ndim == 3 and crop_bgr.shape[2] in (3, 4):
            gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
        else:
            raise ValueError("crop must be a grayscale or BGR/BGRA numpy array")
        if gray.dtype != np.uint8:
            gray = np.clip(gray, 0, 255).astype(np.uint8)
        return gray

    def compute_swt_cov(self, crop_bgr: np.ndarray) -> float:
        """Approximate stroke-width CoV using an Otsu mask and distance transform."""
        gray = self._gray(crop_bgr)
        if gray.size == 0:
            return 1.0
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        # Keep the minority polarity as foreground (subtitle strokes are usually sparse).
        if float(np.mean(binary)) > 127.0:
            binary = cv2.bitwise_not(binary)
        mask = (binary > 0).astype(np.uint8)
        dist = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
        # Estimate one width per connected stroke component.  Measuring every
        # filled pixel overweights large background blobs and rejects outlined
        # subtitles; trimmed component medians are substantially more stable.
        _, labels, _, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        widths = []
        for label in range(1, int(labels.max()) + 1):
            component = dist[labels == label]
            component = component[component > 0.5]
            if component.size >= 3:
                widths.append(float(np.median(component) * 2.0))
        if len(widths) >= 5:
            values = np.asarray(widths, dtype=np.float32)
            low, high = np.percentile(values, [10, 90])
            values = values[(values >= low) & (values <= high)]
        else:
            values = dist[dist > 0.5]
        if values.size < 15:
            return 0.30  # insufficient evidence: preserve recall for tiny glyphs
        mean = float(np.mean(values))
        if mean <= 1e-6:
            return 1.0
        return float(np.std(values) / mean)

    def check_subtitle_luminance(self, crop_bgr: np.ndarray) -> bool:
        """Require a bright, sufficiently contrasting subtitle core."""
        gray = self._gray(crop_bgr)
        if gray.size == 0:
            return False
        p90 = float(np.percentile(gray, 90))
        p10 = float(np.percentile(gray, 10))
        return p90 >= self.lum_min and (p90 - p10) >= 45.0

    def compute_stroke_mask_dhash(self, crop_bgr: np.ndarray) -> int:
        """Return a 64-bit dHash computed from the binarized stroke mask."""
        gray = self._gray(crop_bgr)
        if gray.size == 0:
            return 0
        _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        # Canonicalize polarity so dark-on-light and light-on-dark variants hash alike.
        if float(np.mean(mask)) > 127.0:
            mask = cv2.bitwise_not(mask)
        resized = cv2.resize(mask, (9, 8), interpolation=cv2.INTER_AREA)
        differences = resized[:, 1:] > resized[:, :-1]
        value = 0
        for bit in differences.ravel():
            value = (value << 1) | int(bool(bit))
        return value

    @staticmethod
    def hamming_distance(first: int, second: int) -> int:
        if first < 0 or second < 0:
            raise ValueError("Hashes must be non-negative")
        return (int(first) ^ int(second)).bit_count()

    def inspect_crop(self, crop_bgr: np.ndarray) -> Tuple[bool, str]:
        """Inspect one detected box using the production anti-noise gates."""
        if crop_bgr is None or not isinstance(crop_bgr, np.ndarray) or crop_bgr.size == 0:
            return False, "empty_crop"
        h, w = crop_bgr.shape[:2]
        if h < 10 or w < 16:
            return False, "too_small"
        return self.is_valid_candidate(crop_bgr, w, h)

    def is_valid_candidate(self, crop_bgr: np.ndarray, w: int, h: int) -> Tuple[bool, str]:
        if not self.check_geometry(w, h):
            return False, "geometry_rejected"
        if not self.check_subtitle_luminance(crop_bgr):
            return False, "luminance_rejected"
        cov = self.compute_swt_cov(crop_bgr)
        if cov > self.swt_cov_max:
            return False, f"swt_cov_rejected_{cov:.2f}"
        return True, "valid_subtitle"


class AntiNoiseFilter(AntiNoiseFunnel):
    """Production name for adaptive-band candidate inspection."""
