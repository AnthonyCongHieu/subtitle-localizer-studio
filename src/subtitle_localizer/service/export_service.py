"""Video export service reusable across API endpoints and background orchestrators."""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from subtitle_localizer.domain.models import RegionTrackV1
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.pipeline_settings import merge_pipeline_settings

logger = logging.getLogger(__name__)


def do_export_mp4(
    repository: ProjectRepository,
    resolved_output_root: Path,
    project_id: str,
    mask_mode: str = "blur",
    use_translated: bool = True,
    flip_h: bool = False,
    flip_v: bool = False,
    video_x: float = 0.0,
    video_y: float = 0.0,
    video_scale: float = 1.0,
    rotation: float = 0.0,
    regions_override: Optional[List[Dict[str, Any]]] = None,
    subtitle_placement: Optional[str] = "roi",
    blur_strength: Optional[int] = 20,
    voiceover_path: Optional[Path | str] = None,
) -> str:
    """Export localized MP4 with masked regions, burned subtitles, and mixed voiceover."""
    project = repository.get_project(project_id)
    if not project:
        raise ValueError(f"Project not found: {project_id}")

    if regions_override is not None:
        project.regions = [RegionTrackV1.from_dict(r) for r in regions_override]
        repository.save_project(project)

    source_path = Path(project.source_video_path)
    if not source_path.exists() or not source_path.is_file():
        raise FileNotFoundError(f"Source video not found: {source_path}")

    valid_mask_modes = {
        "box", "blur", "feather_tight", "optical_blend", "soft_cinema",
        "feather", "glass", "ambient", "mosaic", "gradient", "crop", "sttn_lama", "none"
    }
    if mask_mode not in valid_mask_modes:
        raise ValueError(f"Unsupported mask mode: {mask_mode}")

    from subtitle_localizer.render.ass import AssExporter
    from subtitle_localizer.render.export import VideoExporter
    from subtitle_localizer.render.mask import SubtitleMasker

    ass_path: Optional[Path] = None
    try:
        project_output = resolved_output_root / project_id
        project_output.mkdir(parents=True, exist_ok=True)
        output_path = project_output / f"{source_path.stem}-localized.mp4"
        cues = repository.get_cues(project_id)

        import cv2
        cap = cv2.VideoCapture(str(source_path))
        vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
        vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080
        cap.release()

        all_regions = project.regions or []
        font_size = max(24, int(vh * 0.036))
        if (subtitle_placement or "roi") == "bottom" or not all_regions:
            margin_v = int(vh * 0.06)
        else:
            sub_region = sorted(all_regions, key=lambda r: getattr(r, "y", 0.0), reverse=True)[0]
            sub_y = sub_region.y * vh
            margin_v = max(10, int(vh - sub_y - (sub_region.height * vh)))

        ass_content = AssExporter(
            font_name="Arial",
            font_size=font_size,
            primary_color="&H002DFEFE",
            outline_color="&H00000000",
            outline=3,
            shadow=1,
            play_res_x=vw,
            play_res_y=vh,
            margin_v=margin_v,
            bold=1,
        ).export_ass_text(
            cues,
            script_title=project.title,
            use_translated=use_translated,
        )

        masked_regions = [r for r in all_regions if getattr(r, "mask_enabled", True) is not False]
        mask_filter = None
        if mask_mode != "none":
            if all_regions and not masked_regions:
                mask_filter = None
            else:
                boxes: list[tuple[int, int, int, int]] = []
                if masked_regions:
                    for reg in masked_regions:
                        rx1 = max(0, min(vw - 2, int(reg.x * vw)))
                        ry1 = max(0, min(vh - 2, int(reg.y * vh)))
                        rx2 = max(rx1 + 2, min(vw, int((reg.x + reg.width) * vw)))
                        ry2 = max(ry1 + 2, min(vh, int((reg.y + reg.height) * vh)))
                        boxes.append((rx1, ry1, max(2, rx2 - rx1), max(2, ry2 - ry1)))
                else:
                    boxes.append((0, int(vh * 0.8), vw, max(2, int(vh * 0.2))))
                mask_filter = SubtitleMasker().get_multi_filter_string(boxes=boxes, mode=mask_mode, blur_strength=blur_strength or 20)

        with tempfile.NamedTemporaryFile(
            dir=project_output,
            prefix=".tmp_subtitles_",
            suffix=".ass",
            delete=False,
        ) as temporary_ass:
            ass_path = Path(temporary_ass.name)
        ass_path.write_text(ass_content, encoding="utf-8")

        rendered_path = VideoExporter().render_video(
            source_video_path=source_path,
            output_video_path=output_path,
            ass_path=ass_path,
            mask_filter=mask_filter,
            use_nvenc=True,
            flip_h=flip_h,
            flip_v=flip_v,
            rotation=rotation,
        )

        voiceover_candidate: Optional[Path] = None
        if voiceover_path:
            p = Path(voiceover_path)
            if p.exists() and p.stat().st_size > 0:
                voiceover_candidate = p
            elif p.exists() and p.stat().st_size == 0:
                raise RuntimeError(f"Voiceover file rỗng (0 bytes): {p}")
            else:
                raise FileNotFoundError(f"Voiceover file không tồn tại: {p}")
        elif getattr(project, "has_voiceover", False) and getattr(project, "voiceover_path", None):
            p = Path(project.voiceover_path)
            if p.exists() and p.stat().st_size > 0:
                voiceover_candidate = p
            else:
                raise FileNotFoundError(f"Project đánh dấu has_voiceover nhưng không tìm thấy file voiceover hợp lệ: {p}")
        else:
            default_vo = project_output / f"voiceover_{project_id}.mp3"
            if default_vo.exists() and default_vo.stat().st_size > 0:
                voiceover_candidate = default_vo

        if voiceover_candidate:
            from subtitle_localizer.dubbing.tts import mix_voiceover_into_video
            temp_mixed = project_output / f".tmp_dubbed_{output_path.name}"
            merged_settings = merge_pipeline_settings(overrides=project.custom_pipeline_settings)
            actual_ducking = getattr(merged_settings.dubbing, "ducking_volume", 0.25)
            try:
                mix_voiceover_into_video(
                    video_path=rendered_path,
                    voiceover_path=voiceover_candidate,
                    output_path=temp_mixed,
                    ducking_volume=actual_ducking,
                )
                if temp_mixed.exists() and temp_mixed.stat().st_size > 0:
                    temp_mixed.replace(rendered_path)
                else:
                    raise RuntimeError(f"Hòa trộn voiceover thất bại: file tạm không tồn tại hoặc rỗng ({temp_mixed})")
            except Exception as ex:
                logger.error(f"Không thể hòa trộn voiceover vào video xuất: {ex}", exc_info=True)
                if temp_mixed.exists():
                    try:
                        temp_mixed.unlink(missing_ok=True)
                    except Exception:
                        pass
                raise RuntimeError(f"Lỗi hòa trộn voiceover vào video xuất: {ex}") from ex

        return str(rendered_path)
    finally:
        if ass_path is not None:
            try:
                ass_path.unlink(missing_ok=True)
            except OSError:
                pass
