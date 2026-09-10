#!/usr/bin/env python3
"""Benchmark Qwen 2.5 local against one Gemini golden-baseline request."""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import difflib
import hashlib
import json
import math
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable, Sequence

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from subtitle_localizer.translation.key_pool import get_global_gemini_pool
from subtitle_localizer.translation.real import DEFAULT_CHINESE_VIETNAMESE_GLOSSARY

MODEL = "qwen2.5:7b-instruct"
GEMINI_MODEL = "gemini-2.5-flash"
OLLAMA_URL = "http://localhost:11434/api/chat"
RESULTS_DIR = ROOT / "benchmarks" / "results"
JSON_PATH = RESULTS_DIR / "translation_benchmark_results.json"
MD_PATH = RESULTS_DIR / "translation_benchmark_matrix.md"
SOURCE_PATH = ROOT / "benchmarks" / "benchmark_6videos_ocr_results.json"
CHUNK_SIZES = [1, 10, 25, 35, 50]
TEMPERATURES = [0.0, 0.2, 0.5, 0.7, 1.0]
TONES = ["dramatic", "daily", "humorous", "literal"]
POST_PROCESSING = ["raw", "refined"]

TONE_TEXT = {
    "dramatic": "Kịch tính, điện ảnh, cảm xúc chân thực.",
    "daily": "Đời thường, tự nhiên, gần gũi.",
    "humorous": "Hài hước, dí dỏm, dùng tiếng lóng phù hợp.",
    "literal": "Sát nghĩa, nghiêm túc và chính xác.",
}
NOISE_PATTERNS = (
    "error 500", "that's an error", "server error", "```", "bản dịch:",
    "dưới đây là", "tôi xin", "chắc chắn rồi",
)
SLANG_EXPECTATIONS = {
    "牛逼": ("đỉnh", "ghê", "xịn"), "绝了": ("đỉnh", "tuyệt", "hết nước chấm"),
    "老铁": ("anh em", "bạn hiền"), "家人们": ("cả nhà",),
    "宝子们": ("các bạn", "mấy cưng"), "什么鬼": ("quái", "cái gì"),
    "内卷": ("cạnh tranh", "cuốn"), "躺平": ("buông xuôi", "nằm im"),
    "无语": ("cạn lời", "không nói nên lời"), "打工人": ("dân văn phòng", "người làm công"),
}
PRONOUN_EXPECTATIONS = {
    "他": ("anh ấy", "cậu ấy", "ông ấy", "hắn", "chàng", "anh ta"),
    "她": ("cô ấy", "chị ấy", "nàng", "cô ta", "chị ta", "em ấy"),
}
TOKEN_RE = re.compile(r"\w+", re.UNICODE)
MARKER_RE = re.compile(
    r"(?<![\w[])\[(\d+)]\s*(?:\[(Nam|Nữ|Nu|Male|Female)]\s*)?",
    re.I,
)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def normalize(text: str) -> str:
    return " ".join(TOKEN_RE.findall(text.lower()))


