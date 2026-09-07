from __future__ import annotations

import json
import logging
import os
import platform
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

DEFAULT_SETTINGS_FILE = Path("pipeline_settings.json")


class ExtractionSettings(BaseModel):
    # Kiến trúc 2 Mode:
    # - "local": Chạy hoàn toàn trên máy cục bộ (100% Offline, 0đ chi phí, khai thác GPU RTX 3050 & 16 CPU cores)
    # - "api": Chạy qua đám mây Cloud AI (Gemini Multimodal VLM hoặc CapCut ByteDance ASR)
    mode: str = "local"  # "local" | "api"

    # Khi mode == "local":
    # - "rapidocr": Quét điểm ảnh hardsub trên màn hình bằng RapidOCR ONNX CUDA (~140 FPS, chất lượng & tốc độ cao nhất)
    # - "whisper": Nhận diện giọng nói bằng Faster-Whisper CUDA FP16 khi video không có chữ trên hình
    # - "demux": Bóc tách luồng phụ đề softsub có sẵn qua FFmpeg (0.1s tức thì)
    local_engine: str = "rapidocr"  # "rapidocr" | "whisper" | "demux"

    # Khi mode == "api":
    # - "gemini": Google Gemini 2.5 Flash Multimodal (Nhìn hình, đọc chữ, hiểu cốt truyện, dùng Key Pool 43 keys)
    # - "capcut": ByteDance Volcano Engine Subtitle ASR (Chuẩn nhận diện âm thanh của TikTok / CapCut)
    api_provider: str = "gemini"  # "gemini" | "capcut"
    capcut_api_endpoint: str = "https://edit-api-sg.capcut.com"
    capcut_session_token: str = ""

    # Phương thức tương thích ngược:
    # 1. "ocr" -> Quét chữ trên màn hình (RapidOCR ONNX / PaddleOCR)
    # 2. "asr_whisper" -> Nhận diện giọng nói âm thanh (Faster-Whisper CUDA)
    # 3. "vlm_gemini" -> AI thị giác video đa phương thức (Gemini 2.5 Flash Multimodal)
    # 4. "demux_stream" -> Bóc tách luồng phụ đề có sẵn (FFmpeg Softsub Demux)
    method: str = "ocr"

    # 1. Cấu hình OCR (Thị giác):
    engine: str = "rapidocr"  # "rapidocr" | "paddle" | "mock"
    default_source_lang: str = "auto"  # "auto" | "zh" | "en" | "vi"
    sample_fps: float = 2.0
    diff_threshold: float = 3.5
    enable_gap_rescue: bool = True
    enable_roi_tightening: bool = True

    # 2. Cấu hình ASR (Faster-Whisper CUDA):
    whisper_model: str = "medium"  # "tiny" | "base" | "small" | "medium" | "large-v3"
    whisper_device: str = "cuda"  # "cuda" | "cpu"
    whisper_compute_type: str = "float16"  # "float16" | "int8_float16" | "int8"
    whisper_vad_filter: bool = True

    # 3. Cấu hình VLM Multimodal AI:
    vlm_provider: str = "gemini"  # "gemini" | "qwen_vl_local"
    vlm_prompt_style: str = "accurate_dialogue"

    # 4. Cấu hình Demux Phụ Đề Mềm:
    demux_fallback_to_ocr: bool = True
    demux_stream_lang: str = "auto"


# Alias tương thích ngược hoàn toàn
OcrSettings = ExtractionSettings


class TranslationSettings(BaseModel):
    provider: str = "gemini"  # "gemini" | "google_web" | "local_model"
    target_language: str = "vi"  # "vi" | "en" | "zh" | "none"
    gemini_model: str = "gemini-2.5-flash"  # "gemini-2.5-flash" | "gemini-2.0-flash" | "gemini-1.5-flash"
    batch_size: int = 35
    prompt_tone: str = "dramatic"  # "dramatic" | "daily" | "humorous" | "literal"
    use_glossary: bool = True


class DubbingSettings(BaseModel):
    voice: str = "vi-VN-NamMinhNeural"
    rate: str = "+0%"
    pitch: str = "+0Hz"
    ducking_volume: float = 0.25


class RenderSettings(BaseModel):
    ffmpeg_encoder: str = "auto"  # "auto" | "nvenc" | "qsv" | "cpu"
    default_mask_style: str = "feather_tight"
    default_blur_strength: int = 24
    burn_subtitles: bool = True


class GlobalPipelineSettings(BaseModel):
    ocr: OcrSettings = Field(default_factory=OcrSettings)
    translation: TranslationSettings = Field(default_factory=TranslationSettings)
    dubbing: DubbingSettings = Field(default_factory=DubbingSettings)
    render: RenderSettings = Field(default_factory=RenderSettings)


