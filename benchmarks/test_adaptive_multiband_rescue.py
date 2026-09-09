import argparse
import json
import logging
import math
from pathlib import Path
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

REPO_ROOT = Path(r"e:\tool edit\subtitle-localizer-studio")
sys.path.insert(0, str(REPO_ROOT / "src"))

import av
import cv2
import numpy as np
import onnxruntime as ort
import torch
import yaml

from subtitle_localizer.ocr.rapid import _prepare_windows_cuda_dlls
from subtitle_localizer.ocr.rapid import RapidOcrProvider

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("adaptive_rescue")


class PPOCRv5Recognizer:
    def __init__(self, onnx_path: str, yaml_path: str, batch_size: int = 16):
        self.batch_size = batch_size
        self._prepare_dlls()
        with open(yaml_path, "r", encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        raw_chars = cfg.get("PostProcess", {}).get("character_dict", [])
        self.character = list(raw_chars)
        self.character.append(" ")
        self.character.insert(0, "blank")

        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        self.session = ort.InferenceSession(onnx_path, sess_options=so, providers=providers)
        self.active_provider = self.session.get_providers()[0]

    def _prepare_dlls(self):
        try:
            _prepare_windows_cuda_dlls()
            ort.preload_dlls(directory="")
        except Exception:
            pass

    def preprocess_batch(self, img_list: List[np.ndarray], target_h: int = 48) -> np.ndarray:
        max_wh_ratio = 1.0
        for img in img_list:
            h, w = img.shape[:2]
            max_wh_ratio = max(max_wh_ratio, w / float(h))

        max_w = int(math.ceil(target_h * max_wh_ratio))
        max_w = max(16, max_w)

        batch_tensors = []
        for img in img_list:
            h, w = img.shape[:2]
            ratio = w / float(h)
            resized_w = min(max_w, int(math.ceil(target_h * ratio)))
            resized_w = max(16, resized_w)

            resized = cv2.resize(img, (resized_w, target_h))
            norm = resized.astype(np.float32).transpose((2, 0, 1)) / 255.0

            padded = np.zeros((3, target_h, max_w), dtype=np.float32)
            padded[:, :, :resized_w] = norm
            batch_tensors.append(padded)

        return np.stack(batch_tensors, axis=0)

    def decode_greedy(self, preds: np.ndarray) -> List[Tuple[str, float]]:
        results = []
        for b in range(preds.shape[0]):
            line_idx = np.argmax(preds[b], axis=1)
            line_prob = np.max(preds[b], axis=1)
            chars = []
            confs = []
            for i, idx in enumerate(line_idx):
                if idx == 0:
                    continue
                if i > 0 and idx == line_idx[i - 1]:
                    continue
                if idx < len(self.character):
                    chars.append(self.character[idx])
                    confs.append(float(line_prob[i]))
            text = "".join(chars)
            conf = float(np.mean(confs)) if confs else 0.0
            results.append((text, conf))
        return results

    def predict_crops(self, crops: List[np.ndarray]) -> List[Tuple[str, float]]:
        if not crops:
            return []
        all_results = []
        for i in range(0, len(crops), self.batch_size):
            chunk = crops[i : i + self.batch_size]
            batch_tensor = self.preprocess_batch(chunk)
            outputs = self.session.run(None, {"x": batch_tensor})
            preds = outputs[0]
            res = self.decode_greedy(preds)
            all_results.extend(res)
        return all_results


class AntiNoiseFilter:
    @staticmethod
    def inspect_crop(crop: np.ndarray) -> Tuple[bool, str]:
        h, w = crop.shape[:2]
        if h < 10 or w < 18:
            return False, "too_small"
        ar = w / float(h)
        if ar < 0.88:
            return False, f"aspect_ratio_{ar:.2f}"
        if h > 130:
            return False, f"height_{h}"
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        p90 = np.percentile(gray, 90)
        if p90 < 135:
            return False, f"lightness_{p90:.0f}"
        return True, "pass"

    @staticmethod
    def compute_stroke_mask_dhash(crop: np.ndarray) -> int:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        small = cv2.resize(binary, (9, 8), interpolation=cv2.INTER_AREA)
        diff = small[:, 1:] > small[:, :-1]
        hash_int = 0
        for b in diff.flatten():
            hash_int = (hash_int << 1) | int(b)
        return hash_int


def extract_audio_waveform(video_path: str, target_sr: int = 16000) -> Tuple[torch.Tensor, float]:
    container = av.open(video_path)
    a_streams = [s for s in container.streams if s.type == "audio"]
    if not a_streams:
        container.close()
        return torch.zeros(1), 0.0
    resampler = av.AudioResampler(format="s16", layout="mono", rate=target_sr)
    samples = []
    for frame in container.decode(a_streams[0]):
        for rf in resampler.resample(frame):
            samples.append(rf.to_ndarray().flatten())
    container.close()
    if not samples:
        return torch.zeros(1), 0.0
    full = np.concatenate(samples)
    waveform = torch.from_numpy(full).float() / 32768.0
    duration_s = len(full) / float(target_sr)
    return waveform, duration_s


def get_speech_intervals_vad(waveform: torch.Tensor, sr: int = 16000) -> List[Tuple[float, float]]:
    if len(waveform) <= 1:
        return []
    vad_model, utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad", model="silero_vad", onnx=False, trust_repo=True
    )
    get_speech_timestamps = utils[0]
    speech_timestamps = get_speech_timestamps(
        waveform, vad_model, sampling_rate=sr, threshold=0.45, min_speech_duration_ms=200
    )
    intervals = []
    for st in speech_timestamps:
        s = float(st["start"] / sr)
        e = float(st["end"] / sr)
        intervals.append((s, e))
    return intervals