def mean(values: Sequence[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def corpus_hash(cues: Sequence[dict[str, Any]]) -> str:
    packed = json.dumps([c["source"] for c in cues], ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(packed).hexdigest()


def load_real_cues() -> list[dict[str, Any]]:
    data = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
    cues: list[dict[str, Any]] = []
    for video in data:
        origin = video["file_info"]["filename"]
        for sample in video.get("sample_cues", []):
            source = str(sample.get("ocr_text", "")).strip()
            if source:
                cues.append({"id": len(cues), "source": source, "origin": origin, "kind": "repo_ocr"})
    extras = [
        "家人们，这波操作真的绝了", "老铁，你这也太牛逼了吧", "什么鬼，我真的无语了",
        "宝子们别急，这事我已经搞定了", "打工人只想躺平，可大家都太卷了",
        "她是我姐姐，你别误会她", "他是我哥哥，昨晚是他送我回家的",
        "她说他从来没有背叛过她", "秦程锦告诉宋知节，她已经离婚了",
        "你个傻瓜，赶紧给我滚回来", "我把真心掏给你，你却这样对我",
        "从结婚那天起，我就知道他心里还有别人",
    ]
    for source in extras:
        cues.append({"id": len(cues), "source": source, "origin": "curated_repo_domain", "kind": "challenge"})
    if len(cues) < 60:
        raise RuntimeError(f"Tập dữ liệu chỉ có {len(cues)} câu, yêu cầu tối thiểu 60")
    return cues


def build_prompt(cues: Sequence[dict[str, Any]], tone: str, baseline: bool = False) -> str:
    tone_text = "Tự nhiên, trung tính, dùng làm bản tham chiếu chất lượng." if baseline else TONE_TEXT[tone]
    rows = "\n".join(f"[{cue['id']}] {cue['source']}" for cue in cues)
    return (
        "Bạn là chuyên gia Việt hóa phụ đề phim ngắn Trung Quốc. Dịch từ tiếng Trung sang tiếng Việt.\n"
        f"Phong cách: {tone_text}\n"
        "Yêu cầu bắt buộc:\n"
        "- Giữ đúng một dòng cho mỗi mã [i], không bỏ, gộp hoặc thêm mã.\n"
        "- Mỗi dòng phải có dạng [i] [Nam] câu dịch hoặc [i] [Nữ] câu dịch.\n"
        "- Bản dịch ngắn gọn, tự nhiên; phân biệt chính xác 他/她 và xưng hô theo ngữ cảnh.\n"
        "- Bảo toàn tên riêng và dịch tiếng lóng theo khẩu ngữ Việt; không giải thích.\n"
        "KỊCH BẢN:\n" + rows
    )


def http_json(url: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def call_gemini_once(cues: Sequence[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    pool = get_global_gemini_pool()
    key = pool.get_next_key()
    if not key:
        raise RuntimeError("Không tìm thấy Gemini API key khả dụng")
    prompt = build_prompt(cues, "daily", baseline=True)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={key}"
    started = time.perf_counter()
    try:
        response = http_json(url, {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 8192},
        }, timeout=240)
    except Exception as exc:
        raise RuntimeError(f"Lần gọi Gemini duy nhất thất bại; không tự động thử lại: {exc}") from exc
    elapsed = time.perf_counter() - started
    parts = response.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts)
    if not text.strip():
        raise RuntimeError("Gemini trả về baseline rỗng; không tự động gọi lại")
    usage = response.get("usageMetadata", {})
    return text, {
        "model": GEMINI_MODEL, "request_count": 1, "elapsed_s": round(elapsed, 3),
        "input_tokens": usage.get("promptTokenCount"),
        "output_tokens": usage.get("candidatesTokenCount"),
        "total_tokens": usage.get("totalTokenCount"),
        "created_at": utc_now(),
    }


def parse_response(text: str, expected_ids: Iterable[int]) -> dict[int, dict[str, str]]:
    valid = set(expected_ids)
    matches = list(MARKER_RE.finditer(text))
    parsed: dict[int, dict[str, str]] = {}
    for position, match in enumerate(matches):
        cue_id = int(match.group(1))
        if cue_id not in valid:
            continue
        end = matches[position + 1].start() if position + 1 < len(matches) else len(text)
        translated = text[match.end():end].strip().strip("`*- \n\r")
        label = (match.group(2) or "").lower()
        speaker = "Nữ" if label in {"nữ", "nu", "female"} else "Nam" if label else ""
        if translated:
            translated = re.sub(r"^\s*(?:[-*]\s*)?", "", translated)
            parsed[cue_id] = {"translation": translated, "speaker": speaker}
    return parsed


def complete_baseline(
    cues: Sequence[dict[str, Any]],
    parsed: dict[int, dict[str, str]],
) -> tuple[dict[int, dict[str, str]], list[int]]:
    """Fill a truncated one-request baseline without making another API call."""
    present_ids = sorted(parsed)
    if not present_ids:
        raise RuntimeError("Không phân tích được mã câu nào từ phản hồi Gemini")
    last_present = present_ids[-1]
    internal_missing = [cue["id"] for cue in cues if cue["id"] <= last_present and cue["id"] not in parsed]
    if internal_missing:
        raise RuntimeError(f"Gemini baseline thiếu mã ở giữa phản hồi: {internal_missing[:10]}")
    truncated_ids = [cue["id"] for cue in cues if cue["id"] not in parsed]
    for cue in cues:
        cue_id = cue["id"]
        if cue_id in parsed:
            continue
        source = cue["source"]
        parsed[cue_id] = {
            "translation": DEFAULT_CHINESE_VIETNAMESE_GLOSSARY.get(source, source),
            "speaker": "",
            "baseline_status": "source_fallback_after_output_truncation",
        }
    return parsed, truncated_ids


def call_ollama(cues: Sequence[dict[str, Any]], tone: str, temperature: float) -> tuple[str, dict[str, Any]]:
    started = time.perf_counter()
    response = http_json(OLLAMA_URL, {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "Bạn chỉ xuất các dòng phụ đề theo đúng định dạng được yêu cầu."},
            {"role": "user", "content": build_prompt(cues, tone)},
        ],
        "stream": False,
        "options": {"temperature": temperature, "seed": 42, "num_ctx": 8192},
        "keep_alive": "30m",
    }, timeout=300)
    elapsed = time.perf_counter() - started
    text = response.get("message", {}).get("content", "")
    return text, {
        "elapsed_s": elapsed,
        "prompt_tokens": int(response.get("prompt_eval_count", 0)),
        "output_tokens": int(response.get("eval_count", 0)),
        "model_load_s": float(response.get("load_duration", 0)) / 1e9,
    }


def refine_translation(source: str, text: str) -> str:
    result = " ".join(text.replace("\n", " ").split()).strip("`*- ")
    lowered = result.lower()
    if any(pattern in lowered for pattern in NOISE_PATTERNS):
        for pattern in NOISE_PATTERNS:
            result = re.sub(re.escape(pattern), "", result, flags=re.I).strip(" :-")
    exact = DEFAULT_CHINESE_VIETNAMESE_GLOSSARY.get(source.strip())
    if exact:
        return exact
    replacements = {
        "thay đổi nền tảng": "đổi app", "bắt một chiếc xe": "gọi một chiếc xe",
        "không nói nên lời": "cạn lời", "người sắt cũ": "anh em",
    }
    for old, new in replacements.items():
        result = re.sub(re.escape(old), new, result, flags=re.I)
    return result[:1].upper() + result[1:] if result else ""


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text.lower())


def ngrams(tokens: Sequence[str], n: int) -> collections.Counter[tuple[str, ...]]:
    return collections.Counter(tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1))


