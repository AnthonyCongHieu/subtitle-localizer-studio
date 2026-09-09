from __future__ import annotations

from typing import Any, List, Optional
import json

import numpy as np

from subtitle_localizer.domain.models import ModelDescriptorV1, OcrObservationV1
from subtitle_localizer.ocr.base import OcrProvider


class PaddleOcrAdapter(OcrProvider):
    """Adapter tích hợp PaddleOCR v6 / v5 an toàn."""

    def __init__(self, model_version: str = "v5", language: str = "ch") -> None:
        self.model_version = model_version
        self.language = language
        self.engine: Optional[Any] = None

    def get_descriptor(self) -> ModelDescriptorV1:
        return ModelDescriptorV1(
            id=f"paddleocr-{self.model_version}-{self.language}",
            source_url="https://github.com/PaddlePaddle/PaddleOCR",
            version_or_commit=self.model_version,
            # Model files are downloaded by PaddleOCR at runtime; no verified
            # PP-OCRv5 mobile artifact hash is bundled in this repository.
            sha256="0" * 64,
            format="paddle",
            license="Apache-2.0",
            languages=["zh", "ja", "ko", "en"],
            runtime="paddlepaddle",
            hardware_requirements={"min_vram_bytes": 2 * 1024 * 1024 * 1024},
        )

    def load(self) -> None:
        if self.engine is None:
            try:
                from paddleocr import PaddleOCR
                # PaddleOCR 3.x uses explicit PP-OCRv5 model names and the
                # predict() API. Keep a v2-compatible fallback for installed
                # legacy environments, but never hide initialization errors.
                if self.model_version.lower() in {"v5", "v5-mobile", "pp-ocrv5"}:
                    try:
                        self.engine = PaddleOCR(
                            text_detection_model_name="PP-OCRv5_mobile_det",
                            text_recognition_model_name="PP-OCRv5_mobile_rec",
                            lang=self.language,
                            device="gpu:0",
                            use_doc_orientation_classify=False,
                            use_doc_unwarping=False,
                            use_textline_orientation=False,
                        )
                    except TypeError:
                        self.engine = PaddleOCR(use_angle_cls=True, lang=self.language, show_log=False)
                else:
                    self.engine = PaddleOCR(use_angle_cls=True, lang=self.language, show_log=False)
            except ImportError as error:
                self.engine = None
                raise RuntimeError("PaddleOCR is not installed") from error

    @staticmethod
    def _prediction_parts(prediction: Any) -> tuple[list[Any], list[str], list[float]]:
        """Extract boxes/text/scores from PaddleOCR 3.x result objects."""
        if hasattr(prediction, "json"):
            prediction = prediction.json
        if isinstance(prediction, str):
            try:
                prediction = json.loads(prediction)
            except json.JSONDecodeError:
                return [], [], []
        if callable(prediction):
            prediction = prediction()
        if not isinstance(prediction, dict):
            return [], [], []
        boxes = prediction.get("rec_boxes")
        if boxes is None:
            boxes = prediction.get("dt_polys")
        texts = prediction.get("rec_texts")
        scores = prediction.get("rec_scores")
        boxes = [] if boxes is None else boxes
        texts = [] if texts is None else texts
        scores = [] if scores is None else scores
        return list(boxes), [str(t) for t in texts], [float(s) for s in scores]

    def unload(self) -> None:
        self.engine = None

    def recognize(
        self,
        crops: List[Any],
        pts_list: List[float],
        language: str = "zh",
    ) -> List[OcrObservationV1]:
        if self.engine is None:
            raise RuntimeError("PaddleOCR engine is not loaded")

        results: List[OcrObservationV1] = []
        for crop, pts in zip(crops, pts_list):
            try:
                if hasattr(self.engine, "predict"):
                    predictions = self.engine.predict(
                        crop,
                        use_doc_orientation_classify=False,
                        use_doc_unwarping=False,
                        use_textline_orientation=False,
                    )
                    boxes: List[List[float]] = []
                    lines: List[str] = []
                    scores: List[float] = []
                    for prediction in predictions or []:
                        pred_boxes, pred_texts, pred_scores = self._prediction_parts(prediction)
                        for index, text in enumerate(pred_texts):
                            lines.append(text.strip())
                            scores.append(pred_scores[index] if index < len(pred_scores) else 0.0)
                            if index < len(pred_boxes):
                                box = pred_boxes[index]
                                points = np.asarray(box, dtype=float)
                                if points.shape == (4,):
                                    boxes.append(points.tolist())
                                elif points.ndim == 2 and points.shape[1] == 2:
                                    boxes.append([
                                        float(points[:, 0].min()), float(points[:, 1].min()),
                                        float(points[:, 0].max()), float(points[:, 1].max()),
                                    ])
                    full_text = " ".join(t for t in lines if t)
                    avg_conf = (sum(scores) / len(scores)) if scores else 0.0
                    results.append(OcrObservationV1(pts=pts, boxes=boxes, raw_text=full_text, normalized_text=full_text.strip(), confidence=round(avg_conf, 3)))
                    continue

                ocr_res = self.engine.ocr(crop, cls=True)
                lines = []
                conf_sum = 0.0
                count = 0
                for line in (ocr_res[0] if ocr_res and ocr_res[0] else []):
                    text, conf = line[1]
                    lines.append(text)
                    conf_sum += conf
                    count += 1
                full_text = " ".join(lines)
                avg_conf = (conf_sum / count) if count > 0 else 0.0
                results.append(
                    OcrObservationV1(
                        pts=pts,
                        raw_text=full_text,
                        normalized_text=full_text.strip(),
                        confidence=round(avg_conf, 3),
                    )
                )
            except Exception as error:
                # Do not convert an engine/runtime failure into an empty
                # observation: the worker must be able to activate its
                # configured fallback backend. Malformed/empty model output
                # is handled as a valid zero-confidence observation above.
                raise RuntimeError(f"PaddleOCR inference failed at pts={pts}: {error}") from error

        return results