def is_in_speech(pts: float, speech_intervals: List[Tuple[float, float]], margin: float = 0.3) -> bool:
    for s, e in speech_intervals:
        if (s - margin) <= pts <= (e + margin):
            return True
    return False


def run_test(
    video_path: str,
    output_dir: Path,
    mode: str = "adaptive",  # "baseline" (fixed bottom) or "adaptive" (VAD-triggered mid rescue)
    sample_fps: float = 2.5,
) -> Dict[str, Any]:
    t0 = time.perf_counter()
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. Khởi tạo DBNet & PP-OCRv5
    detector_provider = RapidOcrProvider(recognition_batch_size=1)
    detector_provider.load()
    dbnet = detector_provider.engine.text_det
    dbnet.limit_type = "max"
    dbnet.limit_side_len = 960

    models_dir = REPO_ROOT / "benchmarks" / "models"
    recognizer = PPOCRv5Recognizer(
        str(models_dir / "ppocrv5_mobile_rec.onnx"),
        str(models_dir / "ppocrv5_mobile_inference.yml"),
        batch_size=16,
    )

    # 2. VAD nếu ở mode adaptive
    speech_intervals = []
    t_vad = 0.0
    if mode == "adaptive":
        t_vad_s = time.perf_counter()
        wf, _ = extract_audio_waveform(video_path)
        speech_intervals = get_speech_intervals_vad(wf)
        t_vad = time.perf_counter() - t_vad_s
        logger.info(f"[{mode.upper()}] Silero VAD done in {t_vad:.2f}s ({len(speech_intervals)} intervals)")

    # 3. Mở video qua NVDEC
    container = av.open(video_path, options={"c:v": "h264_cuvid"})
    v_stream = container.streams.video[0]
    fps = float(v_stream.average_rate or 25.0)
    w_orig, h_orig = v_stream.width, v_stream.height
    is_vertical = h_orig > w_orig

    # Xác định các dải quét ROI:
    # Dải đáy mặc định
    if is_vertical:
        roi_bottom_norm = (0.05, 0.70, 0.90, 0.26)  # Y: 70% - 96%
        roi_mid_norm = (0.05, 0.35, 0.90, 0.30)     # Y: 35% - 65% (Dải giữa cứu hộ)
    else:
        roi_bottom_norm = (0.08, 0.78, 0.84, 0.18)
        roi_mid_norm = (0.08, 0.38, 0.84, 0.25)

    sample_step = max(1, int(round(fps / sample_fps)))
    decoded_count = 0
    raw_cues = []
    stats = {
        "bottom_detected": 0,
        "mid_probed_count": 0,
        "mid_rescued_count": 0,
        "dhash_cache_hits": 0,
    }

    last_hash_bottom = None
    last_hash_mid = None

    for packet in container.demux(v_stream):
        for frame in packet.decode():
            decoded_count += 1
            if decoded_count % sample_step != 0:
                continue

            pts = float(frame.pts * v_stream.time_base) if frame.pts else float(decoded_count / fps)
            bgr = frame.to_ndarray(format="bgr24")

            # 1. Luôn cắt và quét Dải Đáy trước
            rx1 = int(roi_bottom_norm[0] * w_orig)
            ry1 = int(roi_bottom_norm[1] * h_orig)
            rw1 = int(roi_bottom_norm[2] * w_orig)
            rh1 = int(roi_bottom_norm[3] * h_orig)
            crop_bottom = np.ascontiguousarray(bgr[ry1 : ry1 + rh1, rx1 : rx1 + rw1])

            dt_boxes, _ = dbnet(crop_bottom)
            has_bottom_text = False

            if dt_boxes is not None and len(dt_boxes) > 0:
                # Có chữ ở dải đáy
                valid_crops = []
                for box in dt_boxes:
                    pts_box = np.array(box, dtype=np.int32)
                    x, y, w, h = cv2.boundingRect(pts_box)
                    sub_crop = crop_bottom[y : y + h, x : x + w]
                    is_valid, _ = AntiNoiseFilter.inspect_crop(sub_crop)
                    if is_valid:
                        h_val = AntiNoiseFilter.compute_stroke_mask_dhash(sub_crop)
                        if last_hash_bottom and bin(last_hash_bottom ^ h_val).count("1") <= 4:
                            stats["dhash_cache_hits"] += 1
                        else:
                            last_hash_bottom = h_val
                            valid_crops.append(sub_crop)

                if valid_crops:
                    preds = recognizer.predict_crops(valid_crops)
                    for text, conf in preds:
                        if text and conf >= 0.40:
                            raw_cues.append({"time": pts, "text": text, "conf": conf, "band": "bottom"})
                            has_bottom_text = True
                            stats["bottom_detected"] += 1

            # 2. Cơ chế ADAPTIVE RESCUE:
            # Nếu ở mode adaptive: Nếu dải đáy KHÔNG có chữ VÀ tai nghe thấy có tiếng nói (VAD speech active)
            if mode == "adaptive" and not has_bottom_text:
                if is_in_speech(pts, speech_intervals):
                    # KÍCH HOẠT QUÉT THOÁT VÙNG (PROBE MID-BAND)
                    stats["mid_probed_count"] += 1
                    rx2 = int(roi_mid_norm[0] * w_orig)
                    ry2 = int(roi_mid_norm[1] * h_orig)
                    rw2 = int(roi_mid_norm[2] * w_orig)
                    rh2 = int(roi_mid_norm[3] * h_orig)
                    crop_mid = np.ascontiguousarray(bgr[ry2 : ry2 + rh2, rx2 : rx2 + rw2])

                    dt_boxes_mid, _ = dbnet(crop_mid)
                    if dt_boxes_mid is not None and len(dt_boxes_mid) > 0:
                        mid_crops = []
                        for box in dt_boxes_mid:
                            pts_box = np.array(box, dtype=np.int32)
                            x, y, w, h = cv2.boundingRect(pts_box)
                            sub_crop = crop_mid[y : y + h, x : x + w]
                            is_valid, _ = AntiNoiseFilter.inspect_crop(sub_crop)
                            if is_valid:
                                h_val = AntiNoiseFilter.compute_stroke_mask_dhash(sub_crop)
                                if last_hash_mid and bin(last_hash_mid ^ h_val).count("1") <= 4:
                                    stats["dhash_cache_hits"] += 1
                                else:
                                    last_hash_mid = h_val
                                    mid_crops.append(sub_crop)
                        if mid_crops:
                            preds_mid = recognizer.predict_crops(mid_crops)
                            for text, conf in preds_mid:
                                if text and conf >= 0.40:
                                    raw_cues.append({"time": pts, "text": text, "conf": conf, "band": "mid_rescued"})
                                    stats["mid_rescued_count"] += 1

    container.close()
    total_time = time.perf_counter() - t0
    dur_s = decoded_count / fps
    speed_x = dur_s / total_time if total_time > 0 else 0.0

    # Khâu cues
    stitched = stitch_cues(raw_cues)
    srt_out = output_dir / f"{Path(video_path).stem}_{mode}.srt"
    save_srt(stitched, srt_out)

    return {
        "mode": mode,
        "video_name": Path(video_path).name,
        "duration_s": round(dur_s, 2),
        "total_time_s": round(total_time, 2),
        "speedup_x_realtime": round(speed_x, 2),
        "cues_count": len(stitched),
        "stats": stats,
        "srt_path": str(srt_out),
        "rescued_sample_cues": [
            {"time": f"{c['start']:.1f}s - {c['end']:.1f}s", "text": c["text"], "band": c.get("band", "")}
            for c in stitched if c.get("band") == "mid_rescued"
        ][:5],
    }


