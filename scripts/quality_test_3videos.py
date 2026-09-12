"""
Comprehensive Full Pipeline Quality Test
Tests: YouTube video, Local file, hongguoduanju.com
Evaluates: masking quality, translation accuracy, voice quality, timing
"""
import json
import sys
import time
import urllib.request
import subprocess
from pathlib import Path
from datetime import datetime

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8899"
RESULTS = []

def api_post(path, data):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))

def api_get(path):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))

def poll_workflow(wf_id, timeout=600):
    """Poll workflow until terminal state."""
    start = time.time()
    last_stage = ""
    stage_times = {}
    while time.time() - start < timeout:
        try:
            status, data = api_get(f"/api/v1/workflows/full-pipeline/{wf_id}")
            state = data.get("state", "unknown")
            current_stage = data.get("current_stage", "")
            if current_stage != last_stage:
                now = time.time() - start
                if last_stage:
                    stage_times[last_stage] = round(now - stage_times.get(f"{last_stage}_start", 0), 1)
                stage_times[f"{current_stage}_start"] = now
                last_stage = current_stage
                print(f"  [{now:.1f}s] Stage: {current_stage} | State: {state}")
            if state in ("completed", "failed", "needs_review", "cancelled"):
                if current_stage:
                    stage_times[current_stage] = round(time.time() - start - stage_times.get(f"{current_stage}_start", 0), 1)
                stage_times = {k: v for k, v in stage_times.items() if not k.endswith("_start")}
                return data, stage_times
        except Exception as e:
            print(f"  Poll error: {e}")
        time.sleep(3)
    return None, stage_times

def probe_media(path):
    cmd = ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, text=True, timeout=15)
    if proc.returncode == 0:
        return json.loads(proc.stdout)
    return None

def check_srt_quality(srt_path):
    p = Path(srt_path)
    if not p.exists():
        return {"exists": False}
    content = p.read_text(encoding="utf-8", errors="replace")
    lines = content.strip().split("\n")
    cue_count = len([l for l in lines if l.strip().isdigit()])
    replacement_chars = content.count("\ufffd")
    timing_lines = [l for l in lines if "-->" in l]
    viet_chars = sum(1 for c in content if ord(c) > 127)
    return {
        "exists": True,
        "line_count": len(lines),
        "cue_count": cue_count,
        "replacement_chars": replacement_chars,
        "timing_entries": len(timing_lines),
        "non_ascii_chars": viet_chars,
        "file_size_bytes": p.stat().st_size,
        "sample_text": "\n".join(lines[:15]),
    }

