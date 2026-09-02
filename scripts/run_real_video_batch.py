"""Run the real OCR pipeline over a directory of local MP4 files."""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer.domain.models import ProjectManifestV1, SubtitleCueV1
from subtitle_localizer.media.fingerprint import compute_video_fingerprint
from subtitle_localizer.ocr.registry import OcrRegistry
from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.persistence.store import AtomicArtifactStore
from subtitle_localizer.render.ass import AssExporter
from subtitle_localizer.render.srt import SrtExporter
from subtitle_localizer.service.worker import BackgroundWorker


@dataclass
class OcrRunResult:
    cues: list[SubtitleCueV1]
    engine_id: str
    elapsed_seconds: float
    warnings: list[str]


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate trustworthy OCR subtitles from local MP4 videos."
    )
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--language", default="zh")
    parser.add_argument("--no-translate", action="store_true")
    parser.add_argument("--max-duration", type=float, default=600.0)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args(argv)
    if args.max_duration <= 0:
        parser.error("--max-duration must be positive")
    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be positive")
    return args


def run_project_ocr(
    video_path: Path,
    state_dir: Path,
    language: str,
    translate: bool,
    max_duration_seconds: float,
) -> OcrRunResult:
    state_dir.mkdir(parents=True, exist_ok=True)
    database = Database(state_dir / "state.db")
    started = time.perf_counter()
    try:
        database.migrate()
        repository = ProjectRepository(database)
        fingerprint = compute_video_fingerprint(video_path)
        project_id = f"batch-{fingerprint[:16]}"
        repository.save_project(
            ProjectManifestV1(
                project_id=project_id,
                title=video_path.stem,
                source_video_path=str(video_path.resolve()),
                video_fingerprint=fingerprint,
                source_language=language,
                target_language="vi" if translate else "none",
            )
        )
        worker = BackgroundWorker(repository)
        descriptor = OcrRegistry().get_provider_for_language(language).get_descriptor()
        if descriptor.format == "mock" or "mock" in descriptor.id.lower():
            raise RuntimeError("Production batch refused a mock OCR provider")
        if not worker.run_pipeline_synchronous(
            project_id,
            max_duration_seconds=max_duration_seconds,
        ):
            runs = repository.get_stage_runs(project_id)
            errors = runs[-1].errors if runs else []
            raise RuntimeError(errors[0] if errors else "OCR pipeline failed")
        cues = repository.get_cues(project_id)
        return OcrRunResult(
            cues=cues,
            engine_id=descriptor.id,
            elapsed_seconds=round(time.perf_counter() - started, 3),
            warnings=[] if cues else ["Real OCR completed but found no subtitle cues"],
        )
    finally:
        database.close()


def extract_evidence_frames(
    video_path: Path,
    cues: list[SubtitleCueV1],
    store: AtomicArtifactStore,
    max_frames: int = 2,
) -> list[str]:
    if not cues or max_frames <= 0:
        return []

    import cv2

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        return []

    frame_paths: list[str] = []
    try:
        if len(cues) <= max_frames:
            selected = cues
        else:
            selected = [cues[0], cues[-1]]
        for index, cue in enumerate(selected, 1):
            timestamp = (cue.start_pts + cue.end_pts) / 2.0
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
            ok, frame = capture.read()
            if not ok or frame is None:
                continue
            encoded_ok, encoded = cv2.imencode(".jpg", frame)
            if not encoded_ok:
                continue
            relative_path = Path("evidence") / f"cue-{index:02d}-{timestamp:.3f}.jpg"
            store.write_atomic(relative_path, encoded.tobytes())
            frame_paths.append(relative_path.as_posix())
    finally:
        capture.release()
    return frame_paths


def _sample_cues(cues: list[SubtitleCueV1], limit: int = 10) -> list[dict[str, object]]:
    return [
        {
            "cue_id": cue.cue_id,
            "start_pts": cue.start_pts,
            "end_pts": cue.end_pts,
            "source_text": cue.source_text,
            "translated_text": cue.translated_text,
            "confidence": cue.confidence,
        }
        for cue in cues[:limit]
    ]


def run_one_video(video_path: Path, args: argparse.Namespace) -> dict[str, object]:
    video_output = args.output_dir.resolve() / video_path.stem
    store = AtomicArtifactStore(video_output)
    report_path = f"{video_path.stem}.report.json"
    started = time.perf_counter()
    try:
        result = run_project_ocr(
            video_path=video_path,
            state_dir=video_output,
            language=args.language,
            translate=not args.no_translate,
            max_duration_seconds=args.max_duration,
        )
        forbidden_markers = ("Sample text", "mock-ocr")
        source_text = "\n".join(cue.source_text for cue in result.cues)
        if any(marker in source_text for marker in forbidden_markers):
            raise RuntimeError("Mock OCR marker detected in production output")

        language_suffix = "vi" if not args.no_translate else args.language
        srt_name = f"{video_path.stem}.{language_suffix}.srt"
        ass_name = f"{video_path.stem}.{language_suffix}.ass"
        use_translated = not args.no_translate
        store.write_atomic(
            srt_name,
            SrtExporter().export_srt_text(result.cues, use_translated=use_translated),
        )
        store.write_atomic(
            ass_name,
            AssExporter().export_ass_text(
                result.cues,
                script_title=video_path.stem,
                use_translated=use_translated,
            ),
        )
        evidence_frames = extract_evidence_frames(video_path, result.cues, store)
        report: dict[str, object] = {
            "status": "completed",
            "video_filename": video_path.name,
            "video_fingerprint": compute_video_fingerprint(video_path),
            "language": args.language,
            "translation_enabled": not args.no_translate,
            "ocr_engine": result.engine_id,
            "cue_count": len(result.cues),
            "elapsed_seconds": result.elapsed_seconds,
            "warnings": result.warnings,
            "errors": [],
            "srt_path": srt_name,
            "ass_path": ass_name,
            "evidence_frames": evidence_frames,
            "sample_cues": _sample_cues(result.cues),
        }
    except Exception as error:
        report = {
            "status": "failed",
            "video_filename": video_path.name,
            "language": args.language,
            "translation_enabled": not args.no_translate,
            "ocr_engine": "rapidocr-onnx",
            "cue_count": 0,
            "elapsed_seconds": round(time.perf_counter() - started, 3),
            "warnings": [],
            "errors": [str(error)],
            "evidence_frames": [],
            "sample_cues": [],
        }
    store.write_atomic(report_path, json.dumps(report, ensure_ascii=False, indent=2))
    return report


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    input_dir = args.input_dir.resolve()
    if not input_dir.is_dir():
        raise SystemExit(f"Input directory does not exist: {input_dir}")

    videos = sorted(input_dir.glob("*.mp4"))
    if args.limit is not None:
        videos = videos[: args.limit]
    if not videos:
        raise SystemExit(f"No .mp4 files found in {input_dir}")

    args.output_dir = args.output_dir.resolve()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    reports = []
    for index, video_path in enumerate(videos, 1):
        print(f"[{index}/{len(videos)}] OCR {video_path.name}", flush=True)
        report = run_one_video(video_path, args)
        reports.append(report)
        print(
            f"  {report['status']}: {report['cue_count']} cues, "
            f"{report['elapsed_seconds']}s",
            flush=True,
        )

    AtomicArtifactStore(args.output_dir).write_atomic(
        "batch-report.json",
        json.dumps(reports, ensure_ascii=False, indent=2),
    )
    return 0 if all(report["status"] == "completed" for report in reports) else 1


if __name__ == "__main__":
    raise SystemExit(main())
