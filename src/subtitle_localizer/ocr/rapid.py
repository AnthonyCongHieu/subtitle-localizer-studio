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
    if re.fullmatch(r"\s*\d+[,.，。]*\s*", text):
        return False
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
            if hasattr(self.engine, "text_det"):
                self.engine.text_det.limit_type = "max"
                self.engine.text_det.limit_side_len = 640
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

    def _is_duplicate_subtitle(
        self,
        prev_observation: Optional[OcrObservationV1],
        prev_img: np.ndarray,
        curr_img: np.ndarray,
        diff_threshold: float,
    ) -> bool:
        """Kiểm tra xem phụ đề khung hình hiện tại có trùng khớp với khung hình trước hay không."""
        if prev_img is None or prev_img.shape != curr_img.shape:
            return False
        import cv2

        # 1. So sánh toàn frame cho khung hình tổng hợp / hoàn toàn tĩnh
        diff = float(np.mean(cv2.absdiff(curr_img, prev_img)))
        if diff < diff_threshold:
            return True

        # 2. So sánh ROI chữ cho video thực tế có nền chuyển động
        if prev_observation is None or not prev_observation.boxes:
            return False

        h, w = curr_img.shape[:2]
        matched_boxes = 0
        valid_boxes = 0

        for box in prev_observation.boxes:
            x1, y1 = max(0, int(box[0])), max(0, int(box[1]))
            x2, y2 = min(w, int(np.ceil(box[2]))), min(h, int(np.ceil(box[3])))
            if (x2 - x1) < 8 or (y2 - y1) < 4:
                continue
            valid_boxes += 1
            p_prev = prev_img[y1:y2, x1:x2]
            p_curr = curr_img[y1:y2, x1:x2]
            g_prev = cv2.cvtColor(p_prev, cv2.COLOR_BGR2GRAY) if p_prev.ndim == 3 else p_prev
            g_curr = cv2.cvtColor(p_curr, cv2.COLOR_BGR2GRAY) if p_curr.ndim == 3 else p_curr

            box_diff = float(np.mean(cv2.absdiff(g_curr, g_prev)))
            if box_diff < diff_threshold:
                matched_boxes += 1
                continue

            # A. Kiểm tra IoU mặt nạ chữ độ sáng cao
            m_prev = (g_prev >= 195).astype(np.uint8)
            m_curr = (g_curr >= 195).astype(np.uint8)
            union = int(np.sum((m_prev == 1) | (m_curr == 1)))
            if union > 30:
                iou = float(np.sum((m_prev == 1) & (m_curr == 1))) / union
                if iou >= 0.60:
                    matched_boxes += 1
                    continue
                if iou < 0.40:
                    continue

            # B. Đối sánh tương quan chuẩn hóa cho chữ không phải màu trắng
            if box_diff < 30.0 and float(np.std(g_curr)) > 5.0 and float(np.std(g_prev)) > 5.0:
                try:
                    res = float(cv2.matchTemplate(g_curr, g_prev, cv2.TM_CCOEFF_NORMED)[0][0])
                    if res >= 0.78:
                        matched_boxes += 1
                except Exception:
                    pass

        return valid_boxes > 0 and matched_boxes == valid_boxes

    def recognize(
        self,
        crops: List[Any],
        pts_list: List[float],
        language: str = "zh",
        progress_callback: Optional[Any] = None,
        diff_threshold: float = 1.5,
    ) -> List[OcrObservationV1]:
        if not self.is_loaded or self.engine is None:
            self.load()

        observations: List[OcrObservationV1] = []
        total_crops = len(crops)
        prev_img_data: Optional[np.ndarray] = None
        prev_observation: Optional[OcrObservationV1] = None

        for idx, (crop_img, pts) in enumerate(zip(crops, pts_list)):
            if progress_callback is not None:
                try:
                    progress_callback(idx, total_crops)
                except Exception:
                    pass

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

            # Fast frame difference & duplicate subtitle check
            if diff_threshold > 0.0 and prev_img_data is not None:
                if self._is_duplicate_subtitle(prev_observation, prev_img_data, img_data, diff_threshold):
                    if prev_observation is not None:
                        dup = OcrObservationV1(
                            pts=pts,
                            boxes=[list(b) for b in prev_observation.boxes],
                            raw_text=prev_observation.raw_text,
                            normalized_text=prev_observation.normalized_text,
                            confidence=prev_observation.confidence,
                            preprocessing_metadata=dict(prev_observation.preprocessing_metadata),
                            model_metadata=dict(prev_observation.model_metadata),
                        )
                        observations.append(dup)
                    continue

            prev_img_data = img_data

            best_observation: Optional[OcrObservationV1] = None
            candidate_texts: List[str] = []
            inference_errors: List[str] = []
            candidates = build_ocr_candidates(img_data)
            for candidate_index, candidate in enumerate(candidates):
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
                    if score >= 0.75 and text:
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
                preserves_verified_best = (
                    best_observation is not None
                    and best_observation.preprocessing_metadata["verified_han_edge"]
                    and _has_verified_han_edge(
                        best_observation.raw_text, candidate_observation.raw_text
                    )
                )
                if (
                    best_observation is None
                    or (
                        candidate_observation.confidence > best_observation.confidence
                        and not preserves_verified_best
                    )
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
                prev_observation = best_observation
            elif inference_errors and len(inference_errors) == len(candidates):
                raise RuntimeError(
                    "RapidOCR inference failed for every preprocessing candidate: "
                    + "; ".join(inference_errors)
                )
            else:
                prev_observation = None

        if progress_callback is not None:
            try:
                progress_callback(total_crops, total_crops)
            except Exception:
                pass

        return observations
