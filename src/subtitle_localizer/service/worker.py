from __future__ import annotations

import time
from pathlib import Path
from subtitle_localizer.detector.boundary_refiner import FrameAccurateBoundaryRefiner
from subtitle_localizer.detector.roi import compute_tight_roi_from_observations, propose_default_roi
from subtitle_localizer.detector.sampler import AdaptiveFrameSampler
from subtitle_localizer.domain.models import StageRunV1, SubtitleCueV1
from subtitle_localizer.ocr.registry import OcrRegistry
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.reconstruction.builder import CueReconstructor
from subtitle_localizer.translation.registry import TranslationRegistry


class BackgroundWorker:
    """Xử lý các tác vụ nền OCR, Cue Reconstruction, Translation và Export."""

    def __init__(self, repo: ProjectRepository) -> None:
        self.repo = repo
        self.ocr_registry = OcrRegistry()
        self.translation_registry = TranslationRegistry()
        self.reconstructor = CueReconstructor(min_cue_duration=0.20, lead_in=0.0, lead_out=0.0)
        self.boundary_refiner = FrameAccurateBoundaryRefiner()
        self.sampler = AdaptiveFrameSampler(sample_fps=2.0, diff_threshold=3.5)

    def run_pipeline_synchronous(
        self,
        project_id: str,
        max_duration_seconds: Optional[float] = None,
    ) -> bool:
        """Thực thi pipeline hoàn chỉnh cho project với OCR và Dịch thực tế."""
        manifest = self.repo.get_project(project_id)
        if not manifest:
            return False

        ocr_provider = None
        translator = None
        try:
            # Stage 1: Detector & Sampler
            stage1 = StageRunV1(stage_name="detector", status="running", progress=0.1)
            self.repo.save_stage_run(project_id, stage1)

            # Kiểm tra xem file video có tồn tại trên đĩa không
            video_path = Path(manifest.source_video_path)
            if not video_path.exists() or not video_path.is_file():
                raise FileNotFoundError(f"Video file does not exist: {video_path}")

            # Đề xuất ROI nếu chưa có
            if not manifest.regions:
                import cv2
                cap = cv2.VideoCapture(str(video_path))
                vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
                vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
                cap.release()
                default_roi = propose_default_roi(vw, vh)
                manifest.regions.append(default_roi)
                self.repo.save_project(manifest)

            active_roi = manifest.regions[0] if manifest.regions else None
            roi_tuple = (active_roi.x, active_roi.y, active_roi.width, active_roi.height) if active_roi else None

            crops, pts_list = self.sampler.sample_video_frames(
                video_path=video_path,
                roi_norm=roi_tuple,
                max_duration_seconds=max_duration_seconds,
                diff_threshold=3.5,
            )
            if not crops or not pts_list:
                raise RuntimeError(f"No video frames could be decoded: {video_path}")

            # Stage 2: OCR Inference Stage
            stage2 = StageRunV1(
                stage_name="ocr_inference",
                status="running",
                progress=0.2,
                metrics={"current": 0, "total": len(crops), "label": f"Bắt đầu nhận diện OCR ({len(crops)} frames)..."},
            )
            self.repo.save_stage_run(project_id, stage2)

            last_progress_time = 0.0
            last_progress_pct = -1.0

            def _on_ocr_progress(cur: int, tot: int) -> None:
                nonlocal last_progress_time, last_progress_pct
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
                    self.repo.save_stage_run(project_id, st)

            ocr_provider = self.ocr_registry.get_provider_for_language(manifest.source_language)
            ocr_provider.load()
            try:
                try:
                    observations = ocr_provider.recognize(
                        crops=crops,
                        pts_list=pts_list,
                        language=manifest.source_language,
                        progress_callback=_on_ocr_progress,
                    )
                except TypeError:
                    observations = ocr_provider.recognize(
                        crops=crops,
                        pts_list=pts_list,
                        language=manifest.source_language,
                    )

                # Auto Gap-Rescue Pass: Tự động phân tích các khoảng trống nghi ngờ giữa các câu
                # và quét sâu để cứu các câu phụ đề mờ hoặc chớp nhoáng (Zero-Miss Automation)
                if observations and len(observations) >= 4:
                    pre_cues = self.reconstructor.build_cues(observations)
                    if len(pre_cues) >= 2:
                        gap_intervals = []
                        for i in range(len(pre_cues) - 1):
                            dur = pre_cues[i + 1].start_pts - pre_cues[i].end_pts
                            if 1.8 <= dur <= 5.0:
                                gap_intervals.append((pre_cues[i].end_pts, pre_cues[i + 1].start_pts))

                        if gap_intervals:
                            rescue_crops = []
                            rescue_pts = []
                            for g_start, g_end in gap_intervals[:12]:
                                g_crops, g_pts = self.sampler.sample_video_frames(
                                    video_path=video_path,
                                    roi_norm=roi_tuple,
                                    max_duration_seconds=g_end,
                                    diff_threshold=1.5,
                                    start_seconds=g_start,
                                )
                                for c, p in zip(g_crops, g_pts):
                                    if g_start < p < g_end:
                                        rescue_crops.append(c)
                                        rescue_pts.append(p)

                            if rescue_crops:
                                try:
                                    rescue_obs = ocr_provider.recognize(
                                        crops=rescue_crops,
                                        pts_list=rescue_pts,
                                        language=manifest.source_language,
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
            if active_roi and observations and crops and hasattr(crops[0], "shape"):
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
            effective_source_lang = manifest.source_language
            if effective_source_lang == "auto" and observations:
                all_raw = " ".join(o.raw_text for o in observations if o.raw_text)
                zh_cnt = sum(1 for c in all_raw if '\u4e00' <= c <= '\u9fff')
                ja_cnt = sum(1 for c in all_raw if ('\u3040' <= c <= '\u309f') or ('\u30a0' <= c <= '\u30ff'))
                ko_cnt = sum(1 for c in all_raw if '\uac00' <= c <= '\ud7af')
                if ja_cnt > 0:
                    effective_source_lang = "ja"
                elif ko_cnt > 0:
                    effective_source_lang = "ko"
                elif zh_cnt > 0:
                    effective_source_lang = "zh"
                else:
                    effective_source_lang = "en"
                manifest.source_language = effective_source_lang
                self.repo.save_project(manifest)

            # Stage 3: Cue Reconstruction Stage
            stage3 = StageRunV1(
                stage_name="cue_reconstruction",
                status="running",
                progress=0.75,
                metrics={"label": "Tái tạo câu phụ đề (Reconstruction)..."},
            )
            self.repo.save_stage_run(project_id, stage3)

            cues = self.reconstructor.build_cues(observations)

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
                self.repo.save_stage_run(project_id, stage_refine)

                self.boundary_refiner.roi_norm = roi_tuple
                cues = self.boundary_refiner.refine_cues(
                    video_path=str(video_path),
                    cues=cues,
                )

            # Stage 4: Translation Stage (Dịch sang tiếng Việt)
            if manifest.target_language and manifest.target_language != effective_source_lang and manifest.target_language != "none":
                stage4 = StageRunV1(
                    stage_name="translation",
                    status="running",
                    progress=0.85,
                    metrics={"label": f"Đang dịch phụ đề ({effective_source_lang} -> {manifest.target_language})..."},
                )
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