def run_test(name, url_or_path, is_local=False, dubbing=True, timeout=600):
    print(f"\n{'='*70}")
    print(f"TEST: {name}")
    print(f"Source: {url_or_path}")
    print(f"Dubbing: {dubbing}")
    print(f"{'='*70}")

    result = {
        "name": name,
        "source": url_or_path,
        "is_local": is_local,
        "dubbing_enabled": dubbing,
        "start_time": datetime.now().isoformat(),
    }

    # Step 1: Preview
    print("\n[1] Preview...")
    t0 = time.time()
    try:
        if is_local:
            print("  Local file - skipping preview, creating workflow directly...")
            result["preview_status"] = "skipped (local file)"
            result["preview_time_s"] = 0
        else:
            status, preview = api_post("/api/v1/workflows/full-pipeline/preview", {
                "url": url_or_path,
                "source_language": "auto",
                "target_language": "vi",
            })
            result["preview_status"] = status
            result["preview_time_s"] = round(time.time() - t0, 2)
            result["preview_title"] = preview.get("title", "")
            result["preview_duration"] = preview.get("duration", "")
            result["preview_platform"] = preview.get("platform", "")
            print(f"  Status: {status}")
            print(f"  Title: {preview.get('title', 'N/A')}")
            print(f"  Duration: {preview.get('duration', 'N/A')}")
    except Exception as e:
        result["preview_error"] = str(e)
        print(f"  Preview ERROR: {e}")
        if not is_local:
            result["end_time"] = datetime.now().isoformat()
            result["final_state"] = "preview_failed"
            RESULTS.append(result)
            return result

    # Step 2: Create workflow
    print("\n[2] Creating workflow...")
    t0 = time.time()
    try:
        payload = {
            "source_language": "auto",
            "target_language": "vi",
            "dubbing_enabled": dubbing,
        }
        if is_local:
            payload["local_path"] = url_or_path
        else:
            payload["url"] = url_or_path

        status, wf_data = api_post("/api/v1/workflows/full-pipeline", payload)
        wf_id = wf_data.get("workflow_id", "")
        result["workflow_id"] = wf_id
        result["create_time_s"] = round(time.time() - t0, 2)
        print(f"  Workflow ID: {wf_id}")
    except Exception as e:
        result["create_error"] = str(e)
        print(f"  Create ERROR: {e}")
        result["end_time"] = datetime.now().isoformat()
        result["final_state"] = "create_failed"
        RESULTS.append(result)
        return result

    # Step 3: Poll until completion
    print("\n[3] Polling workflow...")
    t0 = time.time()
    final_data, stage_times = poll_workflow(wf_id, timeout=timeout)
    result["total_pipeline_time_s"] = round(time.time() - t0, 2)
    result["stage_times"] = stage_times

    if final_data is None:
        result["final_state"] = "timeout"
        result["end_time"] = datetime.now().isoformat()
        print(f"  TIMEOUT after {timeout}s")
        RESULTS.append(result)
        return result

    result["final_state"] = final_data.get("state", "unknown")
    result["project_id"] = final_data.get("project_id", "")
    result["artifacts"] = final_data.get("artifacts", {})
    result["errors"] = final_data.get("errors", [])
    print(f"  Final state: {result['final_state']}")
    print(f"  Project ID: {result['project_id']}")
    print(f"  Total time: {result['total_pipeline_time_s']}s")

    if result["final_state"] != "completed":
        result["end_time"] = datetime.now().isoformat()
        RESULTS.append(result)
        return result

    # Step 4: Analyze artifacts
    print("\n[4] Analyzing artifacts...")
    artifacts = result["artifacts"]

    export_mp4 = artifacts.get("export_mp4", "")
    if export_mp4 and Path(export_mp4).exists():
        probe = probe_media(export_mp4)
        if probe:
            streams = probe.get("streams", [])
            fmt = probe.get("format", {})
            video_streams = [s for s in streams if s.get("codec_type") == "video"]
            audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
            result["export_mp4_info"] = {
                "path": export_mp4,
                "file_size_bytes": int(fmt.get("size", 0)),
                "duration_s": float(fmt.get("duration", 0)),
                "has_video": len(video_streams) > 0,
                "has_audio": len(audio_streams) > 0,
                "video_codec": video_streams[0].get("codec_name") if video_streams else None,
                "video_resolution": f"{video_streams[0].get('width')}x{video_streams[0].get('height')}" if video_streams else None,
                "audio_codec": audio_streams[0].get("codec_name") if audio_streams else None,
                "audio_sample_rate": audio_streams[0].get("sample_rate") if audio_streams else None,
            }
            print(f"  MP4: {result['export_mp4_info']['video_resolution']}, {result['export_mp4_info']['audio_codec']}, {result['export_mp4_info']['file_size_bytes']} bytes")

    voiceover = artifacts.get("voiceover_path", "")
    if voiceover and Path(voiceover).exists():
        probe = probe_media(voiceover)
        if probe:
            fmt = probe.get("format", {})
            result["voiceover_info"] = {
                "path": voiceover,
                "file_size_bytes": int(fmt.get("size", 0)),
                "duration_s": float(fmt.get("duration", 0)),
                "codec": probe.get("streams", [{}])[0].get("codec_name"),
            }
            print(f"  Voiceover: {result['voiceover_info']['duration_s']}s, {result['voiceover_info']['file_size_bytes']} bytes")

    srt_path = artifacts.get("srt_path", "")
    if srt_path:
        result["srt_quality"] = check_srt_quality(srt_path)
        print(f"  SRT cues: {result['srt_quality'].get('cue_count', 0)}")
        print(f"  SRT mojibake chars: {result['srt_quality'].get('replacement_chars', 0)}")
        if result["srt_quality"].get("sample_text"):
            print(f"  SRT sample:\n{result['srt_quality']['sample_text']}")

    project_id = result["project_id"]
    if project_id:
        try:
            _, proj_data = api_get(f"/api/v1/projects/{project_id}")
            result["project_manifest"] = {
                "cues_count": proj_data.get("cues_count", 0),
                "translated_count": proj_data.get("translated_count", 0),
                "has_voiceover": proj_data.get("has_voiceover", False),
                "has_export": proj_data.get("has_export", False),
                "export_verified": proj_data.get("export_verified", False),
                "regions": len(proj_data.get("regions", [])),
                "first_cue_text": proj_data.get("first_cue_text", ""),
                "first_cue_original": proj_data.get("first_cue_original", ""),
            }
            print(f"  Cues: {result['project_manifest']['cues_count']} total, {result['project_manifest']['translated_count']} translated")
            print(f"  First cue (original): {result['project_manifest']['first_cue_original']}")
            print(f"  First cue (translated): {result['project_manifest']['first_cue_text']}")
        except Exception as e:
            print(f"  Manifest error: {e}")

    result["end_time"] = datetime.now().isoformat()
    RESULTS.append(result)
    return result


def main():
    print("=" * 70)
    print("COMPREHENSIVE FULL PIPELINE QUALITY TEST")
    print(f"Started: {datetime.now().isoformat()}")
    print("=" * 70)

    # Test 1: Local file test1.mp4 (fastest, ~5 min video)
    run_test(
        name="Local File - test1.mp4 (296s, 720p Chinese drama)",
        url_or_path=r"D:\tesst fim\test1.mp4",
        is_local=True,
        dubbing=True,
        timeout=900,
    )

    # Test 2: YouTube video pP23e8bupEg (45 min drama)
    run_test(
        name="YouTube - Flourished Peony EP1 (国色芳华 第1集, 45min)",
        url_or_path="https://www.youtube.com/watch?v=pP23e8bupEg",
        is_local=False,
        dubbing=True,
        timeout=2400,  # 40 min timeout
    )

    # Test 3: hongguoduanju.com
    run_test(
        name="hongguoduanju.com - 糯糯下山第二季 (ByteDance SPA)",
        url_or_path="https://hongguoduanju.com/detail?series_id=7677801492920667198",
        is_local=False,
        dubbing=True,
        timeout=120,
    )

    # Save results
    out_path = Path("docs/evidence/quality_test_results.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(RESULTS, f, ensure_ascii=False, indent=2)
    print(f"\nResults saved to: {out_path}")
    print(f"\nCompleted: {datetime.now().isoformat()}")


if __name__ == "__main__":
    main()