def corpus_bleu(references: Sequence[str], hypotheses: Sequence[str]) -> float:
    clipped = [0] * 4
    totals = [0] * 4
    ref_len = hyp_len = 0
    for reference, hypothesis in zip(references, hypotheses):
        ref_tokens, hyp_tokens = tokenize(reference), tokenize(hypothesis)
        ref_len += len(ref_tokens)
        hyp_len += len(hyp_tokens)
        for n in range(1, 5):
            ref_counts, hyp_counts = ngrams(ref_tokens, n), ngrams(hyp_tokens, n)
            clipped[n - 1] += sum(min(count, ref_counts[gram]) for gram, count in hyp_counts.items())
            totals[n - 1] += sum(hyp_counts.values())
    precisions = [(clipped[i] + 1.0) / (totals[i] + 1.0) for i in range(4)]
    brevity = 0.0 if hyp_len == 0 else min(1.0, math.exp(1.0 - ref_len / hyp_len))
    return 100.0 * brevity * math.exp(sum(math.log(p) for p in precisions) / 4.0)


def chrf(references: Sequence[str], hypotheses: Sequence[str]) -> float:
    scores: list[float] = []
    for reference, hypothesis in zip(references, hypotheses):
        for n in range(1, 7):
            r, h = ngrams(list(reference.lower()), n), ngrams(list(hypothesis.lower()), n)
            overlap = sum(min(count, r[gram]) for gram, count in h.items())
            precision = overlap / max(1, sum(h.values()))
            recall = overlap / max(1, sum(r.values()))
            scores.append((2 * precision * recall / (precision + recall)) if precision + recall else 0.0)
    return 100.0 * mean(scores)


