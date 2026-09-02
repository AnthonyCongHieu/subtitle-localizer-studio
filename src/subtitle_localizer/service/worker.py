from __future__ import annotations

import time
from typing import Optional

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
        self.reconstructor = CueReconstructor()

    def run_pipeline_synchronous(self, project_id: str) -> bool:
        """Thực thi pipeline hoàn chỉnh cho project."""
        manifest = self.repo.get_project(project_id)
        if not manifest:
            return False

        # Ghi nhận Stage 1: Detector & Sampler
        stage1 = StageRunV1(stage_name="detector", status="running", progress=0.1)
        self.repo.save_stage_run(project_id, stage1)

        # 1. Đề xuất ROI nếu chưa có
        if not manifest.regions:
            default_roi = propose_default_roi(1920, 1080)
            manifest.regions.append(default_roi)
            self.repo.save_project(manifest)

        # 2. OCR Inference Stage
        stage2 = StageRunV1(stage_name="ocr_inference", status="running", progress=0.4)
        self.repo.save_stage_run(project_id, stage2)

        ocr_provider = self.ocr_registry.get_provider_for_language(manifest.source_language)
        ocr_provider.load()

        # Mock frame PTS list cho test và demo
        pts_list = [1.0, 1.3, 1.6, 2.0, 3.5, 3.8, 4.2]
        observations = ocr_provider.recognize(
            crops=[b"crop"] * len(pts_list),
            pts_list=pts_list,
            language=manifest.source_language,
        )
        ocr_provider.unload()

        # 3. Cue Reconstruction Stage
        stage3 = StageRunV1(stage_name="cue_reconstruction", status="running", progress=0.7)
        self.repo.save_stage_run(project_id, stage3)

        cues = self.reconstructor.build_cues(observations)

        # 4. Translation Stage (nếu cần)
        if manifest.target_language and manifest.target_language != manifest.source_language:
            stage4 = StageRunV1(stage_name="translation", status="running", progress=0.9)
            self.repo.save_stage_run(project_id, stage4)

            translator = self.translation_registry.get_provider_for_pair(
                manifest.source_language, manifest.target_language
            )
            translator.load()
            cues = translator.translate_cues(
                cues, source_lang=manifest.source_language, target_lang=manifest.target_language
            )
            translator.unload()

        # 5. Lưu cues vào database
        self.repo.save_cues(project_id, cues)

        # Hoàn tất pipeline
        stage_done = StageRunV1(stage_name="pipeline", status="completed", progress=1.0, end_time=time.time())
        self.repo.save_stage_run(project_id, stage_done)
        return True
