"""Shared runtime operations used by both the API server and LAN workers."""
from __future__ import annotations

import asyncio
import shutil
import time
from pathlib import Path
from typing import Any, Dict, Optional

from subtitle_localizer.domain.models import StageRunV1
from subtitle_localizer.service.pipeline_settings import merge_pipeline_settings


async def run_project_dubbing(repository: Any, project_id: str, output_root: Path | str,
                              options: Optional[Dict[str, Any]] = None) -> Path:
    manifest = repository.get_project(project_id)
    if not manifest:
        raise KeyError(project_id)
    cues = repository.get_cues(project_id)
    if not cues:
        raise ValueError("project has no cues for dubbing")
    settings = merge_pipeline_settings(overrides=manifest.custom_pipeline_settings)
    options = options or {}
    provider = options.get("provider") or getattr(settings.dubbing, "provider", "edge")
    voice = options.get("voice") or settings.dubbing.voice
    rate = options.get("rate") or settings.dubbing.rate
    from subtitle_localizer.dubbing.tts import normalize_dubbing_mode
    mode = normalize_dubbing_mode(options.get("mode") or getattr(settings.dubbing, "mode", "single"))
    auto_detect_speakers = options.get("auto_detect_speakers")
    if auto_detect_speakers is None:
        auto_detect_speakers = bool(getattr(settings.dubbing, "auto_detect_speakers", True))
    voice_male = options.get("voice_male") or getattr(settings.dubbing, "voice_male", "vi-VN-NamMinhNeural")
    voice_female = options.get("voice_female") or getattr(settings.dubbing, "voice_female", "vi-VN-HoaiMyNeural")
    prompt_style = options.get("prompt_style") or getattr(settings.dubbing, "gemini_prompt_style", "dramatic")
    project_output = Path(output_root).resolve() / project_id
    project_output.mkdir(parents=True, exist_ok=True)
    output = project_output / f"voiceover_{project_id}.mp3"
    cues_dir = project_output / "cues"
    cues_dir.mkdir(parents=True, exist_ok=True)
    repository.save_stage_run(project_id, StageRunV1(stage_name="dubbing", status="running", progress=0.0))
    duration = 0.0
    try:
        from subtitle_localizer.media.probe import probe_media
        duration = float(probe_media(manifest.source_video_path).duration)
    except Exception:
        pass
    from subtitle_localizer.dubbing.tts import generate_timed_voiceover
    generated = await generate_timed_voiceover(
        cues=cues, voice=voice, output_path=output, total_duration=duration, rate=rate,
        mode=mode, voice_male=voice_male, voice_female=voice_female, provider=provider,
        prompt_style=prompt_style, export_cues_dir=cues_dir,
        auto_detect_speakers=bool(auto_detect_speakers),
    )
    if (not output.exists() or output.stat().st_size == 0) and generated:
        candidate = Path(generated)
        if candidate.is_file() and candidate != output:
            shutil.copyfile(candidate, output)
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError("dubbing did not produce audio")
    current = repository.get_project(project_id) or manifest
    current.has_voiceover = True
    current.voiceover_path = str(output).replace("\\", "/")
    current.voiceover_file_size_bytes = output.stat().st_size
    repository.save_project(current)
    repository.save_stage_run(project_id, StageRunV1(stage_name="dubbing", status="completed", progress=1.0, end_time=time.time()))
    return output


def run_project_export(repository: Any, project_id: str, output_root: Path | str,
                       options: Optional[Dict[str, Any]] = None) -> Path:
    """Portable worker export with the project's existing ASS/VideoExporter stack."""
    manifest = repository.get_project(project_id)
    if not manifest:
        raise KeyError(project_id)
    source = Path(manifest.source_video_path)
    if not source.is_file():
        raise FileNotFoundError(source)
    options = options or {}
    output_dir = Path(output_root).resolve() / project_id
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{source.stem}-localized.mp4"
    cues = repository.get_cues(project_id)
    from subtitle_localizer.render.ass import AssExporter
    from subtitle_localizer.render.export import VideoExporter
    ass = output_dir / ".lan-subtitles.ass"
    ass.write_text(AssExporter().export_ass_text(cues, script_title=manifest.title,
                                                 use_translated=bool(options.get("use_translated", True))), encoding="utf-8")
    repository.save_stage_run(project_id, StageRunV1(stage_name="export", status="running", progress=0.0))
    try:
        rendered = VideoExporter().render_video(
            source_video_path=source, output_video_path=output, ass_path=ass,
            use_nvenc=bool(options.get("use_nvenc", True)),
            flip_h=bool(options.get("flip_h", False)), flip_v=bool(options.get("flip_v", False)),
            rotation=float(options.get("rotation", 0.0)),
        )
    finally:
        ass.unlink(missing_ok=True)
    current = repository.get_project(project_id) or manifest
    current.has_export = True
    current.export_path = str(rendered).replace("\\", "/")
    current.export_file_size_bytes = rendered.stat().st_size
    repository.save_project(current)
    repository.save_stage_run(project_id, StageRunV1(stage_name="export", status="completed", progress=1.0, end_time=time.time()))
    return rendered