def levenshtein_similarity(reference: str, hypothesis: str) -> float:
    previous = list(range(len(hypothesis) + 1))
    for i, left in enumerate(reference, 1):
        current = [i]
        for j, right in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (left != right)))
        previous = current
    distance = previous[-1]
    return 1.0 - distance / max(1, len(reference), len(hypothesis))


def lexical_similarity(reference: str, hypothesis: str) -> float:
    ref, hyp = collections.Counter(tokenize(reference)), collections.Counter(tokenize(hypothesis))
    overlap = sum((ref & hyp).values())
    return 2.0 * overlap / max(1, sum(ref.values()) + sum(hyp.values()))


def feature_accuracy(cues: Sequence[dict[str, Any]], outputs: dict[int, dict[str, str]], feature: str) -> float:
    eligible = 0
    correct = 0
    for cue in cues:
        source = cue["source"]
        result = outputs.get(cue["id"], {})
        translation = result.get("translation", "").lower()
        if feature == "speaker":
            eligible += 1
            correct += bool(result.get("speaker"))
        elif feature == "pronoun":
            for token, expectations in PRONOUN_EXPECTATIONS.items():
                if token in source:
                    eligible += 1
                    correct += any(term in translation for term in expectations)
        elif feature == "slang":
            for token, expectations in SLANG_EXPECTATIONS.items():
                if token in source:
                    eligible += 1
                    correct += any(term in translation for term in expectations)
    return 100.0 * correct / eligible if eligible else 100.0


def evaluate(cues: Sequence[dict[str, Any]], golden: dict[int, dict[str, str]], outputs: dict[int, dict[str, str]], timing: dict[str, Any]) -> dict[str, Any]:
    references = [golden.get(c["id"], {}).get("translation", "") for c in cues]
    hypotheses = [outputs.get(c["id"], {}).get("translation", "") for c in cues]
    elapsed = timing["elapsed_s"]
    complete = sum(bool(text) for text in hypotheses)
    return {
        "total_time_s": round(elapsed, 3),
        "avg_latency_ms_per_cue": round(1000.0 * elapsed / len(cues), 2),
        "throughput_cues_s": round(len(cues) / elapsed, 3) if elapsed else 0.0,
        "throughput_tokens_s": round(timing["output_tokens"] / elapsed, 3) if elapsed else 0.0,
        "prompt_tokens": timing["prompt_tokens"], "output_tokens": timing["output_tokens"],
        "bleu": round(corpus_bleu(references, hypotheses), 3),
        "chrf": round(chrf(references, hypotheses), 3),
        "levenshtein_similarity_pct": round(100.0 * mean([levenshtein_similarity(r, h) for r, h in zip(references, hypotheses)]), 3),
        "lexical_similarity_pct": round(100.0 * mean([lexical_similarity(r, h) for r, h in zip(references, hypotheses)]), 3),
        "speaker_label_success_pct": round(feature_accuracy(cues, outputs, "speaker"), 3),
        "pronoun_accuracy_pct": round(feature_accuracy(cues, outputs, "pronoun"), 3),
        "slang_accuracy_pct": round(feature_accuracy(cues, outputs, "slang"), 3),
        "id_format_preservation_pct": round(100.0 * complete / len(cues), 3),
        "completed_cues": complete,
    }

def config_key(chunk_size: int, temperature: float, tone: str) -> str:
    return f"chunk={chunk_size}|temperature={temperature:.1f}|tone={tone}"


def run_configuration(cues: Sequence[dict[str, Any]], chunk_size: int, temperature: float, tone: str) -> tuple[dict[int, dict[str, str]], dict[str, Any]]:
    outputs: dict[int, dict[str, str]] = {}
    elapsed = prompt_tokens = output_tokens = 0
    calls = 0
    errors: list[str] = []
    for start in range(0, len(cues), chunk_size):
        batch = cues[start:start + chunk_size]
        calls += 1
        try:
            text, timing = call_ollama(batch, tone, temperature)
            outputs.update(parse_response(text, [cue["id"] for cue in batch]))
            elapsed += timing["elapsed_s"]
            prompt_tokens += timing["prompt_tokens"]
            output_tokens += timing["output_tokens"]
        except Exception as exc:
            errors.append(f"batch {start // chunk_size + 1}: {exc}")
    return outputs, {
        "elapsed_s": elapsed, "prompt_tokens": prompt_tokens, "output_tokens": output_tokens,
        "ollama_calls": calls, "errors": errors,
    }


