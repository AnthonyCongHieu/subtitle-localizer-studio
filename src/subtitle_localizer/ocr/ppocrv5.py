"""PP-OCRv5 recognition provider using ONNX Runtime dynamic batching."""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from typing import Any, List, Optional, Sequence, Tuple

import cv2
import numpy as np

from subtitle_localizer.domain.models import ModelDescriptorV1, OcrObservationV1
from subtitle_localizer.ocr.base import OcrProvider

logger = logging.getLogger(__name__)


class PPOCRv5Provider(OcrProvider):
    def __init__(
        self,
        model_tier: str = "mobile",
        model_path: str | Path | None = None,
        character_dict_path: str | Path | None = None,
        character_dict: Optional[Sequence[str]] = None,
        batch_size: int = 16,
        recognition_batch_size: Optional[int] = None,
        execution_providers: Optional[Sequence[str]] = None,
    ) -> None:
        if model_tier not in {"mobile", "server"}:
            raise ValueError("model_tier must be 'mobile' or 'server'")
        self.model_tier = model_tier
        self.model_path = Path(model_path) if model_path else None
        self.character_dict_path = Path(character_dict_path) if character_dict_path else None
        self.character_dict = self._prepare_dictionary(character_dict or [])
        self.batch_size = max(1, min(64, int(recognition_batch_size if recognition_batch_size is not None else batch_size)))
        self.execution_providers = list(execution_providers) if execution_providers else None
        self.session: Any = None
        self.execution_provider: Optional[str] = None
        self._is_loaded = False
        self._input_name: Optional[str] = None

    @property
    def is_loaded(self) -> bool:
        """Compatibility alias used by the existing providers/diagnostics."""
        return self._is_loaded

    @property
    def recognition_batch_size(self) -> int:
        return self.batch_size

    @recognition_batch_size.setter
    def recognition_batch_size(self, value: int) -> None:
        self.batch_size = max(1, min(64, int(value)))

    @staticmethod
    def _prepare_dictionary(values: Sequence[str]) -> List[str]:
        chars = [str(value) for value in values]
        if not chars:
            return []
        return chars if chars[0] == "" else [""] + chars + [" "]

    def _default_model_path(self) -> Path:
        root = Path(__file__).resolve().parents[3]
        filename = f"ppocrv5_{self.model_tier}_rec.onnx"
        env_dir = os.getenv("SUBTITLE_LOCALIZER_MODEL_DIR")
        return (Path(env_dir) if env_dir else root / "benchmarks" / "models") / filename

    def _default_dict_path(self) -> Path:
        root = Path(__file__).resolve().parents[3]
        filename = f"ppocrv5_{self.model_tier}_inference.yml"
        env_dir = os.getenv("SUBTITLE_LOCALIZER_MODEL_DIR")
        return (Path(env_dir) if env_dir else root / "benchmarks" / "models") / filename

    def _load_dictionary_file(self, path: Path) -> List[str]:
        try:
            import yaml
        except ImportError as exc:
            raise RuntimeError("PyYAML is required to load PP-OCRv5 character dictionaries") from exc
        if not path.is_file():
            raise FileNotFoundError(f"PP-OCRv5 character dictionary does not exist: {path}")
        with path.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
        values = ((data.get("PostProcess") or {}).get("character_dict") or [])
        if not isinstance(values, list) or not values:
            raise ValueError(f"No PostProcess.character_dict in {path}")
        return self._prepare_dictionary(values)

    def _resolve_model_path(self) -> Path:
        path = self.model_path or self._default_model_path()
        if not path.is_file():
            raise FileNotFoundError(f"PP-OCRv5 model does not exist: {path}")
        return path

    def get_descriptor(self) -> ModelDescriptorV1:
        path = self.model_path or self._default_model_path()
        digest = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else "0" * 64
        return ModelDescriptorV1(
            id=f"ppocrv5-{self.model_tier}-rec-onnx",
            source_url="https://github.com/PaddlePaddle/PaddleOCR",
            version_or_commit="PP-OCRv5",
            sha256=digest,
            format="onnx",
            license="Apache-2.0",
            languages=["zh", "en", "vi", "ja", "ko"],
            runtime="onnxruntime",
            hardware_requirements={"recommended_execution_provider": "CUDAExecutionProvider"},
        )

    def load(self) -> None:
        if self._is_loaded and self.session is not None:
            return
        model_path = self._resolve_model_path()
        if not self.character_dict:
            self.character_dict = self._load_dictionary_file(self.character_dict_path or self._default_dict_path())
        import onnxruntime as ort

        available = ort.get_available_providers()
        providers = self.execution_providers or (
            ["CUDAExecutionProvider", "CPUExecutionProvider"]
            if "CUDAExecutionProvider" in available
            else ["CPUExecutionProvider"]
        )
        providers = [name for name in providers if name in available]
        if not providers:
            providers = ["CPUExecutionProvider"]
        candidates = [providers]
        if providers != ["CPUExecutionProvider"] and "CPUExecutionProvider" in available:
            candidates.append(["CPUExecutionProvider"])
        last_error: Optional[Exception] = None
        for candidate in candidates:
            try:
                session = ort.InferenceSession(str(model_path), providers=candidate)
                self.session = session
                break
            except Exception as exc:
                last_error = exc
                logger.warning("PP-OCRv5 provider initialization failed for %s: %s", candidate, exc)
        if self.session is None:
            raise RuntimeError(f"Unable to initialize PP-OCRv5 ONNX Runtime: {last_error}") from last_error
        get_providers = getattr(self.session, "get_providers", None)
        actual = list(get_providers()) if callable(get_providers) else []
        self.execution_provider = actual[0] if actual else candidates[-1][0]
        self._input_name = self.session.get_inputs()[0].name
        self._is_loaded = True

    def unload(self) -> None:
        self.session = None
        self._input_name = None
        self.execution_provider = None
        self._is_loaded = False

    def runtime_status(self) -> dict[str, Any]:
        return {
            "loaded": self._is_loaded,
            "model_tier": self.model_tier,
            "execution_provider": self.execution_provider,
            "batch_size": self.batch_size,
            "model_path": str(self.model_path or self._default_model_path()),
        }

    @staticmethod
    def _as_bgr(crop: Any) -> np.ndarray:
        if isinstance(crop, np.ndarray):
            image = crop
        elif isinstance(crop, (bytes, bytearray, memoryview)):
            image = cv2.imdecode(np.frombuffer(crop, dtype=np.uint8), cv2.IMREAD_COLOR)
        else:
            raise TypeError(f"Unsupported OCR crop type: {type(crop).__name__}")
        if image is None or image.size == 0 or image.ndim not in (2, 3):
            raise ValueError("OCR crop must contain pixels")
        return image

    def _preprocess_crop(self, crop: Any, target_h: int = 48, max_w: int = 640) -> np.ndarray:
        image = self._as_bgr(crop)
        if image.ndim == 2:
            image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
        height, width = image.shape[:2]
        target_w = max(32, min(max_w, int(np.ceil(target_h * width / max(1, height) / 32.0) * 32)))
        resized = cv2.resize(image, (target_w, target_h), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32)
        normalized = (rgb / 255.0 - 0.5) / 0.5
        return np.transpose(normalized, (2, 0, 1)).astype(np.float32, copy=False)

    def _decode_ctc(self, predictions: np.ndarray) -> List[Tuple[str, float]]:
        values = np.asarray(predictions)
        if values.ndim != 3:
            raise ValueError("PP-OCRv5 output must have shape [batch, time, classes]")
        results: List[Tuple[str, float]] = []
        for sequence in values:
            # ONNX exports may contain logits or probabilities.
            if float(np.min(sequence)) < 0.0 or float(np.max(sequence)) > 1.0:
                shifted = sequence - np.max(sequence, axis=-1, keepdims=True)
                probs = np.exp(shifted)
                probs /= np.sum(probs, axis=-1, keepdims=True)
            else:
                probs = np.clip(sequence, 0.0, 1.0)
            indices = np.argmax(probs, axis=-1)
            scores = np.max(probs, axis=-1)
            chars: List[str] = []
            selected: List[float] = []
            previous = 0
            for index, score in zip(indices.tolist(), scores.tolist()):
                if index != 0 and index != previous and index < len(self.character_dict):
                    chars.append(self.character_dict[index])
                    selected.append(float(score))
                previous = index
            results.append(("".join(chars).strip(), float(np.mean(selected)) if selected else 0.0))
        return results

    def recognize(
        self,
        crops: List[Any],
        pts_list: List[float],
        language: str = "zh",
        progress_callback: Optional[Any] = None,
        **_kwargs: Any,
    ) -> List[OcrObservationV1]:
        if len(crops) != len(pts_list):
            raise ValueError("crops and pts_list must have equal lengths")
        if not crops:
            return []
        if not self._is_loaded or self.session is None:
            self.load()
        assert self.session is not None and self._input_name is not None
        observations: List[OcrObservationV1] = []
        retried_on_cpu = False
        for start in range(0, len(crops), self.batch_size):
            batch_crops = crops[start : start + self.batch_size]
            tensors = [self._preprocess_crop(crop) for crop in batch_crops]
            max_width = max(int(tensor.shape[2]) for tensor in tensors)
            batch = np.full((len(tensors), 3, 48, max_width), -1.0, dtype=np.float32)
            for index, tensor in enumerate(tensors):
                batch[index, :, :, : tensor.shape[2]] = tensor
            try:
                predictions = self.session.run(None, {self._input_name: batch})[0]
            except Exception as infer_error:
                if retried_on_cpu or self.execution_provider == "CPUExecutionProvider":
                    raise RuntimeError(f"PP-OCRv5 inference failed: {infer_error}") from infer_error
                logger.warning("PP-OCRv5 inference failed on %s; retrying on CPU: %s", self.execution_provider, infer_error)
                self.unload()
                self.execution_providers = ["CPUExecutionProvider"]
                self.load()
                retried_on_cpu = True
                assert self.session is not None and self._input_name is not None
                predictions = self.session.run(None, {self._input_name: batch})[0]
            for offset, (text, confidence) in enumerate(self._decode_ctc(predictions)):
                if text and confidence >= 0.40:
                    height, width = self._as_bgr(batch_crops[offset]).shape[:2]
                    observations.append(
                        OcrObservationV1(
                            pts=float(pts_list[start + offset]),
                            boxes=[[0.0, 0.0, float(width), float(height)]],
                            raw_text=text,
                            normalized_text=text,
                            confidence=round(confidence, 4),
                            model_metadata={
                                "engine": f"ppocrv5-{self.model_tier}-rec-onnx",
                                "language": language,
                                "execution_provider": self.execution_provider,
                            },
                        )
                    )
            if progress_callback is not None:
                progress_callback(min(len(crops), start + len(batch_crops)), len(crops))
        return observations