def stitch_cues(raw_cues: List[Dict[str, Any]], max_gap: float = 0.8) -> List[Dict[str, Any]]:
    if not raw_cues:
        return []
    cues = []
    curr = {
        "start": raw_cues[0]["time"],
        "end": raw_cues[0]["time"] + 0.4,
        "text": raw_cues[0]["text"],
        "conf": raw_cues[0]["conf"],
        "band": raw_cues[0].get("band", "bottom"),
    }
    for item in raw_cues[1:]:
        if item["text"] == curr["text"] and (item["time"] - curr["end"]) <= max_gap:
            curr["end"] = max(curr["end"], item["time"] + 0.4)
            curr["conf"] = max(curr["conf"], item["conf"])
        else:
            if (curr["end"] - curr["start"]) >= 0.20:
                cues.append(curr)
            curr = {
                "start": item["time"],
                "end": item["time"] + 0.4,
                "text": item["text"],
                "conf": item["conf"],
                "band": item.get("band", "bottom"),
            }
    if (curr["end"] - curr["start"]) >= 0.20:
        cues.append(curr)
    return cues


def save_srt(cues: List[Dict[str, Any]], path: Path):
    with open(path, "w", encoding="utf-8") as f:
        for i, cue in enumerate(cues, 1):
            s_s = int(cue["start"])
            s_ms = int(round((cue["start"] - s_s) * 1000))
            e_s = int(cue["end"])
            e_ms = int(round((cue["end"] - e_s) * 1000))
            s_str = f"{s_s//3600:02d}:{(s_s%3600)//60:02d}:{s_s%60:02d},{s_ms:03d}"
            e_str = f"{e_s//3600:02d}:{(e_s%3600)//60:02d}:{e_s%60:02d},{e_ms:03d}"
            f.write(f"{i}\n{s_str} --> {e_str}\n{cue['text']}\n\n")