def refined_outputs(cues: Sequence[dict[str, Any]], raw: dict[int, dict[str, str]]) -> dict[int, dict[str, str]]:
    return {
        cue["id"]: {
            "translation": refine_translation(cue["source"], raw.get(cue["id"], {}).get("translation", "")),
            "speaker": raw.get(cue["id"], {}).get("speaker", ""),
        }
        for cue in cues
    }


def quality_score(metrics: dict[str, Any]) -> float:
    return mean([
        metrics["chrf"], metrics["levenshtein_similarity_pct"], metrics["lexical_similarity_pct"],
        metrics["speaker_label_success_pct"], metrics["pronoun_accuracy_pct"],
        metrics["slang_accuracy_pct"], metrics["id_format_preservation_pct"],
    ])


def add_rankings(results: list[dict[str, Any]]) -> dict[str, Any]:
    max_speed = max((row["metrics"]["throughput_cues_s"] for row in results), default=1.0) or 1.0
    for row in results:
        quality = quality_score(row["metrics"])
        speed = 100.0 * row["metrics"]["throughput_cues_s"] / max_speed
        row["metrics"]["quality_composite"] = round(quality, 3)
        row["metrics"]["sweet_spot_score"] = round(0.7 * quality + 0.3 * speed, 3)
    by_sweet = max(results, key=lambda row: row["metrics"]["sweet_spot_score"])
    by_quality = max(results, key=lambda row: row["metrics"]["quality_composite"])
    by_speed = max(results, key=lambda row: row["metrics"]["throughput_cues_s"])
    return {
        "sweet_spot": {"config": by_sweet["config"], "metrics": by_sweet["metrics"]},
        "best_quality": {"config": by_quality["config"], "metrics": by_quality["metrics"]},
        "fastest": {"config": by_speed["config"], "metrics": by_speed["metrics"]},
        "method": "70% quality composite + 30% normalized throughput",
    }


def save_checkpoint(document: dict[str, Any]) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    temporary = JSON_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(JSON_PATH)


def load_checkpoint(corpus_sha: str, resume: bool) -> dict[str, Any] | None:
    if not resume or not JSON_PATH.exists():
        return None
    try:
        document = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if document.get("dataset", {}).get("sha256") != corpus_sha:
        return None
    if not document.get("golden_baseline", {}).get("translations"):
        return None
    return document


def format_config(config: dict[str, Any]) -> str:
    return f"batch {config['chunk_size']}, temp {config['temperature']}, {config['tone']}, {config['post_processing']}"


def recommendation(analysis: dict[str, Any]) -> str:
    sweet = analysis["sweet_spot"]
    metrics = sweet["metrics"]
    return (
        f"Dùng {format_config(sweet['config'])}: chất lượng tổng hợp {metrics['quality_composite']:.2f}, "
        f"tốc độ {metrics['throughput_cues_s']:.3f} câu/s. Giữ Gemini chỉ để tạo baseline định kỳ; "
        "đối với vận hành thường ngày, dùng local và bật refined để chuẩn hóa thuật ngữ/khử nhiễu."
    )


