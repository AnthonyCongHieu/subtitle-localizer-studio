#!/usr/bin/env python3
"""
High-Speed Parallel Batch Translation of 10 Video Clips using Gemini API Rotating Key Pool.
Generates Ground Truth reference dataset and packages it for remote RTX 5090 workstation.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import glob
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
from typing import Any, Dict, List, Tuple
import zipfile

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.render.srt import format_srt_time
from subtitle_localizer.translation.key_pool import get_global_gemini_pool
from subtitle_localizer.translation.real import RealTranslationProvider

OUTPUT_DIR = ROOT / "benchmarks" / "results" / "gemini_10clips_ground_truth"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
ZIP_OUTPUT = ROOT / "benchmarks" / "results" / "GEMINI_10CLIPS_GROUND_TRUTH.zip"
DESKTOP_ZIP = Path("C:/Users/pc2/Desktop/GEMINI_10CLIPS_GROUND_TRUTH.zip")
DESKTOP_FOLDER = Path("C:/Users/pc2/Desktop/GEMINI_10CLIPS_GROUND_TRUTH")
DESKTOP_FOLDER.mkdir(parents=True, exist_ok=True)


def parse_srt_time(time_str: str) -> float:
    match = re.match(r"(\d+):(\d+):(\d+)[,\.](\d+)", time_str.strip())
    if not match:
        return 0.0
    h, m, s, ms = match.groups()
    return int(h) * 3600.0 + int(m) * 60.0 + int(s) + int(ms) / 1000.0


def parse_srt_file(srt_path: Path) -> List[SubtitleCueV1]:
    content = srt_path.read_text(encoding="utf-8")
    blocks = re.split(r"\n\s*\n", content.strip())
    cues: List[SubtitleCueV1] = []
    
    for b in blocks:
        lines = [line.strip() for line in b.splitlines() if line.strip()]
        if len(lines) >= 3 and "-->" in lines[1]:
            cue_id = lines[0]
            m = re.match(r"(.*?)\s*-->\s*(.*)", lines[1])
            if m:
                start_pts = parse_srt_time(m.group(1))
                end_pts = parse_srt_time(m.group(2))
                source_text = " ".join(lines[2:])
                cues.append(
                    SubtitleCueV1(
                        cue_id=cue_id,
                        start_pts=start_pts,
                        end_pts=end_pts,
                        source_text=source_text,
                        translated_text="",
                        style={},
                    )
                )
    return cues


def export_translated_srt(cues: List[SubtitleCueV1], out_path: Path) -> None:
    lines: List[str] = []
    for idx, c in enumerate(cues, 1):
        spk = c.style.get("speaker", "") if isinstance(c.style, dict) else ""
        spk_tag = f"[{'Nam' if spk == 'male' else 'Nữ' if spk == 'female' else spk}] " if spk else ""
        trans_txt = c.translated_text.strip() or c.source_text.strip()
        lines.append(f"{idx}\n{format_srt_time(c.start_pts)} --> {format_srt_time(c.end_pts)}\n{spk_tag}{trans_txt}\n")
    out_path.write_text("\n".join(lines), encoding="utf-8")


def export_bilingual_txt(cues: List[SubtitleCueV1], out_path: Path, clip_name: str) -> None:
    lines: List[str] = [
        f"=== BẢN DỊCH ĐỐI CHIẾU SONG NGỮ: {clip_name} ===",
        f"Tổng số câu: {len(cues)} | Nguồn: Gemini 2.5 Flash Ground Truth",
        "=" * 60 + "\n",
    ]
    for idx, c in enumerate(cues, 1):
        spk = c.style.get("speaker", "") if isinstance(c.style, dict) else ""
        lines.append(f"[{idx}] [Vai: {spk or 'Chung'}]")
        lines.append(f"  GỐC : {c.source_text}")
        lines.append(f"  DỊCH: {c.translated_text}\n")
    out_path.write_text("\n".join(lines), encoding="utf-8")


def translate_cues_parallel(
    cues: List[SubtitleCueV1],
    provider: RealTranslationProvider,
    pool: Any,
    clip_name: str,
    clip_idx: int,
    total_clips: int,
    chunk_size: int = 35,
    max_workers: int = 6,
) -> float:
    t0 = time.perf_counter()
    all_indices = [i for i, c in enumerate(cues) if c.source_text.strip()]
    chunks = [all_indices[i : i + chunk_size] for i in range(0, len(all_indices), chunk_size)]
    total_chunks = len(chunks)
    print(f"  [+] Splitting {len(cues)} cues into {total_chunks} parallel chunks (max_workers={max_workers})...", flush=True)

    def _worker(c_idx: int, indices: List[int]) -> Tuple[int, int, float, bool]:
        t_w = time.perf_counter()
        sub_cues = [cues[i] for i in indices]
        ok = provider._translate_with_gemini(
            cues=sub_cues,
            source_lang="zh",
            target_lang="vi",
            key_pool=pool,
            gemini_model="gemini-2.5-flash",
            prompt_tone="dramatic",
        )
        elapsed_w = time.perf_counter() - t_w
        return c_idx, len(indices), elapsed_w, ok

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_worker, i + 1, ch): i for i, ch in enumerate(chunks)}
        for fut in as_completed(futures):
            c_idx, count, elapsed_w, ok = fut.result()
            print(f"    -> [Clip {clip_idx}/{total_clips}] Chunk {c_idx}/{total_chunks} ({count} cues) done in {elapsed_w:.1f}s | Status: {'OK' if ok else 'RETRY'}", flush=True)

    total_elapsed = time.perf_counter() - t0
    return total_elapsed


def main() -> None:
    print("=" * 70, flush=True)
    print("SUBTITLE LOCALIZER STUDIO - PARALLEL GEMINI 10 CLIPS TRANSLATION", flush=True)
    print("=" * 70, flush=True)

    pool = get_global_gemini_pool()
    print(f"[*] Initialized Gemini Key Pool with {pool.total_keys} active keys.", flush=True)
    if pool.total_keys == 0:
        print("[-] Error: No Gemini API keys found!", flush=True)
        sys.exit(1)

    provider = RealTranslationProvider()

    source_srts = sorted(glob.glob(str(ROOT / "benchmarks" / "results" / "10videos_benchmark" / "*_adaptive.srt")))
    total_clips = len(source_srts)
    print(f"[*] Found {total_clips} video clips to translate in parallel.", flush=True)

    master_manifest: Dict[str, Any] = {
        "dataset_name": "gemini_10clips_ground_truth",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "provider": "gemini",
        "model": "gemini-2.5-flash",
        "total_clips": total_clips,
        "clips": [],
    }

    total_translated_cues = 0
    t_start = time.perf_counter()

    for idx, srt_file in enumerate(source_srts, 1):
        srt_path = Path(srt_file)
        clip_name = srt_path.stem.replace("_adaptive", "")
        print(f"\n==================================================", flush=True)
        print(f"[{idx}/{total_clips}] STARTING CLIP: {clip_name}", flush=True)
        print(f"==================================================", flush=True)

        cues = parse_srt_file(srt_path)
        if not cues:
            print(f"  [-] Skipped {clip_name}: No cues parsed.", flush=True)
            continue

        # Run parallel translation on chunks
        elapsed = translate_cues_parallel(
            cues=cues,
            provider=provider,
            pool=pool,
            clip_name=clip_name,
            clip_idx=idx,
            total_clips=total_clips,
            chunk_size=35,
            max_workers=6,
        )

        translated_count = sum(1 for c in cues if c.translated_text.strip() and c.translated_text != c.source_text)
        print(f"\n[+] FINISHED CLIP [{idx}/{total_clips}]: {translated_count}/{len(cues)} cues translated in {elapsed:.1f}s ({translated_count / max(0.1, elapsed):.1f} cues/s)!", flush=True)

        total_translated_cues += translated_count

        # Save files immediately
        out_srt = OUTPUT_DIR / f"{clip_name}_gemini_vi.srt"
        out_txt = OUTPUT_DIR / f"{clip_name}_bilingual.txt"
        export_translated_srt(cues, out_srt)
        export_bilingual_txt(cues, out_txt, clip_name)

        # Copy also to Desktop folder immediately
        shutil.copy2(out_srt, DESKTOP_FOLDER / f"{clip_name}_gemini_vi.srt")
        shutil.copy2(out_txt, DESKTOP_FOLDER / f"{clip_name}_bilingual.txt")
        print(f"  [+] Saved SRT and TXT to Desktop folder: {DESKTOP_FOLDER / out_srt.name}", flush=True)

        clip_data = {
            "clip_id": idx,
            "clip_name": clip_name,
            "total_cues": len(cues),
            "translated_cues": translated_count,
            "duration_s": round(elapsed, 2),
            "cues": [
                {
                    "cue_id": c.cue_id,
                    "start_pts": c.start_pts,
                    "end_pts": c.end_pts,
                    "source_zh": c.source_text,
                    "target_vi_gemini": c.translated_text,
                    "speaker": c.style.get("speaker", "") if isinstance(c.style, dict) else "",
                }
                for c in cues
            ],
        }
        master_manifest["clips"].append(clip_data)

    # Save Master JSON
    master_json_path = OUTPUT_DIR / "gemini_10clips_master.json"
    master_json_path.write_text(json.dumps(master_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    shutil.copy2(master_json_path, DESKTOP_FOLDER / "gemini_10clips_master.json")
    print(f"\n[+] Master JSON saved: {master_json_path}", flush=True)

    # Create ZIP archive
    print(f"[*] Packaging into ZIP archive: {ZIP_OUTPUT}...", flush=True)
    with zipfile.ZipFile(ZIP_OUTPUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for root_dir, _, files in os.walk(OUTPUT_DIR):
            for file in files:
                full_path = Path(root_dir) / file
                arcname = full_path.relative_to(OUTPUT_DIR)
                zf.write(full_path, arcname)

    print(f"[+] ZIP Package created: {ZIP_OUTPUT} ({ZIP_OUTPUT.stat().st_size / 1024:.1f} KB)", flush=True)

    # Copy ZIP to Desktop
    try:
        shutil.copy2(ZIP_OUTPUT, DESKTOP_ZIP)
        print(f"[+] ZIP copied to Desktop: {DESKTOP_ZIP}", flush=True)
    except Exception as e:
        print(f"[-] Could not copy to desktop: {e}", flush=True)

    total_time = time.perf_counter() - t_start
    print("\n" + "=" * 70, flush=True)
    print("ALL 10 CLIPS TRANSLATED & PACKAGED SUCCESSFULLY!", flush=True)
    print(f"Total Cues Translated: {total_translated_cues} | Total Time: {total_time:.1f}s", flush=True)
    print(f"Desktop Folder: {DESKTOP_FOLDER}", flush=True)
    print(f"Desktop ZIP   : {DESKTOP_ZIP}", flush=True)
    print("=" * 70, flush=True)


if __name__ == "__main__":
    main()
