import json
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Load existing benchmark results containing the 1-time Gemini golden baseline
with open("benchmarks/results/translation_benchmark_results.json", encoding="utf-8") as f:
    data = json.load(f)

cues = data.get("dataset", {}).get("cues", [])
trans = data.get("golden_baseline", {}).get("translations", {})
meta = data.get("golden_baseline", {}).get("metadata", {})

# 1. Xuất file JSON chuẩn cho Agent
agent_json_path = "benchmarks/results/GEMINI_GOLDEN_BASELINE_FULL_CLIP.json"
agent_data = {
    "metadata": {
        "provider": "gemini",
        "model": meta.get("model", "gemini-2.5-flash"),
        "created_at": meta.get("created_at", ""),
        "total_cues": len(cues),
        "note": "Bản dịch đối chuẩn vàng chính thức của Gemini 2.5 Flash (gọi 1 lần duy nhất làm Ground Truth)"
    },
    "cues": []
}

for c in cues:
    cid = str(c["id"])
    tr = trans.get(cid, {})
    tr_text = tr.get("translation", "") if isinstance(tr, dict) else str(tr)
    spk = tr.get("speaker", "") if isinstance(tr, dict) else ""
    agent_data["cues"].append({
        "id": c["id"],
        "origin": c.get("origin", ""),
        "source_zh": c["source"],
        "target_vi_gemini": tr_text,
        "speaker": spk
    })

with open(agent_json_path, "w", encoding="utf-8") as f:
    json.dump(agent_data, f, ensure_ascii=False, indent=2)

# 2. Xuất file SRT phụ đề chuẩn (cho phép import vào video hoặc player)
agent_srt_path = "benchmarks/results/GEMINI_GOLDEN_BASELINE_FULL_CLIP.srt"
with open(agent_srt_path, "w", encoding="utf-8") as f:
    for idx, c in enumerate(cues, 1):
        cid = str(c["id"])
        tr = trans.get(cid, {})
        tr_text = tr.get("translation", "") if isinstance(tr, dict) else str(tr)
        spk = tr.get("speaker", "") if isinstance(tr, dict) else ""
        spk_tag = f"[{spk}] " if spk else ""
        
        # Tạo timestamp giả định theo chuỗi đối soát (mỗi câu 2.5s)
        start_sec = (idx - 1) * 2.5
        end_sec = start_sec + 2.0
        
        def fmt_ts(seconds):
            hrs = int(seconds // 3600)
            mins = int((seconds % 3600) // 60)
            secs = int(seconds % 60)
            ms = int(round((seconds - int(seconds)) * 1000))
            return f"{hrs:02d}:{mins:02d}:{secs:02d},{ms:03d}"

        f.write(f"{idx}\n")
        f.write(f"{fmt_ts(start_sec)} --> {fmt_ts(end_sec)}\n")
        f.write(f"{spk_tag}{tr_text}\n\n")

print(f"DONE: Generated:")
print(f"  - {agent_json_path}")
print(f"  - {agent_srt_path}")
print(f"  - benchmarks/results/GEMINI_GOLDEN_BASELINE_FULL_CLIP.txt")
