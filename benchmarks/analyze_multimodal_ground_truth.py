import json
import logging
import math
from pathlib import Path
import re
import sys
import time
from typing import Any, Dict, List, Tuple

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import av
import numpy as np
import torch

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(message)s")
logger = logging.getLogger("multimodal_truth")


def parse_srt(srt_path: Path) -> List[Dict[str, Any]]:
    if not srt_path.exists():
        return []
    with open(srt_path, "r", encoding="utf-8") as f:
        content = f.read()

    blocks = re.split(r"\n\s*\n", content.strip())
    cues = []
    time_pat = re.compile(
        r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})"
    )

    for b in blocks:
        lines = [line.strip() for line in b.strip().splitlines() if line.strip()]
        if len(lines) < 2:
            continue
        m = None
        text_lines = []
        for line in lines:
            match = time_pat.search(line)
            if match:
                m = match
            elif m is not None:
                text_lines.append(line)
        if m and text_lines:
            s_h, s_m, s_s, s_ms = map(int, m.groups()[:4])
            e_h, e_m, e_s, e_ms = map(int, m.groups()[4:])
            start_s = s_h * 3600 + s_m * 60 + s_s + s_ms / 1000.0
            end_s = e_h * 3600 + e_m * 60 + e_s + e_ms / 1000.0
            cues.append({
                "start": start_s,
                "end": end_s,
                "duration": end_s - start_s,
                "text": " ".join(text_lines),
            })
    return cues


def extract_audio_wav_tensor(video_path: str, target_sr: int = 16000) -> Tuple[torch.Tensor, float]:
    container = av.open(video_path)
    audio_streams = [s for s in container.streams if s.type == "audio"]
    if not audio_streams:
        container.close()
        raise RuntimeError(f"No audio stream in {video_path}")

    a_stream = audio_streams[0]
    resampler = av.AudioResampler(format="s16", layout="mono", rate=target_sr)

    samples = []
    for frame in container.decode(a_stream):
        resampled_frames = resampler.resample(frame)
        for rf in resampled_frames:
            arr = rf.to_ndarray()  # shape (1, N) or (N,)
            samples.append(arr.flatten())

    container.close()
    if not samples:
        return torch.zeros(1), 0.0

    full_samples = np.concatenate(samples)
    waveform = torch.from_numpy(full_samples).float() / 32768.0
    duration_s = len(full_samples) / float(target_sr)
    return waveform, duration_s


def run_silero_vad(waveform: torch.Tensor, sr: int = 16000) -> List[Dict[str, float]]:
    vad_model, utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad", model="silero_vad", onnx=False, trust_repo=True
    )
    get_speech_timestamps = utils[0]
    speech_timestamps = get_speech_timestamps(
        waveform,
        vad_model,
        sampling_rate=sr,
        threshold=0.5,
        min_speech_duration_ms=250,
        min_silence_duration_ms=200,
    )
    intervals = []
    for st in speech_timestamps:
        s = float(st["start"] / sr)
        e = float(st["end"] / sr)
        intervals.append({"start": s, "end": e, "duration": e - s})
    return intervals


