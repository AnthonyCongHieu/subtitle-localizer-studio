from __future__ import annotations

from typing import Any, List, Optional
import re
import os
import sys
from pathlib import Path
from importlib import metadata
import numpy as np

from subtitle_localizer.domain.models import ModelDescriptorV1, OcrObservationV1
from subtitle_localizer.ocr.base import OcrProvider
from subtitle_localizer.ocr.preprocessing import build_ocr_candidates


def _is_chinese_or_non_latin(text: str) -> bool:
    if not re.search(r"[A-Za-z]", text) or re.search(r"[\u3400-\u4dbf\u4e00-\u9fff]", text):
        return True
    # An x between numeric operands is multiplication, not an English subtitle.
    return re.fullmatch(
        r"\s*\d+(?:\.\d+)?\s*[xX×*]\s*\d+(?:\.\d+)?\s*=\s*\d+(?:\.\d+)?[,.，。…]*\s*",
        text,
    ) is not None


def _rectangle(box: Any) -> List[float]:
    points = np.asarray(box, dtype=float)
    if points.shape not in ((4,), (4, 2)) or not np.isfinite(points).all():
        raise RuntimeError("RapidOCR returned an invalid text box")
    if points.shape == (4,):
        return points.tolist()
    return [float(points[:, 0].min()), float(points[:, 1].min()),
            float(points[:, 0].max()), float(points[:, 1].max())]


def _has_verified_han_edge(longer: str, shorter: str) -> bool:
    if len(longer) != len(shorter) + 1:
        return False
    added = longer[:-len(shorter)] if longer.endswith(shorter) else longer[len(shorter):]
    return (
        (longer.startswith(shorter) or longer.endswith(shorter))
        and re.fullmatch(r"[\u3400-\u4dbf\u4e00-\u9fff]", added) is not None
    )


def _prepare_windows_cuda_dlls() -> List[Any]:
    if sys.platform != "win32":
        return []
    directories = []
    for package in ("cuda_runtime", "cuda_nvrtc", "cublas", "cufft", "cudnn"):
        try:
            distribution = metadata.distribution(f"nvidia-{package.replace('_', '-')}-cu12")
        except metadata.PackageNotFoundError:
            continue
        directories.append(Path(distribution.locate_file(f"nvidia/{package}/bin")))
    if os.environ.get("CUDA_PATH"):
        directories.append(Path(os.environ["CUDA_PATH"]) / "bin")
    handles = []
    for directory in dict.fromkeys(directories):
        if not directory.is_dir():
            continue
        directory_string = str(directory.resolve())
        try:
            handles.append(os.add_dll_directory(directory_string))
        except OSError:
            for handle in handles:
                handle.close()
            raise
        # cuDNN loads additional engines during inference using legacy LoadLibrary.
        # Keep these trusted paths in this process (never change the system PATH).
        current_path = os.environ.get("PATH", "")
        if directory_string not in current_path.split(os.pathsep):
            os.environ["PATH"] = directory_string + os.pathsep + current_path
    return handles


