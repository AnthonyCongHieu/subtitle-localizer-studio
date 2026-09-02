from __future__ import annotations

from typing import Any, List, Optional
import numpy as np

from subtitle_localizer.domain.models import ModelDescriptorV1, OcrObservationV1
from subtitle_localizer.ocr.base import OcrProvider
from subtitle_localizer.ocr.preprocessing import build_ocr_candidates


class RapidOcrProvider(OcrProvider):
    """Real OCR Engine sử dụng RapidOCR ONNX Runtime tối ưu cho CPU và GPU."""

    def __init__(self) -> None:
        self.engine: Optional[Any] = None
        self.is_loaded = False

    def get_descriptor(self) -> ModelDescriptorV1:
        return ModelDescriptorV1(
            id="rapidocr-onnx",
            source_url="https://github.com/RapidAI/RapidOCR",
            version_or_commit="v1.4.4",
            sha256="0" * 64,
            format="onnx",
            license="Apache-2.0",
            languages=["zh", "ja", "ko", "en"],
            runtime="onnxruntime",
        )

    def load(self) -> None:
        if self.is_loaded and self.engine is not None:
            return
        try:
            from rapidocr_onnxruntime import RapidOCR
            self.engine = RapidOCR()
            self.is_loaded = True
        except Exception as e:
            self.engine = None
            self.is_loaded = False
            raise RuntimeError(f"Không thể khởi tạo RapidOCR: {e}")

    def unload(self) -> None:
        self.engine = None
        self.is_loaded = False

    def recognize(
        self,
        crops: List[Any],
        pts_list: List[float],
        language: str = "zh",
    ) -> List[OcrObservationV1]:
        if not self.is_loaded or self.engine is None:
            self.load()

        observations: List[OcrObservationV1] = []

        for crop_img, pts in zip(crops, pts_list):
            if crop_img is None:
                raise RuntimeError("RapidOCR received no decoded image")

            if isinstance(crop_img, np.ndarray):
                img_data = crop_img
            elif isinstance(crop_img, bytes):
                import cv2

                encoded = np.frombuffer(crop_img, np.uint8)
                img_data = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
            else:
                raise RuntimeError(
                    f"RapidOCR received unsupported image type: {type(crop_img).__name__}"
                )

            if img_data is None or img_data.size == 0:
                raise RuntimeError("RapidOCR requires a valid decoded image")

            best_observation: Optional[OcrObservationV1] = None
            inference_errors: List[str] = []
            for candidate_index, candidate in enumerate(build_ocr_candidates(img_data)):
                try:
                    result, _ = self.engine(candidate)
                except Exception as error:
                    inference_errors.append(str(error))
                    continue
                if not result:
                    continue

                lines: List[str] = []
                confidences: List[float] = []
                for item in result:
                    text = str(item[1]).strip()
                    score = float(item[2])
                    if score >= 0.4 and text:
                        lines.append(text)
                        confidences.append(score)

                if not lines:
                    continue

                combined_text = " ".join(lines)
                average_confidence = sum(confidences) / len(confidences)
                candidate_observation = OcrObservationV1(
                    pts=pts,
                    boxes=[[0.0, 0.0, 1.0, 1.0]],
                    raw_text=combined_text,
                    normalized_text=combined_text,
                    confidence=round(average_confidence, 3),
                    preprocessing_metadata={"candidate_index": candidate_index},
                    model_metadata={"engine": "rapidocr-onnx", "language": language},
                )
                if (
                    best_observation is None
                    or candidate_observation.confidence > best_observation.confidence
                ):
                    best_observation = candidate_observation

            if best_observation is not None:
                observations.append(best_observation)
            elif inference_errors and len(inference_errors) == 3:
                raise RuntimeError(
                    "RapidOCR inference failed for every preprocessing candidate: "
                    + "; ".join(inference_errors)
                )

        return observations
