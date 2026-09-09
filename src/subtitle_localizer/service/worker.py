from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from subtitle_localizer.detector.boundary_refiner import FrameAccurateBoundaryRefiner
from subtitle_localizer.detector.roi import compute_tight_roi_from_observations, propose_default_roi
from subtitle_localizer.detector.sampler import AdaptiveFrameSampler, merge_voice_intervals
from subtitle_localizer.domain.models import StageRunV1, SubtitleCueV1
from subtitle_localizer.ocr.registry import OcrRegistry
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.reconstruction.builder import CueReconstructor
from subtitle_localizer.service.pipeline_settings import get_global_pipeline_settings, merge_pipeline_settings
from subtitle_localizer.translation.registry import TranslationRegistry


class BackgroundWorker:
    """Xử lý các tác vụ nền OCR, Cue Reconstruction, Translation và Export."""

    def __init__(self, repo: ProjectRepository) -> None:
        self.repo = repo
        self.ocr_registry = OcrRegistry()
        self.translation_registry = TranslationRegistry()
        self.reconstructor = CueReconstructor(min_cue_duration=0.20, lead_in=0.06, lead_out=0.06)
        self.boundary_refiner = FrameAccurateBoundaryRefiner()
        self.sampler = AdaptiveFrameSampler(sample_fps=2.0, diff_threshold=3.5)
        self._cancelled_projects: set[str] = set()
        self._cancel_lock = threading.Lock()

    def cancel_project(self, project_id: str) -> None:
        with self._cancel_lock:
            self._cancelled_projects.add(project_id)

    def is_cancelled(self, project_id: str) -> bool:
        with self._cancel_lock:
            return project_id in self._cancelled_projects

    def clear_cancel(self, project_id: str) -> None:
        with self._cancel_lock:
            self._cancelled_projects.discard(project_id)

    @staticmethod
    def _resolve_primary_backend(
        engine_name: str,
        configured_backend: str,
        model_tier: str = "mobile",
    ) -> str:
        """Resolve the persisted OCR profile to a concrete registry key.

        ``auto`` is the breakthrough profile exposed by the web UI.  It uses
        PP-OCRv5 (and therefore the hardware-tuned batch controller) as the
        preferred backend; the existing worker load path still falls back to
        RapidOCR when the PP-OCRv5 assets/runtime are unavailable.
        """
        primary = configured_backend or engine_name or "rapidocr"
        if engine_name == "ppocrv5" and primary == "rapidocr":
            primary = "ppocrv5"
        # Preserve the pre-profile explicit Paddle setting for old projects.
        if engine_name == "paddle" and primary == "rapidocr":
            primary = "paddle"
        if primary == "auto":
            primary = "ppocrv5"
        if primary == "ppocrv5":
            normalized_tier = model_tier if model_tier in {"mobile", "server"} else "mobile"
            primary = f"ppocrv5-{normalized_tier}"
        return primary

    @staticmethod
    def _prepare_ppocrv5_inputs(
        crops: list,
        pts_list: list[float],
        detector_provider,
        anti_noise=None,
    ) -> tuple[list, list[float]]:
        """Detect line boxes with RapidOCR before PP-OCRv5 recognition.

        PP-OCRv5 assets in this repository are recognition-only.  Feeding a
        complete subtitle-band ROI directly to that model squeezes multiple
        lines into one tensor and loses text.  This bridge keeps DBNet as the
        detector while allowing PP-OCRv5 to provide batched recognition.
        """
        import cv2
        import numpy as np

        if not getattr(detector_provider, "engine", None):
            detector_provider.load()
        engine = detector_provider.engine
        line_crops, line_pts = [], []
        for image, pts in zip(crops, pts_list):
            result, _ = engine(image, use_det=True, use_cls=False, use_rec=False)
            if not result:
                continue
            for item in result:
                try:
                    raw_item = np.asarray(item, dtype=float)
                except (TypeError, ValueError):
                    raw_item = np.asarray([], dtype=float)
                try:
                    polygon = raw_item if raw_item.shape == (4, 2) else np.asarray(item[0], dtype=float)
                except (TypeError, ValueError, IndexError):
                    continue
                if polygon.shape != (4, 2) or not np.isfinite(polygon).all():
                    continue
                height, width = image.shape[:2]
                x1 = max(0, int(np.floor(polygon[:, 0].min())))
                y1 = max(0, int(np.floor(polygon[:, 1].min())))
                x2 = min(width, int(np.ceil(polygon[:, 0].max())) + 1)
                y2 = min(height, int(np.ceil(polygon[:, 1].max())) + 1)
                if x2 <= x1 or y2 <= y1:
                    continue
                line = np.ascontiguousarray(image[y1:y2, x1:x2])
                if anti_noise is not None:
                    valid, _reason = anti_noise.is_valid_candidate(line, x2 - x1, y2 - y1)
                    if not valid:
                        continue
                line_crops.append(line)
                line_pts.append(float(pts))
        return line_crops, line_pts

    @staticmethod
    def _detect_language(text: str) -> str:
        """Tự động phân tích và xác định ngôn ngữ từ văn bản phụ đề."""
        if not text:
            return "en"
        zh_cnt = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
        ja_cnt = sum(1 for c in text if ('\u3040' <= c <= '\u309f') or ('\u30a0' <= c <= '\u30ff'))
        ko_cnt = sum(1 for c in text if '\uac00' <= c <= '\ud7af')
        vi_vowels = set("áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ")
        vi_cnt = sum(1 for c in text if c in vi_vowels)

        if ja_cnt > 0:
            return "ja"
        if ko_cnt > 0:
            return "ko"
        if zh_cnt > 0:
            return "zh"
        if vi_cnt > 0:
            return "vi"
        return "en"

    def run_pipeline_synchronous(
        self,
        project_id: str,
        max_duration_seconds: Optional[float] = None,
        ocr_only: bool = False,
    ) -> bool:
        """Thực thi pipeline hoàn chỉnh cho project với OCR và Dịch thực tế."""
        manifest = self.repo.get_project(project_id)
        if not manifest:
            return False

        self.clear_cancel(project_id)
        if self.is_cancelled(project_id):
            return False

        ocr_provider = None
        translator = None
        try:
            # Stage 1: Detector & Sampler
            stage1 = StageRunV1(stage_name="detector", status="running", progress=0.1)
            self.repo.save_stage_run(project_id, stage1)

            if self.is_cancelled(project_id):
                raise InterruptedError("Tiến trình đã bị người dùng dừng / hủy.")

            # Kiểm tra xem file video có tồn tại trên đĩa không
            video_path = Path(manifest.source_video_path)
            if not video_path.exists() or not video_path.is_file():
                raise FileNotFoundError(f"Video file does not exist: {video_path}")

            # Đề xuất ROI nếu chưa có hoặc cập nhật ROI lỗi thời theo hình học video
            import cv2
            cap = cv2.VideoCapture(str(video_path))
            vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
            vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
            cap.release()

            is_portrait = vh > vw
            if not manifest.regions:
                default_roi = propose_default_roi(vw, vh, is_portrait=is_portrait)
                manifest.regions.append(default_roi)
                self.repo.save_project(manifest)
            else:
                r = manifest.regions[0]
                # Chỉ tự động nắn chỉnh nếu người dùng chưa từng tùy chỉnh (region_id vẫn là roi-default)
                if r.region_id == "roi-default" and (
                    (is_portrait and (r.y + r.height <= 0.89 or (r.y == 0.72 and r.height == 0.16) or r.y >= 0.68))
                    or (not is_portrait and r.y == 0.72 and r.height == 0.16)
                ):
                    manifest.regions = [propose_default_roi(vw, vh, is_portrait=is_portrait)]
                    self.repo.save_project(manifest)

            active_roi = manifest.regions[0] if manifest.regions else None
            roi_tuple = (active_roi.x, active_roi.y, active_roi.width, active_roi.height) if active_roi else None
            rois_tuples = [
                (r.x, r.y, r.width, r.height)
                for r in manifest.regions
                if r.is_valid()
            ] if manifest.regions else None

            # Hợp nhất cấu hình toàn cục với cấu hình ghi đè riêng của tập này (nếu có)
            pipeline_settings = merge_pipeline_settings(overrides=manifest.custom_pipeline_settings)

            cues: List[SubtitleCueV1] = []
            cloud_cues: List[SubtitleCueV1] = []
            effective_source_lang = manifest.source_language

            auto_fallback_ocr = getattr(pipeline_settings.ocr, "auto_fallback", True)
            api_fusion_mode = getattr(pipeline_settings.ocr, "api_fusion_mode", "hybrid_ocr")

            if getattr(pipeline_settings.ocr, "mode", "api") == "api":
                provider = getattr(pipeline_settings.ocr, "api_provider", "capcut")
                stage_api = StageRunV1(
                    stage_name="cloud_extraction",
                    status="running",
                    progress=0.2,
                    metrics={"label": f"Bắt đầu trích xuất phụ đề qua Đám Mây ({provider.upper()})..."},
                )
                if not self.is_cancelled(project_id):
                    self.repo.save_stage_run(project_id, stage_api)

                def _on_cloud_progress(pct: float, msg: str) -> None:
                    if self.is_cancelled(project_id):
                        raise InterruptedError("Tiến trình đã bị người dùng dừng / hủy.")
                    st = StageRunV1(
                        stage_name="cloud_extraction",
                        status="running",
                        progress=round(0.2 + 0.55 * pct, 2),
                        metrics={"label": msg},
                    )
                    if not self.is_cancelled(project_id):
                        self.repo.save_stage_run(project_id, st)

                try:
                    if provider == "capcut":
                        from subtitle_localizer.cloud.capcut_bridge import CapCutBridgeExtractor
                        extractor = CapCutBridgeExtractor(
                            mode=getattr(pipeline_settings.ocr, "capcut_mode", "desktop_draft"),
                            session_token=getattr(pipeline_settings.ocr, "capcut_session_token", ""),
                            endpoint=getattr(pipeline_settings.ocr, "capcut_api_endpoint", "https://editor-api-sg.capcutapi.com"),
                        )
                        cloud_cues = extractor.extract_cues(
                            video_path=video_path,
                            source_lang=manifest.source_language,
                            draft_id=getattr(pipeline_settings.ocr, "capcut_draft_id", None) or None,
                            progress_callback=_on_cloud_progress,
                        )
                    elif provider == "gemini":
                        from subtitle_localizer.cloud.gemini_vlm import GeminiVideoVlmExtractor
                        extractor = GeminiVideoVlmExtractor(
                            model_name=getattr(pipeline_settings.ocr, "vlm_model", "gemini-2.5-flash")
                        )
                        cloud_cues = extractor.extract_cues(
                            video_path=video_path,
                            source_lang=manifest.source_language,
                            progress_callback=_on_cloud_progress,
                        )
                    else:
                        raise ValueError(f"Nhà cung cấp Cloud API không được hỗ trợ: {provider}")

                    if cloud_cues:
                        stage_api_done = StageRunV1(
                            stage_name="cloud_extraction",
                            status="completed",
                            progress=0.8,
                            metrics={"label": f"Hoàn tất trích xuất {len(cloud_cues)} câu phụ đề qua Cloud ({provider.upper()})!", "cues_count": len(cloud_cues)},
                        )
                        self.repo.save_stage_run(project_id, stage_api_done)
                    else:
                        logging.getLogger(__name__).warning(f"Cloud API ({provider}) không trích xuất được câu nào.")
                except Exception as ex_cloud:
                    logging.getLogger(__name__).warning("Cloud API (%s) trích xuất gặp sự cố: %s", provider, ex_cloud)
                    if not auto_fallback_ocr:
                        raise

                if cloud_cues and effective_source_lang == "auto":
                    effective_source_lang = self._detect_language(" ".join(c.source_text for c in cloud_cues))
                    manifest.source_language = effective_source_lang
                    self.repo.save_project(manifest)

                # Quyết định dung hợp hay dùng trực tiếp cues từ cloud:
                # Mode 2 (CapCut API) mặc định dung hợp với Local OCR (tương đương Mode 3 trong benchmark).
                # Với Gemini hoặc khi api_fusion_mode == 'api_only': dùng
                # trực tiếp cloud cues.
                if cloud_cues:
                    # Hybrid CapCut mode attempts voice-gated local OCR.  The
                    # sampler fails closed for undecodable inputs, preserving
                    # cloud cues while still allowing mocked/alternate
                    # stream providers to supply local crops.
                    if provider == "capcut" and api_fusion_mode == "hybrid_ocr":
                        # Tiếp tục xuống khối Local OCR bên dưới để lấy Ground Truth và dung hợp
                        pass
                    else:
                        cues = cloud_cues

            if not cues:
                if getattr(pipeline_settings.ocr, "mode", "api") == "api" and not cloud_cues and auto_fallback_ocr:
                    stage_fb = StageRunV1(
                        stage_name="cloud_extraction",
                        status="running",
                        progress=0.2,
                        metrics={"label": "Cloud API chưa sẵn sàng. Tự động chuyển cứu hộ sang Local OCR (GPU/CPU)..."},
                    )
                    if not self.is_cancelled(project_id):
                        self.repo.save_stage_run(project_id, stage_fb)

                if self.is_cancelled(project_id):
                    raise InterruptedError("Tiến trình đã bị người dùng dừng / hủy.")

                self.sampler.sample_fps = max(0.5, float(pipeline_settings.ocr.sample_fps))
                self.sampler.diff_threshold = float(pipeline_settings.ocr.diff_threshold)

                crops, pts_list = [], []
                # In hybrid CapCut mode the cloud transcript provides sparse
                # voice windows; sample only those windows before falling back
                # to a full ROI scan.  This keeps the API/worker fusion path
                # deterministic while avoiding unnecessary decoder work.
                if cloud_cues and api_fusion_mode == "hybrid_ocr":
                    voice_windows = merge_voice_intervals(
                        [(cue.start_pts, cue.end_pts) for cue in cloud_cues]
                    )
                    try:
                        stream = self.sampler.stream_voice_windows(
                            video_path=video_path,
                            voice_windows=voice_windows,
                            roi_norm=roi_tuple,
                            roi_norms=rois_tuples,
                            sample_fps=pipeline_settings.ocr.sample_fps,
                        )
                        for crop, pts in stream:
                            crops.append(crop)
                            pts_list.append(pts)
                    except RuntimeError as stream_error:
                        logging.getLogger(__name__).warning(
                            "Voice-gated sampling failed; preserving cloud cues: %s",
                            stream_error,
                        )
                use_nvdec = bool(getattr(pipeline_settings.ocr, "enable_nvdec_hwaccel", False))
                if use_nvdec:
                    from subtitle_localizer.detector.nvdec_decoder import NvdecVideoDecoder
                    decoder = NvdecVideoDecoder(
                        video_path,
                        gpu_id=getattr(pipeline_settings.ocr, "nvdec_device_id", 0),
                    )
                    try:
                        if decoder.open():
                            decoder_fps = float(getattr(decoder.hw_stream, "average_rate", 25.0) or 25.0)
                            sample_step = max(1, int(round(decoder_fps / max(0.5, float(pipeline_settings.ocr.sample_fps)))))
                            for crop, pts in decoder.decode_frames_roi(
                                roi_norm=roi_tuple,
                                sample_step=sample_step,
                                max_duration_seconds=max_duration_seconds,
                            ):
                                crops.append(crop)
                                pts_list.append(pts)
                    finally:
                        decoder.close()
                if not crops or not pts_list:
                    # Preserve the mature OpenCV sampler as a fallback (and for
                    # CPU-only installs where PyAV/NVDEC is unavailable).
                    crops, pts_list = self.sampler.sample_video_frames(
                        video_path=video_path,
                        roi_norm=roi_tuple,
                        roi_norms=rois_tuples,
                        max_duration_seconds=max_duration_seconds,
                        diff_threshold=pipeline_settings.ocr.diff_threshold,
                        edge_gating_threshold=getattr(pipeline_settings.ocr, "edge_gating_threshold", 0.0),
                    )
                if not crops or not pts_list:
                    if cloud_cues:
                        cues = cloud_cues
                    else:
                        raise RuntimeError(f"No video frames could be decoded: {video_path}")

                recognition_crops, recognition_pts = crops, pts_list
                requested_engine = getattr(pipeline_settings.ocr, "engine", "rapidocr")
                configured_backend = getattr(pipeline_settings.ocr, "primary_backend", "")
                if recognition_crops and (requested_engine == "ppocrv5" or configured_backend in {"ppocrv5", "auto"}):
                    detector = self.ocr_registry.get_provider_for_language(manifest.source_language, preferred="rapidocr")
                    funnel = None
                    if getattr(pipeline_settings.ocr, "enable_anti_noise_funnel", False):
                        from subtitle_localizer.ocr.anti_noise import AntiNoiseFunnel
                        funnel = AntiNoiseFunnel(
                            ar_min=pipeline_settings.ocr.anti_noise_ar_min,
                            h_max=pipeline_settings.ocr.anti_noise_h_max,
                            swt_cov_max=pipeline_settings.ocr.anti_noise_swt_cov_max,
                            lum_min=pipeline_settings.ocr.anti_noise_lum_min,
                            dhash_thresh=pipeline_settings.ocr.stroke_dhash_threshold,
                        )
                    try:
                        # Reduce DBNet work on wide subtitle bands when using
                        # the PP-OCRv5 recognition bridge.
                        detector.load()
                        text_detector = getattr(getattr(detector, "engine", None), "text_det", None)
                        if text_detector is not None:
                            text_detector.limit_type = getattr(pipeline_settings.ocr, "dbnet_limit_type", "max")
                            text_detector.limit_side_len = int(getattr(pipeline_settings.ocr, "dbnet_limit_side_len", 960))
                        recognition_crops, recognition_pts = self._prepare_ppocrv5_inputs(crops, pts_list, detector, funnel)
                    finally:
                        detector.unload()
                    if not recognition_crops:
                        raise RuntimeError("PP-OCRv5 detector produced no text line crops")

                # Stage 2: OCR Inference Stage
                stage2 = StageRunV1(
                    stage_name="ocr_inference",
                    status="running",
                    progress=0.2,
                        metrics={"current": 0, "total": len(recognition_crops), "label": f"Bắt đầu nhận diện OCR ({len(recognition_crops)} crops)..."},
                )
                if not self.is_cancelled(project_id):
                    self.repo.save_stage_run(project_id, stage2)

                last_progress_time = 0.0
                last_progress_pct = -1.0

                def _on_ocr_progress(cur: int, tot: int) -> None:
                    nonlocal last_progress_time, last_progress_pct
                    if self.is_cancelled(project_id):
                        raise InterruptedError("Tiến trình đã bị người dùng dừng / hủy.")
                    pct = round(0.2 + 0.5 * (cur / max(1, tot)), 2)
                    now = time.time()
                    if cur == 0 or cur == tot or pct != last_progress_pct or (now - last_progress_time) >= 0.4:
                        last_progress_pct = pct
                        last_progress_time = now
                        st = StageRunV1(
                            stage_name="ocr_inference",
                            status="running",
                            progress=pct,
                            metrics={"current": cur, "total": tot, "label": f"Đang quét OCR: {int(pct * 100)}% ({cur}/{tot})..."},
                        )
                        if not self.is_cancelled(project_id):
                            self.repo.save_stage_run(project_id, st)

                engine_name = getattr(pipeline_settings.ocr, "engine", "rapidocr")
                primary = self._resolve_primary_backend(
                    engine_name,
                    getattr(pipeline_settings.ocr, "primary_backend", engine_name),
                    getattr(pipeline_settings.ocr, "ppocr_model_tier", "mobile"),
                )
                fallback_name = getattr(pipeline_settings.ocr, "fallback_backend", "rapidocr")
                allow_fallback = bool(getattr(pipeline_settings.ocr, "auto_fallback", True)) and primary != fallback_name
                ocr_provider = self.ocr_registry.get_provider_for_language(
                    manifest.source_language,
                    preferred=primary,
                )
                fallback_provider = self.ocr_registry.get_fallback_for_language(
                    manifest.source_language, preferred=fallback_name
                )
                # A valid cloud transcript must survive a decoder failure.  A
                # no-op provider keeps the normal reconstruction/translation
                # flow intact without attempting to load local OCR models for
                # an empty crop list.
                if cloud_cues and not recognition_crops:
                    class _CloudCuePassthrough:
                        recognition_batch_size = 1

                        def load(self) -> None:
                            return None

                        def unload(self) -> None:
                            return None

                        def recognize(self, crops, pts_list, language="zh", **_kwargs):
                            return []

                    passthrough = _CloudCuePassthrough()
                    ocr_provider = passthrough
                    fallback_provider = passthrough
                    allow_fallback = False
                # RapidOCR batches detected text crops internally. Apply the
                # validated profile value before loading the ONNX sessions.
                batch_size = max(
                    1,
                    min(64, int(getattr(pipeline_settings.ocr, "recognition_batch_size", 6))),
                )
                if primary.startswith("ppocrv5") and getattr(pipeline_settings.ocr, "hardware_tuning_mode", "auto") == "auto":
                    try:
                        from subtitle_localizer.service.hardware_tuner import HardwareAutoTuner
                        batch_size = HardwareAutoTuner().profile().optimal_batch_size
                    except Exception as tuner_error:
                        logging.getLogger(__name__).debug("Hardware auto-tuning unavailable: %s", tuner_error)
                for provider in (ocr_provider, fallback_provider):
                    if hasattr(provider, "recognition_batch_size"):
                        provider.recognition_batch_size = batch_size
                try:
                    ocr_provider.load()
                except Exception as load_error:
                    if not allow_fallback or ocr_provider is fallback_provider:
                        if hasattr(ocr_provider, "_load_cpu"):
                            ocr_provider._load_cpu()
                        else:
                            raise
                    else:
                        logging.getLogger(__name__).warning(
                            "Primary OCR backend unavailable; falling back to RapidOCR: %s",
                            load_error,
                        )
                        ocr_provider = fallback_provider
                        ocr_provider.load()

                try:
                    import inspect
                    sig = inspect.signature(ocr_provider.recognize)
                    extra_kwargs = {}
                    performance_profile = getattr(
                        pipeline_settings.ocr, "performance_profile", "full_speed_quality"
                    )
                    include_advanced = (
                        performance_profile == "maximum_recall"
                        or (
                            performance_profile not in ("full_speed_quality", "maximum_recall")
                            and getattr(pipeline_settings.ocr, "include_advanced_preprocessing", False)
                        )
                    )
                    if "progress_callback" in sig.parameters:
                        extra_kwargs["progress_callback"] = _on_ocr_progress
                    if "include_advanced" in sig.parameters:
                        extra_kwargs["include_advanced"] = include_advanced
                    if "enable_early_exit" in sig.parameters:
                        extra_kwargs["enable_early_exit"] = getattr(pipeline_settings.ocr, "enable_early_exit", True)
                    try:
                        observations = ocr_provider.recognize(
                            crops=recognition_crops,
                            pts_list=recognition_pts,
                            language=manifest.source_language,
                            **extra_kwargs,
                        )
                    except Exception as infer_error:
                        if not allow_fallback or ocr_provider is fallback_provider:
                            raise
                        logging.getLogger(__name__).warning(
                            "Primary OCR inference failed; falling back to RapidOCR: %s",
                            infer_error,
                        )
                        try:
                            ocr_provider.unload()
                        except Exception:
                            pass
                        ocr_provider = fallback_provider
                        ocr_provider.load()
                        observations = ocr_provider.recognize(
                            crops=recognition_crops,
                            pts_list=recognition_pts,
                            language=manifest.source_language,
                            **extra_kwargs,
                        )

                    # Auto Gap-Rescue Pass: Tự động phân tích các khoảng trống nghi ngờ giữa các câu
                    # và quét sâu để cứu các câu phụ đề mờ hoặc chớp nhoáng (Zero-Miss Automation)
                    if pipeline_settings.ocr.enable_gap_rescue and observations and len(observations) >= 4:
                        rescue_frame_limit = max(
                            1,
                            int(getattr(pipeline_settings.ocr, "gap_rescue_max_frames", 20)),
                        )
                        pre_cues = self.reconstructor.build_cues(observations)
                        if len(pre_cues) >= 2:
                            gap_intervals = []
                            for i in range(len(pre_cues) - 1):
                                dur = pre_cues[i + 1].start_pts - pre_cues[i].end_pts
                                if 1.8 <= dur <= 5.0:
                                    gap_intervals.append((pre_cues[i].end_pts, pre_cues[i + 1].start_pts))

                            if gap_intervals:
                                selected_gaps = gap_intervals[:8]
                                rescue_crops = []
                                rescue_pts = []
                                for g_idx, (g_start, g_end) in enumerate(selected_gaps):
                                    if self.is_cancelled(project_id):
                                        raise InterruptedError("Tiến trình đã bị người dùng dừng / hủy.")
                                    st_gap = StageRunV1(
                                        stage_name="ocr_inference",
                                        status="running",
                                        progress=round(0.70 + 0.02 * ((g_idx + 1) / len(selected_gaps)), 2),
                                        metrics={"label": f"Đang trích xuất frame cứu phụ đề (Gap-Rescue {g_idx + 1}/{len(selected_gaps)})..."},
                                    )
                                    if not self.is_cancelled(project_id):
                                        self.repo.save_stage_run(project_id, st_gap)

                                    g_crops, g_pts = self.sampler.sample_video_frames(
                                        video_path=video_path,
                                        roi_norm=roi_tuple,
                                        roi_norms=rois_tuples,
                                        max_duration_seconds=g_end,
                                        diff_threshold=1.5,
                                        start_seconds=g_start,
                                        fps=2.5,
                                    )
                                    for c, p in zip(g_crops, g_pts):
                                        if g_start < p < g_end and len(rescue_crops) < rescue_frame_limit * (g_idx + 1):
                                            rescue_crops.append(c)
                                            rescue_pts.append(p)

                                if rescue_crops:
                                    try:
                                        rescue_extra = {}
                                        if "include_advanced" in sig.parameters:
                                            rescue_extra["include_advanced"] = include_advanced

                                        def _on_rescue_progress(r_cur: int, r_tot: int) -> None:
                                            if self.is_cancelled(project_id):
                                                raise InterruptedError("Tiến trình đã bị người dùng dừng / hủy.")
                                            r_pct = round(0.72 + 0.02 * (r_cur / max(1, r_tot)), 2)
                                            st_res = StageRunV1(
                                                stage_name="ocr_inference",
                                                status="running",
                                                progress=r_pct,
                                                metrics={"current": r_cur, "total": r_tot, "label": f"Đang nhận diện chữ cứu phụ đề: {r_cur}/{r_tot} frames..."},
                                            )
                                            if not self.is_cancelled(project_id):
                                                self.repo.save_stage_run(project_id, st_res)

                                        if "progress_callback" in sig.parameters:
                                            rescue_extra["progress_callback"] = _on_rescue_progress

                                        rescue_obs = ocr_provider.recognize(
                                            crops=rescue_crops,
                                            pts_list=rescue_pts,
                                            language=manifest.source_language,
                                            **rescue_extra,
                                        )
                                        if rescue_obs:
                                            observations.extend(rescue_obs)
                                            observations.sort(key=lambda o: o.pts)
                                    except Exception:
                                        pass
                finally:
                    ocr_provider.unload()
                    ocr_provider = None

                # Smart ROI Tightening (Tự co giãn để tránh che nội dung quá nhiều mà vẫn che đủ sub)
                if pipeline_settings.ocr.enable_roi_tightening and active_roi and observations and crops and hasattr(crops[0], "shape"):
                    crop_h, crop_w = crops[0].shape[:2]
                    tight_roi = compute_tight_roi_from_observations(
                        observations=observations,
                        base_roi=active_roi,
                        crop_width=crop_w,
                        crop_height=crop_h,
                    )
                    if tight_roi:
                        manifest.regions[0] = tight_roi
                        self.repo.save_project(manifest)

                # Auto-detect language if manifest.source_language == "auto"
                if effective_source_lang == "auto" and observations:
                    effective_source_lang = self._detect_language(" ".join(o.raw_text for o in observations if o.raw_text))
                    manifest.source_language = effective_source_lang
                    self.repo.save_project(manifest)

                if self.is_cancelled(project_id):
                    raise InterruptedError("Tiến trình đã bị người dùng dừng / hủy.")

                # Stage 3: Cue Reconstruction Stage
                stage3 = StageRunV1(
                    stage_name="cue_reconstruction",
                    status="running",
                    progress=0.75,
                    metrics={"label": "Tái tạo câu phụ đề (Reconstruction)..."},
                )
                if not self.is_cancelled(project_id):
                    self.repo.save_stage_run(project_id, stage3)

                local_cues = self.reconstructor.build_cues(observations)
                # A hybrid cloud transcript is authoritative when local OCR
                # yields no usable observations (for example decoder failure).
                # Never replace valid cloud cues with an empty reconstruction.
                if local_cues:
                    cues = local_cues
                elif not cues and cloud_cues:
                    cues = cloud_cues

                if self.is_cancelled(project_id):
                    raise InterruptedError("Tiến trình đã bị người dùng dừng / hủy.")

                # Stage 3.5: Frame-Accurate Boundary Refinement
                # Tinh chỉnh mốc thời gian chính xác đến từng khung hình (< 33ms)
                # bằng kỹ thuật Single-Pass Sequential Decode + Sobel Gradient Spike
                if cues and roi_tuple:
                    stage_refine = StageRunV1(
                        stage_name="boundary_refinement",
                        status="running",
                        progress=0.78,
                        metrics={"label": f"Tinh chỉnh ranh giới Frame-Accurate ({len(cues)} câu)..."},
                    )
                    if not self.is_cancelled(project_id):
                        self.repo.save_stage_run(project_id, stage_refine)

                    def _on_refine_progress(ref_cur: int, ref_tot: int) -> None:
                        if self.is_cancelled(project_id):
                            raise InterruptedError("Tiến trình đã bị người dùng dừng / hủy.")
                        ref_pct = round(0.78 + 0.03 * (ref_cur / max(1, ref_tot)), 2)
                        st_ref = StageRunV1(
                            stage_name="boundary_refinement",
                            status="running",
                            progress=ref_pct,
                            metrics={"current": ref_cur, "total": ref_tot, "label": f"Tinh chỉnh ranh giới khớp từng frame: {ref_cur}/{ref_tot} câu..."},
                        )
                        if not self.is_cancelled(project_id):
                            self.repo.save_stage_run(project_id, st_ref)

                    self.boundary_refiner.roi_norm = roi_tuple
                    cues = self.boundary_refiner.refine_cues(
                        video_path=str(video_path),
                        cues=cues,
                        progress_callback=_on_refine_progress,
                    )

                if self.is_cancelled(project_id):
                    raise InterruptedError("Tiến trình đã bị người dùng dừng / hủy.")

                # Legacy Hybrid/Whisper fusion has been removed. Cloud cues, when
                # explicitly selected, are used directly; local mode remains pure OCR.

                # Áp dụng bộ lọc Anti-Trash Sub triệt để cho toàn bộ cues trước khi dịch/lưu
                from subtitle_localizer.ocr.rapid import is_trash_sub
                cues = [c for c in cues if not is_trash_sub(c.source_text)]


            if self.is_cancelled(project_id):
                raise InterruptedError("Tiến trình đã bị người dùng dừng / hủy.")

            # Stage 4: Translation Stage (Dịch sang tiếng Việt)
            if not ocr_only and manifest.target_language and manifest.target_language != effective_source_lang and manifest.target_language != "none":
                stage4 = StageRunV1(
                    stage_name="translation",
                    status="running",
                    progress=0.85,
                    metrics={"label": f"Đang dịch phụ đề ({effective_source_lang} -> {manifest.target_language})..."},
                )
                if not self.is_cancelled(project_id):
                    self.repo.save_stage_run(project_id, stage4)

                translator = self.translation_registry.get_provider_for_pair(
                    effective_source_lang, manifest.target_language
                )
                translator.load()
                try:
                    cues = translator.translate_cues(
                        cues, source_lang=effective_source_lang, target_lang=manifest.target_language
                    )
                    untranslated = [
                        cue for cue in cues
                        if cue.source_text.strip()
                        and (not cue.translated_text.strip() or cue.translated_text.strip() == cue.source_text.strip())
                    ]
                    if untranslated:
                        raise RuntimeError(
                            f"Local translation incomplete: {len(untranslated)}/{len(cues)} cues untranslated; "
                            "start the configured local model before continuing."
                        )
                finally:
                    translator.unload()
                    translator = None

            # Stage 5: Lưu cues vào database
            self.repo.save_cues(project_id, cues)

            # Hoàn tất pipeline
            stage_done = StageRunV1(
                stage_name="pipeline",
                status="completed",
                progress=1.0,
                metrics={"label": f"Hoàn tất trích xuất {len(cues)} câu phụ đề!", "cues_count": len(cues)},
                end_time=time.time(),
            )
            self.repo.save_stage_run(project_id, stage_done)
            return True

        except InterruptedError:
            if ocr_provider is not None:
                try:
                    ocr_provider.unload()
                except Exception:
                    pass
            if translator is not None:
                try:
                    translator.unload()
                except Exception:
                    pass
            # Không ghi stage cancelled ở đây vì stop_pipeline endpoint đã ghi rồi.
            # Tránh trùng lặp stage cancelled trong database.
            return False

        except Exception as error:
            if ocr_provider is not None:
                ocr_provider.unload()
            if translator is not None:
                translator.unload()
            stage_err = StageRunV1(
                stage_name="pipeline",
                status="failed",
                progress=0.0,
                errors=[str(error)],
                end_time=time.time(),
            )
            self.repo.save_stage_run(project_id, stage_err)
            return False
        finally:
            self.clear_cancel(project_id)