def analyze_multimodal_overlap(
    speech_intervals: List[Dict[str, float]],
    subtitle_cues: List[Dict[str, Any]],
    total_duration_s: float,
) -> Dict[str, Any]:
    # Tổng thời lượng tiếng nói & phụ đề
    total_speech_dur = sum(s["duration"] for s in speech_intervals)
    total_sub_dur = sum(c["duration"] for c in subtitle_cues)

    # Đánh giá từng cue phụ đề: Có tiếng hay không có tiếng?
    cues_with_speech = []
    cues_without_speech = []
    lead_lag_deltas = []

    for cue in subtitle_cues:
        cs, ce = cue["start"], cue["end"]
        # Tìm các speech intervals giao cắt với cue
        overlapping_speeches = []
        for sp in speech_intervals:
            ss, se = sp["start"], sp["end"]
            # Giao nhau nếu max(start) < min(end)
            overlap = max(0.0, min(ce, se) - max(cs, ss))
            if overlap > 0.05:  # ít nhất 50ms overlap
                overlapping_speeches.append((sp, overlap))

        if overlapping_speeches:
            cues_with_speech.append(cue)
            # Tính lead/lag so với speech interval gần nhất
            primary_sp = overlapping_speeches[0][0]
            # delta = t_sub_start - t_speech_start
            # delta < 0: Sub hiện TRƯỚC khi nói (Lead-in)
            # delta > 0: Sub hiện SAU khi nói (Lagging)
            delta_onset = cs - primary_sp["start"]
            lead_lag_deltas.append(delta_onset)
        else:
            cues_without_speech.append(cue)

    # Đánh giá từng đoạn speech: Có phụ đề hay không?
    speech_with_sub = []
    speech_without_sub = []

    for sp in speech_intervals:
        ss, se = sp["start"], sp["end"]
        has_sub = False
        for cue in subtitle_cues:
            cs, ce = cue["start"], cue["end"]
            if max(0.0, min(ce, se) - max(cs, ss)) > 0.05:
                has_sub = True
                break
        if has_sub:
            speech_with_sub.append(sp)
        else:
            speech_without_sub.append(sp)

    # Tính toán các tỷ lệ định lượng
    pct_sub_has_speech = (len(cues_with_speech) / len(subtitle_cues) * 100.0) if subtitle_cues else 0.0
    pct_sub_silent = (len(cues_without_speech) / len(subtitle_cues) * 100.0) if subtitle_cues else 0.0
    pct_speech_has_sub = (len(speech_with_sub) / len(speech_intervals) * 100.0) if speech_intervals else 0.0
    pct_speech_unsubbed = (len(speech_without_sub) / len(speech_intervals) * 100.0) if speech_intervals else 0.0

    avg_lead_lag = float(np.mean(lead_lag_deltas)) if lead_lag_deltas else 0.0
    std_lead_lag = float(np.std(lead_lag_deltas)) if lead_lag_deltas else 0.0
    p50_lead_lag = float(np.median(lead_lag_deltas)) if lead_lag_deltas else 0.0
    p90_lead_lag = float(np.percentile(lead_lag_deltas, 90)) if lead_lag_deltas else 0.0
    p10_lead_lag = float(np.percentile(lead_lag_deltas, 10)) if lead_lag_deltas else 0.0

    return {
        "total_video_duration_s": round(total_duration_s, 2),
        "total_speech_duration_s": round(total_speech_dur, 2),
        "speech_coverage_pct": round(total_speech_dur / total_duration_s * 100.0, 1),
        "total_subtitle_duration_s": round(total_sub_dur, 2),
        "subtitle_coverage_pct": round(total_sub_dur / total_duration_s * 100.0, 1),
        "counts": {
            "total_subtitle_cues": len(subtitle_cues),
            "subtitles_with_speech": len(cues_with_speech),
            "subtitles_WITHOUT_speech_SILENT": len(cues_without_speech),
            "total_speech_intervals": len(speech_intervals),
            "speech_with_subtitles": len(speech_with_sub),
            "speech_WITHOUT_subtitles_UNSUBBED": len(speech_without_sub),
        },
        "percentages": {
            "sub_has_speech_pct": round(pct_sub_has_speech, 1),
            "sub_silent_no_speech_pct": round(pct_sub_silent, 1),
            "speech_has_sub_pct": round(pct_speech_has_sub, 1),
            "speech_unsubbed_pct": round(pct_speech_unsubbed, 1),
        },
        "lead_lag_stats_seconds": {
            "mean_delta_s": round(avg_lead_lag, 3),
            "std_delta_s": round(std_lead_lag, 3),
            "median_p50_s": round(p50_lead_lag, 3),
            "p10_lead_early_s": round(p10_lead_lag, 3),
            "p90_lag_late_s": round(p90_lead_lag, 3),
        },
        "sample_silent_subtitles": [
            {"time": f"{c['start']:.1f}s - {c['end']:.1f}s", "text": c["text"]}
            for c in cues_without_speech[:8]
        ],
        "sample_unsubbed_speech_intervals": [
            {"time": f"{s['start']:.1f}s - {s['end']:.1f}s", "duration_s": round(s["duration"], 2)}
            for s in speech_without_sub[:8]
        ],
    }