def write_markdown(document: dict[str, Any]) -> None:
    rows = sorted(document["results"], key=lambda item: item["metrics"]["sweet_spot_score"], reverse=True)
    analysis = document["analysis"]
    lines = [
        "# Ma trận benchmark dịch Local Qwen 2.5 so với Gemini", "",
        f"- Thời điểm hoàn tất: `{document['completed_at']}`",
        f"- Tập kiểm chuẩn: **{document['dataset']['cue_count']}** câu tiếng Trung thực tế/thử thách.",
        f"- Gemini baseline: `{GEMINI_MODEL}`, **{document['golden_baseline']['metadata']['request_count']} lần gọi**; "
        f"phân tích được **{document['golden_baseline']['metadata'].get('parsed_translation_count', document['dataset']['cue_count'])}/{document['dataset']['cue_count']}** câu.",
        f"- Local model: `{MODEL}`; tổng cấu hình: **{len(rows)}** (100 lần sinh local × raw/refined).", "",
        "## Sweet Spot và khuyến nghị", "",
        f"- **Sweet Spot:** {format_config(analysis['sweet_spot']['config'])} — điểm {analysis['sweet_spot']['metrics']['sweet_spot_score']:.3f}.",
        f"- **Chất lượng cao nhất:** {format_config(analysis['best_quality']['config'])}.",
        f"- **Nhanh nhất:** {format_config(analysis['fastest']['config'])}.",
        f"- **Khuyến nghị sản xuất:** {document['recommendation']}", "",
        "## Bảng so sánh đa cột", "",
        "| Batch | Temp | Tone | Post | Time s | ms/cue | cue/s | tok/s | BLEU | ChrF | Lev % | Lex % | Vai % | Đại từ % | Slang % | ID % | Quality | Sweet |",
        "|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in rows:
        config, metric = row["config"], row["metrics"]
        lines.append(
            f"| {config['chunk_size']} | {config['temperature']:.1f} | {config['tone']} | {config['post_processing']} "
            f"| {metric['total_time_s']:.3f} | {metric['avg_latency_ms_per_cue']:.2f} | {metric['throughput_cues_s']:.3f} "
            f"| {metric['throughput_tokens_s']:.3f} | {metric['bleu']:.3f} | {metric['chrf']:.3f} "
            f"| {metric['levenshtein_similarity_pct']:.3f} | {metric['lexical_similarity_pct']:.3f} "
            f"| {metric['speaker_label_success_pct']:.3f} | {metric['pronoun_accuracy_pct']:.3f} "
            f"| {metric['slang_accuracy_pct']:.3f} | {metric['id_format_preservation_pct']:.3f} "
            f"| {metric['quality_composite']:.3f} | {metric['sweet_spot_score']:.3f} |"
        )
    lines.extend(["", "## Phương pháp", "", document["methodology"], ""])
    MD_PATH.write_text("\n".join(lines), encoding="utf-8")

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fresh", action="store_true", help="Bỏ checkpoint và tạo Gemini baseline mới (gọi API đúng một lần).")
    parser.add_argument("--limit-configs", type=int, default=None, help="Giới hạn số cấu hình local để smoke test.")
    parser.add_argument("--chunks", type=int, nargs="+", default=CHUNK_SIZES)
    parser.add_argument("--temperatures", type=float, nargs="+", default=TEMPERATURES)
    parser.add_argument("--tones", choices=TONES, nargs="+", default=TONES)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    cues = load_real_cues()
    sha = corpus_hash(cues)
    document = load_checkpoint(sha, resume=not args.fresh)
    if document:
        print(f"[1/3] Tái sử dụng Gemini golden baseline đã lưu ({document['golden_baseline']['metadata']['created_at']}); không gọi API.")
        golden = {int(key): value for key, value in document["golden_baseline"]["translations"].items()}
        completed = {row["configuration_key"] for row in document.get("results", [])}
    else:
        print(f"[1/3] Gọi {GEMINI_MODEL} đúng một lần để dịch {len(cues)} câu làm golden baseline...")
        golden_text, golden_metadata = call_gemini_once(cues)
        golden, truncated_ids = complete_baseline(
            cues,
            parse_response(golden_text, [cue["id"] for cue in cues]),
        )
        golden_metadata["parsed_translation_count"] = len(cues) - len(truncated_ids)
        golden_metadata["fallback_translation_count"] = len(truncated_ids)
        golden_metadata["truncated_ids"] = truncated_ids
        if truncated_ids:
            print(
                f"  Gemini dừng đầu ra sau {len(cues) - len(truncated_ids)}/{len(cues)} câu; "
                f"{len(truncated_ids)} câu còn lại dùng source fallback, không gọi API lần hai."
            )
        document = {
            "schema_version": 1, "started_at": utc_now(), "status": "running",
            "dataset": {"cue_count": len(cues), "sha256": sha, "source": str(SOURCE_PATH.relative_to(ROOT)), "cues": cues},
            "matrix": {"chunk_sizes": args.chunks, "temperatures": args.temperatures, "tones": args.tones, "post_processing": POST_PROCESSING},
            "golden_baseline": {"metadata": golden_metadata, "translations": {str(key): value for key, value in golden.items()}},
            "results": [],
        }
        completed = set()
        save_checkpoint(document)

    configurations = [
        (chunk_size, temperature, tone)
        for chunk_size in args.chunks for temperature in args.temperatures for tone in args.tones
    ]
    if args.limit_configs is not None:
        configurations = configurations[:max(0, args.limit_configs)]
    total = len(configurations)
    print(f"[2/3] Chạy ma trận local: {total} cấu hình sinh, mỗi cấu hình chấm raw và refined.")
    for index, (chunk_size, temperature, tone) in enumerate(configurations, 1):
        key = config_key(chunk_size, temperature, tone)
        if key in completed:
            print(f"  [{index}/{total}] Bỏ qua checkpoint: {key}")
            continue
        print(f"  [{index}/{total}] {key}", flush=True)
        raw_outputs, timing = run_configuration(cues, chunk_size, temperature, tone)
        for post_processing, outputs in (("raw", raw_outputs), ("refined", refined_outputs(cues, raw_outputs))):
            metrics = evaluate(cues, golden, outputs, timing)
            document["results"].append({
                "configuration_key": key, "config": {
                    "chunk_size": chunk_size, "temperature": temperature,
                    "tone": tone, "post_processing": post_processing,
                },
                "metrics": metrics,
                "runtime": {"ollama_calls": timing["ollama_calls"], "errors": timing["errors"]},
                "translations": {str(cue_id): value for cue_id, value in outputs.items()},
            })
        save_checkpoint(document)

    expected_results = total * 2
    matrix_results = [row for row in document["results"] if row["configuration_key"] in {config_key(*config) for config in configurations}]
    if len(matrix_results) < expected_results:
        raise RuntimeError(f"Benchmark chưa đủ: có {len(matrix_results)}/{expected_results} hàng kết quả")
    analysis = add_rankings(document["results"])
    document.update({
        "status": "completed", "completed_at": utc_now(), "analysis": analysis,
        "recommendation": recommendation(analysis),
        "methodology": (
            "BLEU dùng corpus BLEU-4 có add-one smoothing; ChrF dùng F1 trung bình của character n-gram 1–6. "
            "Levenshtein và tương đồng từ vựng lấy trung bình theo câu. Nhãn vai đo sự hiện diện [Nam]/[Nữ]; "
            "đại từ và tiếng lóng đo bằng tập kỳ vọng ngôn ngữ xác định trước; ID đo tỷ lệ mã câu được mô hình trả về. "
            "Nếu lần gọi Gemini duy nhất bị giới hạn độ dài đầu ra, các mã đuôi chưa trả về dùng nguyên văn nguồn làm fallback "
            "và được đánh dấu trong metadata để không vi phạm ràng buộc một request. "
            "Sweet Spot = 70% trung bình các chỉ số chất lượng + 30% throughput chuẩn hóa. "
            "Raw và refined dùng cùng một lần sinh local nên thời gian/tokens giống nhau; refined chỉ hậu xử lý xác định."
        ),
    })
    save_checkpoint(document)
    write_markdown(document)
    sweet = analysis["sweet_spot"]
    print("[3/3] Hoàn tất benchmark.")
    print(f"  JSON: {JSON_PATH}")
    print(f"  Markdown: {MD_PATH}")
    print(f"  Gemini API requests: {document['golden_baseline']['metadata']['request_count']}")
    print(f"  Sweet Spot: {format_config(sweet['config'])}")
    print(f"  Quality={sweet['metrics']['quality_composite']:.3f}, speed={sweet['metrics']['throughput_cues_s']:.3f} cues/s")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nBenchmark bị dừng; checkpoint đã lưu để chạy tiếp.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as exc:
        print(f"LỖI BENCHMARK: {exc}", file=sys.stderr)
        raise SystemExit(1)