class RapidOcrProvider(OcrProvider):
    """Real OCR Engine sử dụng RapidOCR ONNX Runtime tối ưu cho CPU và GPU."""

    def __init__(self) -> None:
        self.engine: Optional[Any] = None
        self.is_loaded = False
        self.execution_provider: Optional[str] = None
        self._dll_handles: List[Any] = []

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
            import onnxruntime as ort
            from rapidocr_onnxruntime import RapidOCR

            use_cuda = "CUDAExecutionProvider" in ort.get_available_providers()
            if use_cuda:
                self._dll_handles = _prepare_windows_cuda_dlls()
                ort.preload_dlls(directory="")
            self.engine = RapidOCR(
                det_use_cuda=use_cuda, cls_use_cuda=use_cuda, rec_use_cuda=use_cuda
            )
            # RapidOCR can silently fall back even when CUDA is advertised.
            sessions = (
                self.engine.text_det.infer.session,
                self.engine.text_cls.infer.session,
                self.engine.text_rec.session.session,
            )
            expected = "CUDAExecutionProvider" if use_cuda else "CPUExecutionProvider"
            if any(session.get_providers()[0] != expected for session in sessions):
                raise RuntimeError(f"OCR sessions did not initialize with {expected}")
            if use_cuda:
                for session in sessions:
                    session.disable_fallback()
            self.execution_provider = expected
            self.is_loaded = True
        except Exception as e:
            self.unload()
            raise RuntimeError(f"Không thể khởi tạo RapidOCR: {e}")

    def unload(self) -> None:
        self.engine = None
        self.is_loaded = False
        self.execution_provider = None
        for handle in self._dll_handles:
            handle.close()
        self._dll_handles = []

    def _reread_line(self, image, box, text, score):
        """Verify a tight detector crop against padded, unthresholded pixels."""
        height, width = image.shape[:2]
        x1, y1 = max(0, int(box[0]) - 8), max(0, int(box[1]) - 2)
        x2, y2 = min(width, int(np.ceil(box[2])) + 8), min(height, int(np.ceil(box[3])) + 2)
        if x2 <= x1 or y2 <= y1:
            raise RuntimeError("RapidOCR returned an empty text box")
        reread, _ = self.engine(image[y1:y2, x1:x2], use_det=False, use_cls=False)
        if reread and len(reread) == 1:
            new_text, new_score = str(reread[0][0]).strip(), float(reread[0][1])
            # Do not rewrite interior characters or delete detected text.
            boundary_extension = (
                0 < len(new_text) - len(text) <= 2
                and (new_text.startswith(text) or new_text.endswith(text))
            )
            added = new_text[: -len(text)] if new_text.endswith(text) else new_text[len(text):]
            verified_han_edge = (
                boundary_extension
                and len(added) == 1
                and re.fullmatch(r"[\u3400-\u4dbf\u4e00-\u9fff]", added) is not None
                and new_score >= 0.90
            )
            if (new_text == text and new_score >= 0.95) or (
                boundary_extension
                and ((new_score >= 0.95 and new_score >= score - 0.02) or verified_han_edge)
            ):
                return (
                    new_text,
                    new_score,
                    [float(x1), float(y1), float(x2), float(y2)],
                    verified_han_edge,
                )
        return text, score, box, False

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
            candidate_texts: List[str] = []
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
                boxes: List[List[float]] = []
                verified_han_edge = False
                for item in result:
                    text = str(item[1]).strip()
                    score = float(item[2])
                    if language == "zh" and not _is_chinese_or_non_latin(text):
                        continue
                    if score >= 0.4 and text:
                        box = _rectangle(item[0])
                        text, score, box, line_verified_han_edge = self._reread_line(
                            img_data, box, text, score
                        )
                        verified_han_edge = verified_han_edge or line_verified_han_edge
                        lines.append(text)
                        confidences.append(score)
                        boxes.append(box)

                if not lines:
                    continue

                combined_text = " ".join(lines)
                candidate_texts.append(combined_text)
                average_confidence = sum(confidences) / len(confidences)
                candidate_observation = OcrObservationV1(
                    pts=pts,
                    boxes=boxes,
                    raw_text=combined_text,
                    normalized_text=combined_text,
                    confidence=average_confidence,
                    preprocessing_metadata={
                        "candidate_index": candidate_index,
                        "verified_han_edge": verified_han_edge,
                    },
                    model_metadata={
                        "engine": "rapidocr-onnx", "language": language,
                        "execution_provider": self.execution_provider,
                    },
                )
                if (
                    best_observation is None
                    or candidate_observation.confidence > best_observation.confidence
                    or (
                        candidate_observation.preprocessing_metadata["verified_han_edge"]
                        and _has_verified_han_edge(
                        candidate_observation.raw_text, best_observation.raw_text
                        )
                    )
                ):
                    best_observation = candidate_observation
            if best_observation is not None:
                best_observation.confidence = round(best_observation.confidence, 3)
                best_observation.preprocessing_metadata["candidate_disagreement"] = len(set(candidate_texts)) > 1
                best_observation.preprocessing_metadata["candidate_texts"] = candidate_texts
                observations.append(best_observation)
            elif inference_errors and len(inference_errors) == 3:
                raise RuntimeError(
                    "RapidOCR inference failed for every preprocessing candidate: "
                    + "; ".join(inference_errors)
                )

        return observations
