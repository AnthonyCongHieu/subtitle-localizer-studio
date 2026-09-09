from __future__ import annotations
import argparse
import gc
import json
import logging
import math
import os
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
import psutil
import yaml

from subtitle_localizer.ocr.rapid import _prepare_windows_cuda_dlls
from subtitle_localizer.ocr.rapid import RapidOcrProvider

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("breakthrough_proto")


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
        logger.info(f"PP-OCRv5 Mobile loaded on {self.active_provider}")

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
        preds_idx = preds.argmax(axis=2)
        preds_prob = preds.max(axis=2)
        results = []
        for b in range(preds_idx.shape[0]):
            line_idx = preds_idx[b]
            line_prob = preds_prob[b]
            chars, confs = [], []
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
            chunk = crops[i:i + self.batch_size]
            batch_tensor = self.preprocess_batch(chunk)
            outputs = self.session.run(None, {"x": batch_tensor})
            preds = outputs[0]
            res = self.decode_greedy(preds)
            all_results.extend(res)
        return all_results


class AntiFalsePositiveFilter:
    @staticmethod
    def inspect_crop(crop: np.ndarray) -> Tuple[bool, str]:
        h, w = crop.shape[:2]
        if h < 10 or w < 18:
            return False, "too_small"

        ar = w / float(h)
        # Chữ Hán đơn lẻ hoặc 2 chữ có AR từ 0.9 đến 2.0.
        # Gót giày đứng dọc có AR < 0.88!
        if ar < 0.88:
            return False, f"aspect_ratio_too_low_{ar:.2f}_vertical_heel"
        if h > 130:
            return False, f"height_too_large_{h}px_building_sign"

        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        p90 = np.percentile(gray, 90)
        # Ngưỡng sáng an toàn cho cả phụ đề mờ
        if p90 < 135:
            return False, f"lightness_too_dark_{p90:.0f}"

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


def open_hardware_video(video_path: str) -> Tuple[av.container.InputContainer, str, float, int]:
    probe = av.open(video_path)
    stream = probe.streams.video[0]
    codec_name = stream.codec_context.name
    probe.close()

    hw_opt = None
    if codec_name in ("hevc", "h265"):
        hw_opt = "hevc_cuvid"
    elif codec_name in ("h264", "avc1"):
        hw_opt = "h264_cuvid"

    container = None
    decoder_used = "cpu"
    if hw_opt:
        try:
            container = av.open(video_path, options={"c:v": hw_opt})
            decoder_used = f"nvdec_{hw_opt}"
        except Exception as e:
            logger.warning(f"Fallback to CPU: {e}")

    if container is None:
        container = av.open(video_path)
        decoder_used = "cpu_libavcodec"

    v_stream = container.streams.video[0]
    fps = float(v_stream.average_rate) if v_stream.average_rate else 25.0
    total_frames = int(v_stream.frames) if v_stream.frames else 0

    return container, decoder_used, fps, total_frames