_global_settings: Optional[GlobalPipelineSettings] = None


def load_pipeline_settings(filepath: Path | str = DEFAULT_SETTINGS_FILE) -> GlobalPipelineSettings:
    """Tải cấu hình pipeline từ file JSON, nếu chưa có thì trả về mặc định."""
    global _global_settings
    p = Path(filepath)
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            _global_settings = GlobalPipelineSettings.parse_obj(data)
            return _global_settings
        except Exception as ex:
            logger.warning(f"Lỗi đọc file cấu hình pipeline '{filepath}': {ex}. Sử dụng mặc định.")
    _global_settings = GlobalPipelineSettings()
    return _global_settings


def save_pipeline_settings(
    settings: GlobalPipelineSettings, filepath: Path | str = DEFAULT_SETTINGS_FILE
) -> None:
    """Lưu cấu hình pipeline xuống file JSON."""
    global _global_settings
    _global_settings = settings
    p = Path(filepath)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(settings.dict(), indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as ex:
        logger.error(f"Không thể ghi file cấu hình pipeline '{filepath}': {ex}")
        raise


def get_global_pipeline_settings() -> GlobalPipelineSettings:
    """Lấy cấu hình hiện hành trong memory cache hoặc nạp từ đĩa."""
    global _global_settings
    if _global_settings is None:
        _global_settings = load_pipeline_settings()
    return _global_settings


def set_global_pipeline_settings(settings: GlobalPipelineSettings) -> None:
    """Ghi đè cấu hình trong memory cache."""
    global _global_settings
    _global_settings = settings


def check_hardware_capabilities() -> Dict[str, Any]:
    """Kiểm tra khả năng phần cứng: CPU, GPU NVIDIA NVENC, ONNX Runtime Providers và FFmpeg."""
    cpu_cores = os.cpu_count() or 4
    cpu_model = platform.processor() or platform.machine() or "Generic CPU"

    # 1. Kiểm tra GPU qua nvidia-smi
    gpu_info = {
        "has_gpu": False,
        "name": "Không phát hiện GPU rời",
        "driver": "N/A",
        "vram_total_mb": 0,
        "cuda_available": False,
    }
    try:
        res = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,driver_version,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=3,
        )
        if res.returncode == 0 and res.stdout.strip():
            parts = [p.strip() for p in res.stdout.strip().splitlines()[0].split(",")]
            if len(parts) >= 3:
                gpu_info["has_gpu"] = True
                gpu_info["name"] = parts[0]
                gpu_info["driver"] = parts[1]
                try:
                    gpu_info["vram_total_mb"] = int(parts[2])
                except ValueError:
                    gpu_info["vram_total_mb"] = 0
                gpu_info["cuda_available"] = True
    except Exception:
        pass

    # 2. Kiểm tra ONNX Runtime Execution Providers
    onnx_providers = ["CPUExecutionProvider"]
    try:
        import onnxruntime as ort
        onnx_providers = ort.get_available_providers()
        if any("CUDA" in p or "Dml" in p for p in onnx_providers):
            gpu_info["cuda_available"] = True
    except Exception:
        pass

    # 3. Kiểm tra FFmpeg & Bộ mã hóa phần cứng (NVENC / QSV / AMF)
    ffmpeg_info = {
        "available": False,
        "version": "Unknown",
        "has_nvenc": False,
        "has_qsv": False,
        "recommended_encoder": "libx264",
    }
    try:
        v_res = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=3,
        )
        if v_res.returncode == 0:
            ffmpeg_info["available"] = True
            first_line = v_res.stdout.splitlines()[0] if v_res.stdout else ""
            ffmpeg_info["version"] = first_line.replace("ffmpeg version ", "").split(" ")[0]

        enc_res = subprocess.run(
            ["ffmpeg", "-encoders"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=3,
        )
        if enc_res.returncode == 0:
            stdout = enc_res.stdout.lower()
            if "h264_nvenc" in stdout:
                ffmpeg_info["has_nvenc"] = True
            if "h264_qsv" in stdout:
                ffmpeg_info["has_qsv"] = True

        if ffmpeg_info["has_nvenc"] and gpu_info["has_gpu"]:
            ffmpeg_info["recommended_encoder"] = "h264_nvenc"
        elif ffmpeg_info["has_qsv"]:
            ffmpeg_info["recommended_encoder"] = "h264_qsv"
        else:
            ffmpeg_info["recommended_encoder"] = "libx264"
    except Exception:
        pass

    return {
        "os": f"{platform.system()} {platform.release()}",
        "cpu": {
            "cores": cpu_cores,
            "model": cpu_model,
        },
        "gpu": gpu_info,
        "onnx_providers": onnx_providers,
        "ffmpeg": ffmpeg_info,
    }
