#!/usr/bin/env python3
"""Repeatable Local translation model/algorithm matrix benchmark.

Input is a JSON list of production cue objects (``source_text`` is required).
The runner never writes to the project database; it calls Ollama directly,
uses the production prompt/parser, and records structural language metrics.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.translation.real import RealTranslationProvider, _refine_subtitles

STRUCTURED_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "id": {"type": "integer"},
            "speaker": {"type": "string"},
            "text": {"type": "string"},
        },
        "required": ["id", "text"],
        "additionalProperties": False,
    },
}


def call_ollama(endpoint: str, model: str, prompt: str, temperature: float, num_ctx: int, structured: bool = False) -> str:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a professional subtitle localization assistant."},
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "stream": False,
        "options": {"seed": 42, "num_ctx": num_ctx},
    }
    if structured:
        # Ollama accepts a JSON Schema here; constrained decoding prevents the
        # parser from confusing prose/markdown with translated cue records.
        payload["format"] = STRUCTURED_SCHEMA
    request = urllib.request.Request(
        endpoint.rstrip("/") + "/api/chat",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        body = json.loads(response.read().decode("utf-8"))
    return str(body.get("message", {}).get("content", ""))


def apply_structured_response(provider: RealTranslationProvider, cues: list[SubtitleCueV1], indices: list[int], raw: str) -> int:
    try:
        decoded = json.loads(raw)
    except json.JSONDecodeError:
        return 0
    items = decoded if isinstance(decoded, list) else decoded.get("translations", []) if isinstance(decoded, dict) else []
    by_id = {}
    for item in items:
        if isinstance(item, dict) and item.get("id") is not None:
            try:
                item_id = int(item["id"])
            except (TypeError, ValueError):
                continue
            by_id[item_id] = item
    updated = 0
    for position, index in enumerate(indices, start=1):
        item = by_id.get(position)
        text = str(item.get("text", "")).strip() if item else ""
        if not text:
            continue
        cue = cues[index]
        # ``_refine_subtitles`` is intentionally a module-level helper in the
        # production translator (it is not a provider method).  Calling it on
        # the provider made every structured-output batch fail before any cue
        # was recorded.
        cleaned = _refine_subtitles(text, cue.source_text, preserve_existing=True)
        if provider._is_invalid_translation(cleaned, cue.source_text, target_lang="vi"):
            continue
        cue.translated_text = cleaned
        if isinstance(item.get("speaker"), str) and item["speaker"]:
            cue.style = dict(cue.style or {})
            cue.style["speaker"] = "female" if item["speaker"].lower() in {"nữ", "nu", "female"} else "male"
        updated += 1
    return updated


def metric(cues: list[SubtitleCueV1], elapsed: float) -> dict[str, object]:
    translations = [str(c.translated_text or "") for c in cues]
    return {
        "cues": len(cues),
        "empty": sum(not text.strip() for text in translations),
        "cjk": sum(bool(re.search(r"[\u4e00-\u9fff]", text)) for text in translations),
        "english_signal": sum(bool(re.search(r"\b(the|you|what|this|that|is|are|not|with)\b", text, re.I)) for text in translations),
        "ellipsis": sum(bool(re.search(r"(?:\.{3,}|…)", text)) for text in translations),
        "repeated_ellipsis": sum(bool(re.search(r"(?:\.{3,}|…).*(?:\.{3,}|…)", text)) for text in translations),
        "avg_chars": round(sum(map(len, translations)) / max(1, len(translations)), 2),
        "elapsed_seconds": round(elapsed, 3),
    }


def _needs_retry(cue: SubtitleCueV1) -> bool:
    text = str(cue.translated_text or "").strip()
    # For a Vietnamese target, any remaining Han character is a hard failure;
    # short runs were previously missed by the production ratio heuristic.
    return not text or bool(re.search(r"[\u4e00-\u9fff]", text))


def run(
    cues: list[SubtitleCueV1],
    model: str,
    batch_size: int,
    temperature: float,
    endpoint: str,
    num_ctx: int,
    structured: bool = False,
    retry_invalid: int = 0,
) -> dict[str, object]:
    provider = RealTranslationProvider()
    working = copy.deepcopy(cues)
    started = time.perf_counter()
    errors: list[str] = []
    for start in range(0, len(working), batch_size):
        indices = list(range(start, min(start + batch_size, len(working))))
        items = [f"[{pos}] {working[idx].source_text.strip()}" for pos, idx in enumerate(indices, start=1)]
        prompt = provider._build_narrative_prompt(
            items, "zh", "vi", prompt_tone="dramatic",
            batch_ordinal=start // batch_size + 1,
            batch_total=(len(working) + batch_size - 1) // batch_size,
        )
        try:
            if structured:
                prompt += "\nCHỈ TRẢ JSON ARRAY, mỗi phần tử gồm id (số), speaker (Nam/Nữ), text (một câu tiếng Việt). Không thêm markdown hay giải thích."
            raw = call_ollama(endpoint, model, prompt, temperature, num_ctx, structured)
            if structured:
                apply_structured_response(provider, working, indices, raw)
            else:
                provider._apply_model_response(working, indices, raw)
        except Exception as exc:  # record one failed batch and continue the matrix
            errors.append(f"batch {start // batch_size + 1}: {exc}")
    retries = 0
    for _ in range(max(0, retry_invalid)):
        invalid = [index for index, cue in enumerate(working) if _needs_retry(cue)]
        if not invalid:
            break
        for index in invalid:
            cue = working[index]
            context = []
            for neighbor in (index - 1, index + 1):
                if 0 <= neighbor < len(working) and working[neighbor].source_text.strip():
                    context.append(f"[{neighbor + 1}] {working[neighbor].source_text.strip()}")
            items = [f"[1] {cue.source_text.strip()}"]
            prompt = provider._build_narrative_prompt(
                items, "zh", "vi", prompt_tone="literal",
                prior_context_lines=context,
                batch_ordinal=1,
                batch_total=1,
            )
            if structured:
                prompt += (
                    "\nCHỈ TRẢ JSON ARRAY với đúng một phần tử: "
                    "[{\"id\":1,\"speaker\":\"Nam hoặc Nữ\",\"text\":\"...\"}]. "
                    "CẤM MỌI KÝ TỰ HÁN, KHÔNG GIẢI THÍCH."
                )
            else:
                prompt += "\nCHỈ TRẢ VỀ MỘT CÂU TIẾNG VIỆT; CẤM MỌI KÝ TỰ HÁN, KHÔNG GIẢI THÍCH."
            try:
                raw = call_ollama(endpoint, model, prompt, temperature, num_ctx, structured)
                cue.translated_text = ""
                if structured:
                    apply_structured_response(provider, working, [index], raw)
                else:
                    provider._apply_model_response(working, [index], raw)
                retries += 1
            except Exception as exc:
                errors.append(f"retry cue {cue.cue_id}: {exc}")
    result = metric(working, time.perf_counter() - started)
    result.update({"model": model, "batch_size": batch_size, "temperature": temperature, "num_ctx": num_ctx, "structured": structured, "retry_invalid": retry_invalid, "retry_calls": retries, "errors": errors})
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cues-json", required=True, type=Path)
    parser.add_argument("--models", default="qwen2.5:14b,qwen2.5:32b")
    parser.add_argument("--batch-sizes", default="8,12,20")
    parser.add_argument("--temperatures", default="0.1,0.2")
    parser.add_argument("--endpoint", default="http://localhost:11434")
    parser.add_argument("--output", type=Path, default=ROOT / "benchmarks" / "results" / "local_model_matrix.json")
    parser.add_argument("--retry-invalid", type=int, default=0, help="Retry invalid (empty/CJK) cues this many passes")
    parser.add_argument("--num-ctx", type=int, default=4096)
    parser.add_argument("--structured", action="store_true", help="Request JSON output instead of line markers")
    args = parser.parse_args()
    raw_cues = json.loads(args.cues_json.read_text(encoding="utf-8-sig"))
    cues = [
        SubtitleCueV1(
            cue_id=str(item.get("cue_id", item.get("id", index))),
            start_pts=float(item.get("start_pts", 0)),
            end_pts=float(item.get("end_pts", 0)),
            source_text=str(item.get("source_text", item.get("source", ""))),
        )
        for index, item in enumerate(raw_cues)
        if str(item.get("source_text", item.get("source", ""))).strip()
    ]
    results = []
    for model in (part.strip() for part in args.models.split(",") if part.strip()):
        for batch_size in (int(part) for part in args.batch_sizes.split(",")):
            for temperature in (float(part) for part in args.temperatures.split(",")):
                print(f"[matrix] model={model} batch={batch_size} temperature={temperature}", flush=True)
                # Use keywords here: ``run`` keeps the structured-output and
                # retry knobs adjacent, and passing them positionally made it
                # very easy to silently swap the two flags.  In particular,
                # ``--structured --retry-invalid 1`` previously enabled one
                # extra retry pass while leaving JSON mode disabled.
                results.append(
                    run(
                        cues,
                        model,
                        batch_size,
                        temperature,
                        args.endpoint,
                        args.num_ctx,
                        structured=args.structured,
                        retry_invalid=args.retry_invalid,
                    )
                )
    document = {"cue_count": len(cues), "results": results}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(document, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
