#!/usr/bin/env python3
"""
1-Shot Streaming Batch Translation of 10 Video Clips using Gemini API.
Translates each full clip in 1 SINGLE API request (Zero chunking, maximum token economy).
"""
from __future__ import annotations

import glob
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time
from typing import Any, Dict, List, Tuple
import urllib.request
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
from subtitle_localizer.translation.real import RealTranslationProvider, _capitalize_first

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
        f"Tổng số câu: {len(cues)} | Nguồn: Gemini 2.5 Flash 1-Shot Stream",
        "=" * 60 + "\n",
    ]
    for idx, c in enumerate(cues, 1):
        spk = c.style.get("speaker", "") if isinstance(c.style, dict) else ""
        lines.append(f"[{idx}] [Vai: {spk or 'Chung'}]")
        lines.append(f"  GỐC : {c.source_text}")
        lines.append(f"  DỊCH: {c.translated_text}\n")
    out_path.write_text("\n".join(lines), encoding="utf-8")


def translate_clip_economical(
    cues: List[SubtitleCueV1],
    provider: RealTranslationProvider,
    pool: Any,
    clip_name: str,
) -> float:
    t0 = time.perf_counter()
    all_indices = [i for i, c in enumerate(cues) if c.source_text.strip()]
    if not all_indices:
        return 0.0

    # Nếu <= 120 câu: 1-shot 100% trong 1 request duy nhất
    # Nếu > 120 câu: chia cụm 90 câu để không bao giờ chạm ngưỡng 8192 tokens
    chunk_size = len(all_indices) if len(all_indices) <= 120 else 90

    for start_idx in range(0, len(all_indices), chunk_size):
        chunk_indices = all_indices[start_idx : start_idx + chunk_size]
        batch_items = [f"[{i+1}] {cues[i].source_text.strip()}" for i in chunk_indices]
        prompt = provider._build_narrative_prompt(batch_items, "zh", "vi", "dramatic")

        payload = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 8192,
                "thinkingConfig": {"thinkingBudget": 0},
            }
        }).encode("utf-8")

        success = False
        for attempt in range(min(pool.total_keys, 15)):
            key = pool.get_next_key()
            if not key:
                time.sleep(1.0)
                continue

            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={key}"
            req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})

            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    status_code = getattr(resp, "status", getattr(resp, "code", 200))
                    if status_code == 200:
                        res = json.loads(resp.read().decode("utf-8"))
                        cand = res.get("candidates", [{}])[0]
                        parts = cand.get("content", {}).get("parts", [])
                        combined_output = "".join(p.get("text", "") for p in parts)
                        if combined_output:
                            provider._apply_model_response(cues, chunk_indices, combined_output)
                            success = True
                            break
            except urllib.error.HTTPError as err:
                if err.code == 429:
                    pool.mark_rate_limited(key, cooldown_seconds=60.0, reason="rate_limited")
                elif err.code == 503:
                    time.sleep(1.0)
                continue
            except Exception:
                continue

    elapsed = time.perf_counter() - t0
    return elapsed


def main() -> None:
    print("=" * 70, flush=True)
    print("SUBTITLE LOCALIZER STUDIO - 1-SHOT STREAMING TRANSLATION (10 CLIPS)", flush=True)
    print("Mỗi clip dịch trong 1 request duy nhất - Tiết kiệm tối đa Input Token & Quota!", flush=True)
    print("=" * 70, flush=True)

    pool = get_global_gemini_pool()
    print(f"[*] Initialized Gemini Key Pool with {pool.total_keys} active keys.", flush=True)
    provider = RealTranslationProvider()

    source_srts = sorted(glob.glob(str(ROOT / "benchmarks" / "results" / "10videos_benchmark" / "*_adaptive.srt")))
    total_clips = len(source_srts)
    print(f"[*] Total clips to translate: {total_clips}", flush=True)

    master_manifest: Dict[str, Any] = {
        "dataset_name": "gemini_10clips_ground_truth_1shot",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "provider": "gemini",
        "model": "gemini-2.5-flash",
        "mode": "1-shot-streaming",
        "total_clips": total_clips,
        "clips": [],
    }

    t_all_start = time.perf_counter()
    total_translated_cues = 0

    for idx, srt_file in enumerate(source_srts, 1):
        srt_path = Path(srt_file)
        clip_name = srt_path.stem.replace("_adaptive", "")
        print(f"\n[{idx}/{total_clips}] Translating ALL cues of '{clip_name}' in 1 SINGLE REQUEST...", flush=True)

        cues = parse_srt_file(srt_path)
        if not cues:
            print(f"  [-] Skipped {clip_name}: No cues.", flush=True)
            continue

        print(f"  -> Translating with Adaptive 1-Shot / Economy Token Engine...", flush=True)
        try:
            elapsed = translate_clip_economical(cues, provider, pool, clip_name)
            translated_count = sum(1 for c in cues if c.translated_text.strip() and c.translated_text != c.source_text)
            print(f"  [+] SUCCESS [{idx}/{total_clips}]: {translated_count}/{len(cues)} cues translated in {elapsed:.1f}s ({translated_count/max(0.1, elapsed):.1f} cues/s)!", flush=True)
            total_translated_cues += translated_count
        except Exception as e:
            print(f"  [-] ERROR on {clip_name}: {e}", flush=True)
            continue

        # Save files immediately
        out_srt = OUTPUT_DIR / f"{clip_name}_gemini_vi.srt"
        out_txt = OUTPUT_DIR / f"{clip_name}_bilingual.txt"
        export_translated_srt(cues, out_srt)
        export_bilingual_txt(cues, out_txt, clip_name)

        # Copy to Desktop
        shutil.copy2(out_srt, DESKTOP_FOLDER / f"{clip_name}_gemini_vi.srt")
        shutil.copy2(out_txt, DESKTOP_FOLDER / f"{clip_name}_bilingual.txt")
        print(f"  [+] Saved to Desktop folder: {DESKTOP_FOLDER / out_srt.name}", flush=True)

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

    # Master JSON
    master_json_path = OUTPUT_DIR / "gemini_10clips_master.json"
    master_json_path.write_text(json.dumps(master_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    shutil.copy2(master_json_path, DESKTOP_FOLDER / "gemini_10clips_master.json")

    # ZIP Package
    with zipfile.ZipFile(ZIP_OUTPUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for root_dir, _, files in os.walk(OUTPUT_DIR):
            for file in files:
                full_path = Path(root_dir) / file
                arcname = full_path.relative_to(OUTPUT_DIR)
                zf.write(full_path, arcname)

    shutil.copy2(ZIP_OUTPUT, DESKTOP_ZIP)
    total_time = time.perf_counter() - t_all_start

    print("\n" + "=" * 70, flush=True)
    print("ALL 10 CLIPS TRANSLATED 1-SHOT & PACKAGED SUCCESSFULLY!", flush=True)
    print(f"Total Cues Translated: {total_translated_cues} | Total Time: {total_time:.1f}s", flush=True)
    print(f"Desktop Folder: {DESKTOP_FOLDER}", flush=True)
    print(f"Desktop ZIP   : {DESKTOP_ZIP}", flush=True)
    print("=" * 70, flush=True)


if __name__ == "__main__":
    main()