def main():
    benchmarks = [
        {
            "name": "Bilibili_Ngang_01_ChenXiangLiuDianBan.mp4",
            "video": "D:/để đỡ D/tải/Bilibili_Ngang_01_ChenXiangLiuDianBan.mp4",
            "srt": "benchmarks/results/prototype_chenxiang/Bilibili_Ngang_01_ChenXiangLiuDianBan_breakthrough.srt",
        },
        {
            "name": "Bilibili_Ngang_03_TruongAnDiVanLuc.mp4",
            "video": "D:/để đỡ D/tải/Bilibili_Ngang_03_TruongAnDiVanLuc.mp4",
            "srt": "benchmarks/results/prototype_truongan/Bilibili_Ngang_03_TruongAnDiVanLuc_breakthrough.srt",
        },
        {
            "name": "好雨知时节_Tap_06.mp4",
            "video": "D:/để đỡ D/tesst fim/123/好雨知时节_Tap_06.mp4",
            "srt": "benchmarks/results/prototype_tap06/好雨知时节_Tap_06_breakthrough.srt",
        },
    ]

    all_results = {}
    for b in benchmarks:
        v_path = b["video"]
        s_path = Path(b["srt"])
        logger.info(f"=== Đang phân tích đa phương thức: {b['name']} ===")

        waveform, dur_s = extract_audio_wav_tensor(v_path)
        logger.info(f"Audio decoded: {dur_s:.2f}s ({len(waveform)} samples @ 16kHz)")

        speech_intervals = run_silero_vad(waveform, sr=16000)
        logger.info(f"Silero VAD detected: {len(speech_intervals)} speech segments")

        cues = parse_srt(s_path)
        logger.info(f"Parsed OCR Ground Truth: {len(cues)} subtitle cues")

        res = analyze_multimodal_overlap(speech_intervals, cues, dur_s)
        all_results[b["name"]] = res

        print("\n" + "=" * 70)
        print(f"KẾT QUẢ THỰC NGHIỆM ĐA PHƯƠNG THỨC: {b['name']}")
        print(f"- Tổng thời lượng video: {res['total_video_duration_s']}s")
        print(f"- Độ phủ âm thanh tiếng nói (VAD): {res['total_speech_duration_s']}s ({res['speech_coverage_pct']}%)")
        print(f"- Độ phủ chữ phụ đề (OCR): {res['total_subtitle_duration_s']}s ({res['subtitle_coverage_pct']}%)")
        print(f"- Phân tích Phụ Đề (Visual Subtitle Perspective):")
        print(f"  * Tổng số câu phụ đề: {res['counts']['total_subtitle_cues']} câu")
        print(f"  * Số câu CÓ TIẾNG NÓI trùng khớp: {res['counts']['subtitles_with_speech']} câu ({res['percentages']['sub_has_speech_pct']}%)")
        print(f"  * Số câu HOÀN TOÀN KHÔNG CÓ TIẾNG (Chữ câm): {res['counts']['subtitles_WITHOUT_speech_SILENT']} câu ({res['percentages']['sub_silent_no_speech_pct']}%)")
        print(f"- Phân tích Lời Nói (Acoustic Speech Perspective):")
        print(f"  * Tổng số đoạn có tiếng nói: {res['counts']['total_speech_intervals']} đoạn")
        print(f"  * Đoạn có phụ đề: {res['counts']['speech_with_subtitles']} đoạn ({res['percentages']['speech_has_sub_pct']}%)")
        print(f"  * Đoạn NÓI NHƯNG KHÔNG CÓ SUB: {res['counts']['speech_WITHOUT_subtitles_UNSUBBED']} đoạn ({res['percentages']['speech_unsubbed_pct']}%)")
        print(f"- Thống kê Lệch Pha Thời Gian (Lead/Lag Offset delta = Sub - Speech):")
        print(f"  * Trung bình (Mean): {res['lead_lag_stats_seconds']['mean_delta_s']}s")
        print(f"  * Trung vị P50: {res['lead_lag_stats_seconds']['median_p50_s']}s")
        print(f"  * P10 (Sub hiện trước lời nói): {res['lead_lag_stats_seconds']['p10_lead_early_s']}s")
        print(f"  * P90 (Sub hiện sau lời nói): {res['lead_lag_stats_seconds']['p90_lag_late_s']}s")
        if res["sample_silent_subtitles"]:
            print(f"- Mẫu phụ đề KHÔNG CÓ TIẾNG:")
            for sc in res["sample_silent_subtitles"][:4]:
                print(f"  + [{sc['time']}]: {sc['text']}")
        print("=" * 70 + "\n")

    out_file = Path("benchmarks/results/multimodal_ground_truth_investigation.json")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
    logger.info(f"Đã lưu báo cáo đo kiểm vào {out_file}")


if __name__ == "__main__":
    main()
