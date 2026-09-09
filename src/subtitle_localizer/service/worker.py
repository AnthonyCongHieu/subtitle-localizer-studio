from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from subtitle_localizer.detector.boundary_refiner import FrameAccurateBoundaryRefiner
from subtitle_localizer.detector.roi import compute_tight_roi_from_observations, propose_default_roi
from subtitle_localizer.detector.sampler import AdaptiveFrameSampler
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
                    elif provider == "groq":
                        from subtitle_localizer.cloud.groq_whisper import GroqWhisperExtractor
                        extractor = GroqWhisperExtractor(
                            api_key=getattr(pipeline_settings.ocr, "groq_api_key", ""),
                            model=getattr(pipeline_settings.ocr, "groq_model", "whisper-large-v3"),
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
                # Với Gemini/Groq hoặc khi api_fusion_mode == 'api_only' hoặc video không mở được: dùng trực tiếp cloud cues.
                import cv2
                _test_cap = cv2.VideoCapture(str(video_path))
                video_can_decode = bool(_test_cap.isOpened())
                _test_cap.release()

                if cloud_cues:
                    if provider == "capcut" and api_fusion_mode == "hybrid_ocr" and video_can_decode:
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

                # Stage 2: OCR Inference Stage
                stage2 = StageRunV1(
                    stage_name="ocr_inference",
                    status="running",
                    progress=0.2,
                    metrics={"current": 0, "total": len(crops), "label": f"Bắt đầu nhận diện OCR ({len(crops)} frames)..."},
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
                primary = getattr(pipeline_settings.ocr, "primary_backend", engine_name)
                # Preserve the pre-profile `engine=paddle` project setting.
                if engine_name == "paddle" and primary == "rapidocr":
                    primary = "paddle"
                if primary == "auto":
                    primary = "paddle"
                allow_fallback = primary == "paddle"
                ocr_provider = self.ocr_registry.get_provider_for_language(
                    manifest.source_language,
                    preferred=primary,
                )
                fallback_name = getattr(pipeline_settings.ocr, "fallback_backend", "rapidocr")
                fallback_provider = self.ocr_registry.get_fallback_for_language(
                    manifest.source_language, preferred=fallback_name
                )
                # RapidOCR batches detected text crops internally. Apply the
                # validated profile value before loading the ONNX sessions.
                batch_size = max(
                    1,
                    min(32, int(getattr(pipeline_settings.ocr, "recognition_batch_size", 6))),
                )
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
                            crops=crops,
                            pts_list=pts_list,
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
                            crops=crops,
                            pts_list=pts_list,
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

                cues = self.reconstructor.build_cues(observations)

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

                # Stage 3.8: Hybrid Fusion Pass (Dung hợp Cloud ASR hoặc Whisper với Thị giác Local OCR)
                local_engine = getattr(pipeline_settings.ocr, "local_engine", "pure_ocr")
                if cloud_cues and video_path.exists():
                    stage_cloud_fusion = StageRunV1(
                        stage_name="hybrid_fusion",
                        status="running",
                        progress=0.82,
                        metrics={"label": "Dung hợp chữ thị giác Local OCR với âm thanh Cloud ASR (Chuẩn điện ảnh)..."},
                    )
                    if not self.is_cancelled(project_id):
                        self.repo.save_stage_run(project_id, stage_cloud_fusion)

                    try:
                        from subtitle_localizer.fusion.hybrid_engine import LocalHybridFusionEngine
                        fusion_engine = LocalHybridFusionEngine()
                        cloud_segs = [
                            {
                                "start": round(c.start_pts, 3),
                                "end": round(c.end_pts, 3),
                                "text": c.source_text.strip(),
                                "conf": 0.95,
                            }
                            for c in cloud_cues
                            if c.source_text and c.source_text.strip()
                        ]
                        cues = fusion_engine.fuse_cues_with_audio(
                            existing_cues=cues,
                            audio_segments=cloud_segs,
                            lang=effective_source_lang,
                        )
                    except Exception as exc:
                        logging.getLogger(__name__).warning("Dung hợp với Cloud ASR gặp sự cố: %s", exc)
                elif local_engine == "hybrid" and video_path.exists():
                    stage_hybrid = StageRunV1(
                        stage_name="hybrid_fusion",
                        status="running",
                        progress=0.82,
                        metrics={"label": "Đang dung hợp đa phương thức: Đối chiếu âm thanh RAM Pipe & sửa lỗi..."},
                    )
                    if not self.is_cancelled(project_id):
                        self.repo.save_stage_run(project_id, stage_hybrid)

                    try:
                        from subtitle_localizer.fusion.hybrid_engine import LocalHybridFusionEngine
                        whisper_model_name = getattr(pipeline_settings.ocr, "hybrid_whisper_model", "small")
                        fusion_engine = LocalHybridFusionEngine(whisper_model_size=whisper_model_name)
                        audio_data = fusion_engine.extract_audio_ram_pipe(
                            video_path=video_path,
                            max_duration_seconds=max_duration_seconds,
                        )
                        if audio_data is not None and len(audio_data) > 0:
                            audio_segs = fusion_engine.transcribe_audio_segments(
                                audio=audio_data,
                                lang=effective_source_lang,
                            )
                            cues = fusion_engine.fuse_cues_with_audio(
                                existing_cues=cues,
                                audio_segments=audio_segs,
                                lang=effective_source_lang,
                            )
                    except Exception as exc:
                        logging.getLogger(__name__).warning("Hybrid fusion pass encountered error: %s", exc)

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