def main():
    videos = [
        "D:/để đỡ D/tesst fim/好雨知时节/好雨知时节_Tap_12.mp4",
        "D:/để đỡ D/tải/Bilibili_Doc_01_ThayGiaoCungLaConNguoi.mp4",
    ]
    out_dir = Path("benchmarks/results/adaptive_rescue_test")

    print("\n" + "=" * 75)
    print("BẮT ĐẦU ĐO KIỂM THỰC NGHIỆM ĐỐI ĐẦU A/B:")
    print("BASELINE (Cố Định Đáy) vs ADAPTIVE (VAD-Triggered Mid-Band Rescue)")
    print("=" * 75 + "\n")

    results = {}
    for v in videos:
        v_name = Path(v).name
        results[v_name] = {}
        logger.info(f"\n>>>> ĐANG CHẠY VIDEO: {v_name} <<<<")

        # 1. Chạy Baseline
        logger.info(f"--- 1. Chạy Baseline (Fixed Bottom ROI) ---")
        r_base = run_test(v, out_dir, mode="baseline")
        results[v_name]["baseline"] = r_base

        # 2. Chạy Adaptive Rescue
        logger.info(f"--- 2. Chạy Adaptive Rescue (VAD-Triggered Mid-Band) ---")
        r_adapt = run_test(v, out_dir, mode="adaptive")
        results[v_name]["adaptive"] = r_adapt

        print(f"\nBẢNG ĐỐI ĐẦU CHO: {v_name}")
        print(f"| Chế Độ | Thời Gian | Tốc Độ | Tổng Cues | Cues Cứu Được Ở Dải Giữa | Dải Giữa Được Thăm Dò |")
        print(f"| :--- | :--- | :--- | :--- | :--- | :--- |")
        print(f"| BASELINE (Khung đáy) | {r_base['total_time_s']}s | {r_base['speedup_x_realtime']}x | {r_base['cues_count']} câu | 0 câu (BỊ MẤT TRẮNG) | 0 lần |")
        print(f"| ADAPTIVE RESCUE      | {r_adapt['total_time_s']}s | {r_adapt['speedup_x_realtime']}x | {r_adapt['cues_count']} câu | +{r_adapt['stats']['mid_rescued_count']} crops cứu được | {r_adapt['stats']['mid_probed_count']} lần |")
        
        if r_adapt["rescued_sample_cues"]:
            print(f"-> Mẫu các câu được cứu thoát khỏi dải đáy:")
            for sc in r_adapt["rescued_sample_cues"]:
                print(f"   * [{sc['time']}]: {sc['text']}")

    with open(out_dir / "final_comparison_report.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    logger.info(f"Đã lưu kết quả đối đầu vào {out_dir / 'final_comparison_report.json'}")


if __name__ == "__main__":
    main()
