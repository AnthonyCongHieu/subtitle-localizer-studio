import json
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

with open("benchmarks/results/translation_benchmark_results.json", encoding="utf-8") as f:
    data = json.load(f)

cues = data.get("dataset", {}).get("cues", [])
trans = data.get("golden_baseline", {}).get("translations", {})
meta = data.get("golden_baseline", {}).get("metadata", {})

print(f"Total cues: {len(cues)} | Metadata: {meta}")

# Xuất ra file đối chiếu song ngữ chuẩn
output_txt = "benchmarks/results/GEMINI_GOLDEN_BASELINE_FULL_CLIP.txt"
with open(output_txt, "w", encoding="utf-8") as out:
    out.write("================================================================================\n")
    out.write(f"GEMINI 2.5 FLASH - BẢN DỊCH ĐỐI CHUẨN VÀNG (GOLDEN BASELINE CHUẨN)\n")
    out.write(f"Model: {meta.get('model', 'gemini-2.5-flash')} | Thời gian: {meta.get('created_at', '')}\n")
    out.write("Quy ước: [Mã ID] [Phân vai: Nam/Nữ] Câu gốc tiếng Trung => Bản dịch tiếng Việt\n")
    out.write("================================================================================\n\n")

    for c in cues:
        cid = str(c["id"])
        tr = trans.get(cid, {})
        tr_text = tr.get("translation", "") if isinstance(tr, dict) else str(tr)
        spk = tr.get("speaker", "") if isinstance(tr, dict) else ""
        orig = c.get("origin", "")
        out.write(f"[{cid}] [{spk}] [{orig}]\n")
        out.write(f"   GỐC  : {c['source']}\n")
        out.write(f"   DỊCH : {tr_text}\n\n")

print(f"Exported clean golden baseline to {output_txt}")

# Print first 15 entries
with open(output_txt, encoding="utf-8") as f:
    lines = f.readlines()
    for l in lines[:40]:
        sys.stdout.write(l)
