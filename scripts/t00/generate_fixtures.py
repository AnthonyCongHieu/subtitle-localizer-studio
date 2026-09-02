from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "src"))

from subtitle_localizer_t00.fixtures import has_variable_frame_intervals

LANGUAGE_LINES = ["中文：字幕測試", "日本語：字幕テスト", "한국어: 자막 테스트", "English: subtitle test", "Tiếng Việt: kiểm tra phụ đề"]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run(command: list[str]) -> None:
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    if completed.returncode:
        raise RuntimeError((completed.stderr or completed.stdout).strip())


def _probe(path: Path) -> dict[str, object]:
    completed = subprocess.run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)], check=True, capture_output=True, text=True)
    return json.loads(completed.stdout)


def _frame_timestamps(path: Path) -> list[float]:
    completed = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(path)], check=True, capture_output=True, text=True)
    payload = json.loads(completed.stdout)
    return [float(frame["best_effort_timestamp_time"]) for frame in payload.get("frames", []) if "best_effort_timestamp_time" in frame]


def _subtitle_filter(srt_path: Path) -> str:
    escaped = srt_path.resolve().as_posix().replace(":", "\\:").replace("'", "\\'")
    return f"subtitles=filename='{escaped}':charenc=UTF-8"


def _write_srt(path: Path) -> None:
    rows = []
    for index, line in enumerate(LANGUAGE_LINES):
        start = f"00:00:0{index},000"
        end = f"00:00:0{index + 1},000"
        rows.extend([str(index + 1), f"{start} --> {end}", line, ""])
    path.write_text("\n".join(rows), encoding="utf-8")


def _encode_cfr(output: Path, subtitle: Path) -> None:
    _run(["ffmpeg", "-y", "-hide_banner", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=10:d=5", "-vf", _subtitle_filter(subtitle), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-metadata", "creation_time=1970-01-01T00:00:00Z", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-threads", "1", str(output)])


def _encode_vfr(output: Path, subtitle: Path) -> None:
    selected_frames = "select='eq(n,0)+eq(n,7)+eq(n,18)+eq(n,24)+eq(n,37)+eq(n,49)'"
    _run(["ffmpeg", "-y", "-hide_banner", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=10:d=5", "-vf", f"{_subtitle_filter(subtitle)},{selected_frames}", "-fps_mode", "vfr", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-metadata", "creation_time=1970-01-01T00:00:00Z", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-threads", "1", str(output)])


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate ignored deterministic T00 CFR/VFR UTF-8 synthetic fixtures using FFmpeg.")
    parser.add_argument("--output-dir", type=Path, default=REPOSITORY_ROOT / "fixtures" / "synthetic" / "generated")
    arguments = parser.parse_args()
    root = arguments.output_dir
    root.mkdir(parents=True, exist_ok=True)
    subtitle = root / "multilingual.srt"
    _write_srt(subtitle)
    cfr = root / "multilingual-cfr.mp4"
    vfr = root / "multilingual-vfr.mp4"
    _encode_cfr(cfr, subtitle)
    _encode_vfr(vfr, subtitle)
    cfr_probe = _probe(cfr)
    vfr_probe = _probe(vfr)
    if "format" in cfr_probe and isinstance(cfr_probe["format"], dict):
        cfr_probe["format"]["filename"] = cfr.name
    if "format" in vfr_probe and isinstance(vfr_probe["format"], dict):
        vfr_probe["format"]["filename"] = vfr.name
    vfr_timestamps = _frame_timestamps(vfr)
    if not has_variable_frame_intervals(vfr_timestamps):
        raise RuntimeError("FFmpeg output did not retain variable frame timestamps")
    manifest = {
        "schema_version": "synthetic-fixture-manifest-v1",
        "fixtures": [
            {"id": "multilingual-cfr", "path": cfr.name, "timing": "cfr", "sha256": _sha256(cfr), "languages": ["zh", "ja", "ko", "en", "vi"], "ffprobe": cfr_probe},
            {"id": "multilingual-vfr", "path": vfr.name, "timing": "vfr", "sha256": _sha256(vfr), "languages": ["zh", "ja", "ko", "en", "vi"], "ffprobe": {**vfr_probe, "frame_pts_seconds": vfr_timestamps}},
        ],
    }
    manifest_path = root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