def run_breakthrough_pipeline(
    video_path: str,
    output_dir: Path,
    sample_fps: float = 2.5,
    rec_batch_size: int = 16,
) -> Dict[str, Any]:
    start_total_time = time.perf_counter()
    output_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Nạp DBNet Detector (limit_type='max')...")
    detector_provider = RapidOcrProvider(recognition_batch_size=1)
    detector_provider.load()
    dbnet_engine = detector_provider.engine.text_det
    dbnet_engine.limit_type = "max"
    dbnet_engine.limit_side_len = 960

    models_dir = REPO_ROOT / "benchmarks" / "models"
    v5_onnx = str(models_dir / "ppocrv5_mobile_rec.onnx")
    v5_yaml = str(models_dir / "ppocrv5_mobile_inference.yml")
    recognizer = PPOCRv5Recognizer(v5_onnx, v5_yaml, batch_size=rec_batch_size)

    container, decoder_used, fps, total_frames = open_hardware_video(video_path)
    logger.info(f"Video: {Path(video_path).name} | Decoder: {decoder_used} | FPS: {fps:.2f}")

    v_stream = container.streams.video[0]
    w_orig = v_stream.width
    h_orig = v_stream.height
    is_vertical = h_orig > w_orig
    if is_vertical:
        roi_norm = (0.05, 0.62, 0.90, 0.34)
    else:
        roi_norm = (0.08, 0.78, 0.84, 0.18)

    rx = int(roi_norm[0] * w_orig)
    ry = int(roi_norm[1] * h_orig)
    rw = int(roi_norm[2] * w_orig)
    rh = int(roi_norm[3] * h_orig)

    sample_interval = max(1, int(round(fps / sample_fps)))

    frame_idx = 0
    sampled_count = 0
    decoded_count = 0
    filter_stats = {
        "aspect_ratio_killed": 0,
        "lightness_killed": 0,
        "cache_hits": 0,
        "recognized": 0,
    }

    prev_roi_gray = None
    cache_hash = None
    cache_text = None
    cache_conf = 0.0

    raw_cues: List[Dict[str, Any]] = []
    t_decode_accum = 0.0
    t_detect_accum = 0.0
    t_rec_accum = 0.0
    t_loop_start = time.perf_counter()

    for packet in container.demux(v_stream):
        for frame in packet.decode():
            decoded_count += 1
            if decoded_count % sample_interval != 0:
                continue

            frame_idx = decoded_count
            timestamp_sec = float(frame.pts * v_stream.time_base) if frame.pts is not None else frame_idx / fps

            t_frame_start = time.perf_counter()
            img_rgb = frame.to_ndarray(format="bgr24")
            roi = img_rgb[ry:ry + rh, rx:rx + rw]
            t_decode_accum += (time.perf_counter() - t_frame_start)

            sampled_count += 1

            roi_gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            if prev_roi_gray is not None:
                diff = cv2.absdiff(roi_gray, prev_roi_gray)
                if np.mean(diff) < 0.65:
                    continue
            prev_roi_gray = roi_gray

            t_det_start = time.perf_counter()
            dt_boxes, _ = dbnet_engine(roi)
            t_detect_accum += (time.perf_counter() - t_det_start)

            if dt_boxes is None or len(dt_boxes) == 0:
                cache_hash = None
                continue

            crops_to_recognize = []
            crops_boxes = []

            for box in dt_boxes:
                pts = np.asarray(box, dtype=np.int32)
                bx, by, bw, bh = cv2.boundingRect(pts)
                bx = max(0, bx)
                by = max(0, by)
                bw = min(rw - bx, bw)
                bh = min(rh - by, bh)

                if bw < 18 or bh < 10:
                    continue

                crop = roi[by:by + bh, bx:bx + bw]
                is_valid, reason = AntiFalsePositiveFilter.inspect_crop(crop)
                if not is_valid:
                    if "aspect_ratio" in reason:
                        filter_stats["aspect_ratio_killed"] += 1
                    elif "lightness" in reason:
                        filter_stats["lightness_killed"] += 1
                    continue

                s_hash = AntiFalsePositiveFilter.compute_stroke_mask_dhash(crop)
                if cache_hash is not None:
                    hamming = bin(s_hash ^ cache_hash).count("1")
                    if hamming <= 2 and cache_text:
                        filter_stats["cache_hits"] += 1
                        raw_cues.append({
                            "time": timestamp_sec,
                            "text": cache_text,
                            "conf": cache_conf,
                            "box": [bx + rx, by + ry, bw, bh],
                        })
                        continue

                crops_to_recognize.append(crop)
                crops_boxes.append((s_hash, [bx + rx, by + ry, bw, bh]))

            if crops_to_recognize:
                t_rec_start = time.perf_counter()
                preds = recognizer.predict_crops(crops_to_recognize)
                t_rec_accum += (time.perf_counter() - t_rec_start)

                for (text, conf), (s_hash, bbox) in zip(preds, crops_boxes):
                    text_clean = text.strip()
                    if not text_clean or conf < 0.50:
                        continue
                    if len(text_clean) == 1 and not re.search(r"[\u3400-\u4dbf\u4e00-\u9fff]", text_clean):
                        continue

                    filter_stats["recognized"] += 1
                    cache_hash = s_hash
                    cache_text = text_clean
                    cache_conf = conf

                    raw_cues.append({
                        "time": timestamp_sec,
                        "text": text_clean,
                        "conf": conf,
                        "box": bbox,
                    })

    container.close()
    loop_duration = time.perf_counter() - t_loop_start
    total_duration = time.perf_counter() - start_total_time

    srt_cues = stitch_raw_cues(raw_cues)
    srt_path = output_dir / f"{Path(video_path).stem}_breakthrough.srt"
    save_srt(srt_cues, srt_path)

    video_dur = total_frames / fps if total_frames > 0 else decoded_count / fps
    speed_x = video_dur / total_duration if total_duration > 0 else 0.0

    report = {
        "video_name": Path(video_path).name,
        "video_duration_s": round(video_dur, 2),
        "total_time_s": round(total_duration, 2),
        "speedup_x_realtime": round(speed_x, 2),
        "decoded_frames": decoded_count,
        "sampled_crops": sampled_count,
        "decoder_used": decoder_used,
        "cues_extracted": len(srt_cues),
        "filter_stats": filter_stats,
        "timings": {
            "decode_accum_s": round(t_decode_accum, 2),
            "detect_accum_s": round(t_detect_accum, 2),
            "recognize_accum_s": round(t_rec_accum, 2),
            "loop_duration_s": round(loop_duration, 2),
        },
        "srt_path": str(srt_path),
    }

    report_json_path = output_dir / f"{Path(video_path).stem}_report.json"
    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    return report


