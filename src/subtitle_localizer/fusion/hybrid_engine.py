from __future__ import annotations

import logging
import os
import subprocess
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np

from subtitle_localizer.domain.models import SubtitleCueV1
from subtitle_localizer.fusion.consensus import (
    compute_temporal_iou,
    resolve_text_conflict,
    clean_speech_fillers,
)

logger = logging.getLogger(__name__)


class LocalHybridFusionEngine:
    """
    Động cơ Đa phương thức Cục bộ (Local Hybrid DualFusion):
    Kết hợp RapidOCR ONNX (Thị giác điểm ảnh) và Faster-Whisper (Âm thanh RAM-pipe)
    để đạt độ chính xác tối đa với tốc độ xử lý nhanh nhất.
    """

    def __init__(
        self,
        whisper_model_size: str = "small",
        device: str = "cuda",
        compute_type: str = "float16",
        min_speech_duration: float = 0.45,
        iou_threshold: float = 0.25,
    ) -> None:
        self.whisper_model_size = whisper_model_size
        self.device = device
        self.compute_type = compute_type
        self.min_speech_duration = min_speech_duration
        self.iou_threshold = iou_threshold
        self._whisper_model = None

    def extract_audio_ram_pipe(
        self,
        video_path: Path,
        max_duration_seconds: Optional[float] = None,
        sample_rate: int = 16000,
    ) -> Optional[np.ndarray]:
        """
        Trích xuất audio PCM 16kHz mono trực tiếp vào RAM qua FFmpeg Pipe.
        Không tạo bất kỳ file .wav tạm nào trên đĩa SSD.
        """
        if not video_path.exists() or not video_path.is_file():
            logger.warning("Video file not found: %s", video_path)
            return None

        cmd = [
            "ffmpeg",
            "-v", "quiet",
            "-i", str(video_path),
        ]
        if max_duration_seconds is not None and max_duration_seconds > 0:
            cmd.extend(["-t", str(max_duration_seconds)])

        # Xuất raw PCM 16-bit Signed Little-Endian, mono (1 kênh), sample rate 16000Hz
        cmd.extend(["-f", "s16le", "-ac", "1", "-ar", str(sample_rate), "pipe:1"])

        try:
            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )
            raw_bytes = proc.stdout
            if not raw_bytes:
                return None
            # Đổi từ int16 về float32 [-1.0, 1.0] chuẩn cho các mô hình AI âm thanh
            audio_int16 = np.frombuffer(raw_bytes, dtype=np.int16)
            audio_float32 = audio_int16.astype(np.float32) / 32768.0
            return audio_float32
        except Exception as exc:
            logger.warning("Failed to extract audio via FFmpeg RAM pipe: %s", exc)
            return None

    def get_whisper_model(self):
        """Khởi tạo hoặc trả về instance Faster-Whisper được chia sẻ."""
        if self._whisper_model is not None:
            return self._whisper_model

        try:
            from faster_whisper import WhisperModel
            try:
                self._whisper_model = WhisperModel(
                    self.whisper_model_size,
                    device=self.device,
                    compute_type=self.compute_type,
                )
            except Exception:
                logger.info("Falling back Whisper to CPU int8")
                self._whisper_model = WhisperModel(
                    self.whisper_model_size,
                    device="cpu",
                    compute_type="int8",
                )
            return self._whisper_model
        except Exception as exc:
            logger.error("Failed to load Faster-Whisper: %s", exc)
            return None

    def transcribe_audio_segments(
        self,
        audio: np.ndarray,
        lang: str = "auto",
        sample_rate: int = 16000,
        vad_filter: bool = True,
    ) -> List[Dict[str, Any]]:
        """Nhận diện toàn bộ hoặc phân đoạn audio bằng Faster-Whisper với cấu hình giải mã chuẩn mực."""
        if audio is None or len(audio) == 0:
            return []

        model = self.get_whisper_model()
        if model is None:
            return []

        effective_lang = None if (not lang or lang == "auto") else lang

        # Contextual prompt: định hướng phong cách và dấu câu chuẩn
        initial_prompt = None
        if effective_lang == "zh":
            initial_prompt = "这是一部短剧，包含普通话对白，请使用简体中文及正确标点符号。"
        elif effective_lang == "en":
            initial_prompt = "This is a video with clear dialogue and proper punctuation."

        try:
            segments, info = model.transcribe(
                audio,
                language=effective_lang,
                vad_filter=vad_filter,
                vad_parameters=dict(min_silence_duration_ms=350, speech_pad_ms=200),
                beam_size=5,
                best_of=5,
                temperature=0.0,
                condition_on_previous_text=False,
                repetition_penalty=1.08,
                initial_prompt=initial_prompt,
            )
            results = []
            for seg in segments:
                text = (seg.text or "").strip()
                if text:
                    results.append({
                        "start": round(seg.start, 3),
                        "end": round(seg.end, 3),
                        "text": text,
                        "conf": round(np.exp(seg.avg_logprob), 3) if hasattr(seg, "avg_logprob") else 0.85,
                    })
            return results
        except Exception as exc:
            logger.warning("Error during whisper transcription: %s", exc)
            return []

    def fuse_cues_with_audio(
        self,
        existing_cues: List[SubtitleCueV1],
        audio_segments: List[Dict[str, Any]],
        lang: str = "auto",
    ) -> List[SubtitleCueV1]:
        """
        Dung hợp danh sách SubtitleCueV1 từ OCR với các audio segments từ Whisper:
        1. Hiệu đính nội dung các câu bị xung đột chữ (homophones / visual confusions).
        2. Khôi phục các câu phụ đề bị OCR bỏ sót (Missing Subtitle Rescue).
        """
        if not audio_segments:
            return existing_cues

        if not existing_cues:
            # Nếu OCR không bắt được gì, chuyển hóa toàn bộ audio segments thành cues
            cues = []
            for idx, seg in enumerate(audio_segments, 1):
                cues.append(
                    SubtitleCueV1(
                        cue_id=f"rescued-{uuid.uuid4().hex[:8]}",
                        start_pts=seg["start"],
                        end_pts=seg["end"],
                        source_text=seg["text"],
                        quality_flags=["rescued_by_audio"],
                    )
                )
            return cues

        updated_cues: List[SubtitleCueV1] = []
        matched_audio_indices = set()

        for cue in existing_cues:
            best_iou = 0.0
            best_seg_idx = -1

            for idx, seg in enumerate(audio_segments):
                iou = compute_temporal_iou(cue.start_pts, cue.end_pts, seg["start"], seg["end"])
                if iou > best_iou:
                    best_iou = iou
                    best_seg_idx = idx

            if best_iou >= self.iou_threshold and best_seg_idx >= 0:
                matched_audio_indices.add(best_seg_idx)
                seg = audio_segments[best_seg_idx]

                # Ước tính độ tự tin của OCR: nếu có flag low_confidence thì thấp, ngược lại cao
                ocr_conf = 0.55 if "low_confidence" in cue.quality_flags else 0.88

                resolved_text = resolve_text_conflict(
                    ocr_text=cue.source_text,
                    asr_text=seg["text"],
                    ocr_conf=ocr_conf,
                    lang=lang,
                )
                cue.source_text = resolved_text
                if "hybrid_verified" not in cue.quality_flags:
                    cue.quality_flags.append("hybrid_verified")

            updated_cues.append(cue)

        # 2. Quét các audio segment không khớp với bất kỳ câu OCR nào (câu bị sót)
        for idx, seg in enumerate(audio_segments):
            if idx not in matched_audio_indices:
                dur = seg["end"] - seg["start"]
                if dur >= self.min_speech_duration:
                    clean_text = clean_speech_fillers(seg["text"], lang=lang)
                    if clean_text:
                        updated_cues.append(
                            SubtitleCueV1(
                                cue_id=f"rescued-{uuid.uuid4().hex[:8]}",
                                start_pts=seg["start"],
                                end_pts=seg["end"],
                                source_text=clean_text,
                                quality_flags=["rescued_by_audio"],
                            )
                        )

        # 3. Sắp xếp lại timeline theo start_pts
        updated_cues.sort(key=lambda c: c.start_pts)
        return updated_cues
