#!/usr/bin/env python3
"""Benchmark local Ollama translation against the stored API/Gemini OCR set."""
from __future__ import annotations

import argparse, copy, json, re, time, urllib.request
from pathlib import Path
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.translation.real import RealTranslationProvider, _refine_subtitles

HAN = re.compile(r"[\u4e00-\u9fff]")
TOK = re.compile(r"\w+", re.UNICODE)

def f1(a: str, b: str) -> float:
    aa, bb = TOK.findall(a.lower()), TOK.findall(b.lower())
    if not aa or not bb: return 0.0
    from collections import Counter
    x, y = Counter(aa), Counter(bb)
    hit = sum((x & y).values())
    return 2 * hit / (len(aa) + len(bb))

def load(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    rows = []
    for clip in data["clips"]:
        for c in clip["cues"]:
            if c.get("is_valid_dialogue") and str(c.get("target_vi_gemini", "")).strip():
                rows.append({"clip": clip["clip_name"], "source": str(c["source_zh"]), "ref": str(c["target_vi_gemini"]), "speaker": str(c.get("speaker_role", ""))})
    return rows

def call(endpoint: str, model: str, prompt: str, ctx: int, temperature: float) -> str:
    payload = {"model": model, "messages": [{"role":"system","content":"You are a professional subtitle localization assistant."},{"role":"user","content":prompt}], "temperature":temperature,"stream":False,"options":{"seed":42,"num_ctx":ctx}}
    req = urllib.request.Request(endpoint.rstrip("/")+"/api/chat", data=json.dumps(payload, ensure_ascii=False).encode(), headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=300) as r: return str(json.loads(r.read().decode()).get("message",{}).get("content", ""))

def main() -> int:
    ap=argparse.ArgumentParser(); ap.add_argument("--models",required=True); ap.add_argument("--batch",type=int,default=8); ap.add_argument("--ctx",type=int,default=4096); ap.add_argument("--retry",type=int,default=1); ap.add_argument("--temperature",type=float,default=0.1); ap.add_argument("--endpoint",default="http://localhost:11434"); ap.add_argument("--output",type=Path,default=ROOT/"benchmarks/results/ocr_api_head_to_head.json")
    ap.add_argument("--dataset",type=Path,default=ROOT/"GEMINI_10CLIPS_CONSOLIDATED_GROUND_TRUTH.json"); a=ap.parse_args()
    rows=load(a.dataset); provider=RealTranslationProvider(); out=[]
    for model in [x.strip() for x in a.models.split(",") if x.strip()]:
        start=time.perf_counter(); preds=[""]*len(rows); errors=[]
        for pos in range(0,len(rows),a.batch):
            ix=list(range(pos,min(pos+a.batch,len(rows))))
            items=[f"[{j+1}] {rows[i]['source']}" for j,i in enumerate(ix)]
            prompt=provider._build_narrative_prompt(items,"zh","vi",prompt_tone="dramatic",batch_ordinal=pos//a.batch+1,batch_total=(len(rows)+a.batch-1)//a.batch)+"\nCẤM KÝ TỰ HÁN. CHỈ TRẢ CÁC DÒNG [số] bản dịch tiếng Việt."
            if model.lower().startswith("qwen3"):
                prompt += "\n/no_think"
            try:
                raw=call(a.endpoint,model,prompt,a.ctx,a.temperature); cues=[SubtitleCueV1(cue_id=str(i),start_pts=0,end_pts=0,source_text=rows[i]["source"]) for i in ix]; provider._apply_model_response(cues,list(range(len(cues))),raw)
                for i,c in zip(ix,cues): preds[i]=_refine_subtitles(str(c.translated_text or ""),rows[i]["source"],preserve_existing=True)
            except Exception as e: errors.append(f"batch {pos//a.batch+1}: {e}")
        for _ in range(max(0,a.retry)):
            for i,pred in enumerate(preds):
                if pred.strip() and not HAN.search(pred): continue
                prompt=provider._build_narrative_prompt([f"[1] {rows[i]['source']}"],"zh","vi",prompt_tone="literal",batch_ordinal=1,batch_total=1)+"\nCHỈ TRẢ MỘT CÂU TIẾNG VIỆT. CẤM KÝ TỰ HÁN, KHÔNG GIẢI THÍCH."
                if model.lower().startswith("qwen3"):
                    prompt += "\n/no_think"
                try:
                    raw=call(a.endpoint,model,prompt,a.ctx,a.temperature); cue=SubtitleCueV1(cue_id="1",start_pts=0,end_pts=0,source_text=rows[i]["source"]); provider._apply_model_response([cue],[0],raw); preds[i]=_refine_subtitles(str(cue.translated_text or ""),rows[i]["source"],preserve_existing=True)
                except Exception as e: errors.append(f"retry {i+1}: {e}")
        scores=[f1(p,r["ref"]) for p,r in zip(preds,rows)]; nonempty=[bool(p.strip()) for p in preds]
        result={"model":model,"cues":len(rows),"empty":len(rows)-sum(nonempty),"cjk":sum(bool(HAN.search(p)) for p in preds),"token_f1":round(sum(scores)/len(scores)*100,3),"token_f1_nonempty":round(sum(s for s,p in zip(scores,preds) if p.strip())/max(1,sum(nonempty))*100,3),"elapsed_seconds":round(time.perf_counter()-start,3),"cues_per_second":round(len(rows)/(time.perf_counter()-start),3),"errors":errors,"by_clip":{}}
        for clip in sorted({r["clip"] for r in rows}):
            ids=[i for i,r in enumerate(rows) if r["clip"]==clip]; result["by_clip"][clip]={"cues":len(ids),"empty":sum(not preds[i].strip() for i in ids),"token_f1":round(sum(scores[i] for i in ids)/len(ids)*100,3)}
        out.append(result); print(json.dumps(result,ensure_ascii=False),flush=True)
    a.output.parent.mkdir(parents=True,exist_ok=True); a.output.write_text(json.dumps({"dataset":str(a.dataset),"reference":"stored Gemini/API","results":out},ensure_ascii=False,indent=2),encoding="utf-8"); return 0
if __name__=="__main__": raise SystemExit(main())