def stitch_raw_cues(raw_cues: List[Dict[str, Any]], max_gap: float = 0.9) -> List[Dict[str, Any]]:
    if not raw_cues:
        return []

    cues = []
    curr = {
        "start": raw_cues[0]["time"],
        "end": raw_cues[0]["time"] + 0.4,
        "text": raw_cues[0]["text"],
        "conf": raw_cues[0]["conf"],
    }

    for item in raw_cues[1:]:
        if item["text"] == curr["text"] and (item["time"] - curr["end"]) <= max_gap:
            curr["end"] = max(curr["end"], item["time"] + 0.4)
            curr["conf"] = max(curr["conf"], item["conf"])
        else:
            if (curr["end"] - curr["start"]) >= 0.25:
                cues.append(curr)
            curr = {
                "start": item["time"],
                "end": item["time"] + 0.4,
                "text": item["text"],
                "conf": item["conf"],
            }

    if (curr["end"] - curr["start"]) >= 0.25:
        cues.append(curr)
    return cues


def format_srt_time(seconds: float) -> str:
    millis = int(round((seconds - int(seconds)) * 1000))
    secs = int(seconds) % 60
    mins = (int(seconds) // 60) % 60
    hours = int(seconds) // 3600
    return f"{hours:02d}:{mins:02d}:{secs:02d},{millis:03d}"


def save_srt(cues: List[Dict[str, Any]], path: Path):
    with open(path, "w", encoding="utf-8") as f:
        for i, cue in enumerate(cues, 1):
            start_str = format_srt_time(cue["start"])
            end_str = format_srt_time(cue["end"])
            f.write(f"{i}\n{start_str} --> {end_str}\n{cue['text']}\n\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, help="Path to video file")
    parser.add_argument("--output", default="benchmarks/results/prototype", help="Output directory")
    parser.add_argument("--fps", type=float, default=2.5, help="Sample FPS")
    parser.add_argument("--batch-size", type=int, default=16, help="Batch size")
    args = parser.parse_args()

    report = run_breakthrough_pipeline(
        args.video,
        Path(args.output),
        sample_fps=args.fps,
        rec_batch_size=args.batch_size,
    )

    print("\n" + "=" * 60)
    print(f"KẾT QUẢ NGUYÊN MẪU KIẾN TRÚC ĐỘT PHÁ (ĐÃ HIỆU CHỈNH):")
    print(f"- Video: {report['video_name']} ({report['video_duration_s']}s)")
    print(f"- Decoder: {report['decoder_used']}")
    print(f"- Thời gian chạy: {report['total_time_s']}s (Tốc độ: {report['speedup_x_realtime']}x Realtime!)")
    print(f"- Số câu phụ đề trích xuất: {report['cues_extracted']} câu")
    print(f"- Thống kê phễu lọc chống lấy nhầm:")
    print(f"  * Diệt gót giày/vật thể dọc (AR < 0.88): {report['filter_stats']['aspect_ratio_killed']} vật thể")
    print(f"  * Diệt biển hiệu/chữ tối màu (Lightness < 135): {report['filter_stats']['lightness_killed']} vật thể")
    print(f"  * Khử trùng lặp (Stroke dHash Cache Hit): {report['filter_stats']['cache_hits']} lần (Bỏ qua nhận diện)")
    print(f"  * Số lượt nhận diện thực tế trên GPU: {report['filter_stats']['recognized']} crops")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
