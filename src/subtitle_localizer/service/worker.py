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
    """Xu ly cac tac vu nen OCR, Cue Reconstruction, Translation va Export."""

    def __init__(self, repo: ProjectRepository) -> None:
        self.repo = repo
        self.ocr_registry = OcrRegistry()
        self.translation_registry = TranslationRegistry()
        self.reconstructor = CueReconstructor()

    def run_pipeline_synchronous(self, project_id: str) -> bool:
        """Thuc thi pipeline hoan chinh cho project."""
        manifest = self.repo.get_project(project_id)
        if not manifest:
            return False

        try:
            # Stage 1: Detector & ROI
            stage1 = StageRunV1(stage_name="detector", status="running", progress=0.1)
            self.repo.save_stage_run(project_id, stage1)

            if not manifest.regions:
                default_roi = propose_default_roi(1920, 1080)
                manifest.regions.append(default_roi)
                self.repo.save_project(manifest)

            # Stage 2: OCR Inference
            stage2 = StageRunV1(stage_name="ocr_inference", status="running", progress=0.4)
            self.repo.save_stage_run(project_id, stage2)

            ocr_provider = self.ocr_registry.get_provider_for_language(manifest.source_language)
            ocr_provider.load()

            # Tao PTS list mo phong nhieu cau phu de hon cho demo
            pts_list = [
                0.5, 0.8, 1.1,       # Cue 1
                2.0, 2.3, 2.6,       # Cue 2
                4.0, 4.3, 4.6,       # Cue 3
                6.0, 6.3, 6.6,       # Cue 4
                8.0, 8.3, 8.6,       # Cue 5
                10.0, 10.3, 10.6,    # Cue 6
                12.0, 12.3, 12.6,    # Cue 7
                14.0, 14.3,          # Cue 8
            ]
            observations = ocr_provider.recognize(
                crops=[b"crop"] * len(pts_list),
                pts_list=pts_list,
                language=manifest.source_language,
            )
            ocr_provider.unload()

            # Stage 3: Cue Reconstruction
            stage3 = StageRunV1(stage_name="cue_reconstruction", status="running", progress=0.7)
            self.repo.save_stage_run(project_id, stage3)

            cues = self.reconstructor.build_cues(observations)

            # Stage 4: Translation (neu can)
            if manifest.target_language and manifest.target_language != manifest.source_language and manifest.target_language != "none":
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

            # Stage 5: Luu cues vao database
            self.repo.save_cues(project_id, cues)

            # Hoan tat pipeline
            stage_done = StageRunV1(stage_name="pipeline", status="completed", progress=1.0, end_time=time.time())
            self.repo.save_stage_run(project_id, stage_done)
            return True

        except Exception as e:
            # Ghi nhan loi pipeline
            stage_err = StageRunV1(stage_name="pipeline", status="failed", progress=0.0, error_message=str(e))
            self.repo.save_stage_run(project_id, stage_err)
            return False
