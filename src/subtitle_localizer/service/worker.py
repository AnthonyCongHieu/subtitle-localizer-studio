from __future__ import annotations

import time
from pathlib import Path
from subtitle_localizer.detector.roi import propose_default_roi
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
        self.reconstructor = CueReconstructor(min_cue_duration=0.25)
        self.sampler = AdaptiveFrameSampler(sample_fps=2.0)

    def run_pipeline_synchronous(
        self,
        project_id: str,
        max_duration_seconds: float = 600.0,
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

            # Đề xuất ROI nếu chưa có
            if not manifest.regions:
                default_roi = propose_default_roi(1920, 1080)
                manifest.regions.append(default_roi)
                self.repo.save_project(manifest)

            active_roi = manifest.regions[0] if manifest.regions else None
            roi_tuple = (active_roi.x, active_roi.y, active_roi.width, active_roi.height) if active_roi else None

            # Kiểm tra xem file video có tồn tại trên đĩa không
            video_path = Path(manifest.source_video_path)
            if not video_path.exists() or not video_path.is_file():
                raise FileNotFoundError(f"Video file does not exist: {video_path}")

            crops, pts_list = self.sampler.sample_video_frames(
                video_path=video_path,
                roi_norm=roi_tuple,
                max_duration_seconds=max_duration_seconds,
            )
            if not crops or not pts_list:
                raise RuntimeError(f"No video frames could be decoded: {video_path}")

            # Stage 2: OCR Inference Stage
            stage2 = StageRunV1(stage_name="ocr_inference", status="running", progress=0.4)
            self.repo.save_stage_run(project_id, stage2)

            ocr_provider = self.ocr_registry.get_provider_for_language(manifest.source_language)
            ocr_provider.load()
            try:
                observations = ocr_provider.recognize(
                    crops=crops,
                    pts_list=pts_list,
                    language=manifest.source_language,
                )
            finally:
                ocr_provider.unload()
                ocr_provider = None

            # Stage 3: Cue Reconstruction Stage
            stage3 = StageRunV1(stage_name="cue_reconstruction", status="running", progress=0.7)
            self.repo.save_stage_run(project_id, stage3)

            cues = self.reconstructor.build_cues(observations)

            # Stage 4: Translation Stage (Dịch sang tiếng Việt)
            if manifest.target_language and manifest.target_language != manifest.source_language and manifest.target_language != "none":
                stage4 = StageRunV1(stage_name="translation", status="running", progress=0.9)
                self.repo.save_stage_run(project_id, stage4)

                translator = self.translation_registry.get_provider_for_pair(
                    manifest.source_language, manifest.target_language
                )
                translator.load()
                try:
                    cues = translator.translate_cues(
                        cues, source_lang=manifest.source_language, target_lang=manifest.target_language
                    )
                finally:
                    translator.unload()
                    translator = None

            # Stage 5: Lưu cues vào database
            self.repo.save_cues(project_id, cues)

            # Hoàn tất pipeline
            stage_done = StageRunV1(stage_name="pipeline", status="completed", progress=1.0, end_time=time.time())
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
