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
    # Kiến trúc 2 Mode (Mặc định: Ưu tiên API xịn nhất, tự động fallback về Local khi lỗi):
    # - "api": Chạy qua đám mây Cloud AI (CapCut ByteDance ASR hoặc Gemini Multimodal VLM)
    # - "local": Chạy hoàn toàn trên máy cục bộ (Offline qua GPU RTX 3050 & CPU)
    mode: str = "api"  # "api" | "local" (Mặc định toàn hệ thống: Ưu tiên API)

    # Tự động cứu hộ chuyển về Local Hybrid khi Cloud API gặp lỗi:
    auto_fallback: bool = True

    # Khi mode == "local":
    # Mặc định: Thuần Local OCR siêu nhẹ (RapidOCR ONNX FP16), bỏ hoàn toàn Whisper để giải phóng VRAM và chống dính BGM
    local_engine: str = "pure_ocr"  # "pure_ocr" | "rapidocr" | "hybrid" | "whisper" | "demux"

    # Khi mode == "api":
    # - "capcut": ByteDance Volcano Engine Subtitle ASR (Chuẩn nhận diện âm thanh của TikTok / CapCut - Khuyên dùng)
    # - "gemini": Google Gemini Multimodal VLM (Nhìn hình, đọc chữ, hiểu cốt truyện, dùng Key Pool 43 keys)
    # - "groq": Groq Cloud Whisper LPU (Siêu tốc 0.5s, Whisper Large-v3)
    api_provider: str = "capcut"  # "capcut" | "gemini" | "groq"
    api_fusion_mode: str = "hybrid_ocr"  # "hybrid_ocr" (Cloud ASR + Local OCR - Chuẩn điện ảnh) | "api_only" (Thuần API)
    capcut_api_endpoint: str = "https://editor-api-sg.capcutapi.com"
    capcut_session_token: str = ""
    capcut_mode: str = "cloud_api"  # "cloud_api" | "desktop_draft"
    capcut_draft_id: Optional[str] = ""
    groq_api_key: str = ""
    groq_model: str = "whisper-large-v3"  # "whisper-large-v3" | "whisper-large-v3-turbo"

    # Phương thức tương thích ngược:
    # 1. "ocr" -> Quét chữ trên màn hình (RapidOCR ONNX / PaddleOCR)
    # 2. "asr_whisper" -> Nhận diện giọng nói âm thanh (Faster-Whisper CUDA)
    # 3. "vlm_gemini" -> AI thị giác video đa phương thức (Gemini 2.5 Flash Multimodal)
    # 4. "demux_stream" -> Bóc tách luồng phụ đề có sẵn (FFmpeg Softsub Demux)
    method: str = "ocr"

    # 1. Cấu hình OCR (Thị giác):
    engine: str = "rapidocr"  # "rapidocr" | "paddle"
    primary_backend: str = "rapidocr"  # "rapidocr" | "paddle" | "auto"
    fallback_backend: str = "rapidocr"
    # Number of detected text crops processed per recognizer call. RapidOCR
    # supports this batching internally; it does not batch video frames.
    recognition_batch_size: int = 6
    default_source_lang: str = "auto"  # "auto" | "zh" | "en" | "vi"
    sample_fps: float = 2.5
    diff_threshold: float = 2.5
    enable_gap_rescue: bool = True
    # Bound expensive rescue OCR per suspicious interval.
    gap_rescue_max_frames: int = 20
    enable_roi_tightening: bool = True
    enable_early_exit: bool = True  # Tăng tốc OCR suy luận cascade, ngắt sớm khi crop rõ nét
    # Preset production: giảm suy luận dư thừa nhưng giữ detector/model hiện tại.
    performance_profile: str = "full_speed_quality"  # "full_speed_quality" | "maximum_recall"
    # Chỉ bật các biến thể tiền xử lý nâng cao khi cần cứu hộ chất lượng.
    # Mặc định tắt để tránh nhân số lượt detector/recognizer trên mọi frame.
    include_advanced_preprocessing: bool = False
    edge_gating_threshold: float = 0.0  # Lọc bỏ frame không có nét chữ (Laplacian/Sobel energy)

    # 2. Cấu hình ASR (Faster-Whisper CUDA - chỉ kích hoạt khi chọn local_engine == 'hybrid'):
    whisper_model: str = "small"  # "tiny" | "base" | "small" | "medium" | "large-v3"
    whisper_device: str = "cuda"  # "cuda" | "cpu"
    whisper_compute_type: str = "float16"  # "float16" | "int8_float16" | "int8"
    whisper_vad_filter: bool = True

    # 3. Cấu hình VLM Multimodal AI:
    vlm_provider: str = "gemini"  # "gemini" | "qwen_vl_local"
    vlm_prompt_style: str = "accurate_dialogue"

    # 4. Cấu hình Demux Phụ Đề Mềm:
    demux_fallback_to_ocr: bool = True
    demux_stream_lang: str = "auto"

    # 5. Cấu hình Đa Phương Thức Lai (Hybrid DualFusion):
    hybrid_whisper_model: str = "small"
    hybrid_confidence_threshold: float = 0.65
    hybrid_rescue_missing: bool = True


# Alias tương thích ngược hoàn toàn
OcrSettings = ExtractionSettings


class TranslationSettings(BaseModel):
    provider: str = "gemini"  # "gemini" | "local" | "google_web"
    target_language: str = "vi"  # "vi" | "en" | "zh" | "none"
    gemini_model: str = "gemini-3.8-flash"  # "gemini-3.8-flash" | "gemini-3.7-flash" | "gemini-2.5-flash"
    local_model: str = "qwen2.5:7b-instruct"  # "qwen2.5:7b-instruct" | "qwen2.5:3b-instruct" | "qwen2.5:14b-instruct"
    local_endpoint: str = "http://localhost:11434"  # Ollama / llama.cpp / OpenAI-compatible endpoint
    auto_fallback: bool = True  # Tự động chuyển đổi cứu hộ giữa Local và Gemini khi một bên gặp sự cố
    batch_size: int = 35
    prompt_tone: str = "dramatic"  # "dramatic" | "daily" | "humorous" | "literal"
    use_glossary: bool = True



class DubbingSettings(BaseModel):
    enabled: bool = True
    provider: str = "edge"  # "edge" | "capcut" | "gemini" | "local"
    mode: str = "single"  # "single" (1 người) | "multi" (nhiều người / phân vai nam nữ)
    voice: str = "vi-VN-NamMinhNeural"  # Giọng chính khi ở mode 1 người
    voice_male: str = "vi-VN-NamMinhNeural"  # Giọng nam khi ở mode phân vai
    voice_female: str = "vi-VN-HoaiMyNeural"  # Giọng nữ khi ở mode phân vai
    auto_detect_speakers: bool = True  # Tự động phân vai nam/nữ theo ngữ cảnh hội thoại
    gemini_prompt_style: str = "dramatic"  # Phong cách/sắc thái cho Gemini TTS
    rate: str = "+0%"
    pitch: str = "+0Hz"
    ducking_volume: float = 0.25


class BatchConfigSettings(BaseModel):
    target_lang: str = "vi"
    ducking_volume: int = 25
    dubbing_enabled: bool = True
    dubbing_mode: str = "single"
    dubbing_voice: str = "vi-VN-NamMinhNeural"
    export_format: str = "mp4"
    export_resolution: str = "original"
    export_aspect_ratio: str = "original"
    stage_ocr: bool = True
    stage_translate: bool = True
    stage_dubbing: bool = True
    stage_export: bool = True
    active_preset_id: str = ""
    sort_mode: str = "ep_asc"
    grid_cols: int = 3


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
    batch: BatchConfigSettings = Field(default_factory=BatchConfigSettings)


_global_settings: Optional[GlobalPipelineSettings] = None


def load_pipeline_settings(filepath: Path | str = DEFAULT_SETTINGS_FILE) -> GlobalPipelineSettings:
    """Tải cấu hình pipeline từ file JSON, nếu chưa có thì trả về mặc định."""
    global _global_settings
    p = Path(filepath)
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            parse_fn = getattr(GlobalPipelineSettings, "model_validate", getattr(GlobalPipelineSettings, "parse_obj", None))
            _global_settings = parse_fn(data)
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


def merge_pipeline_settings(
    base_settings: Optional[GlobalPipelineSettings] = None,
    overrides: Optional[Dict[str, Any]] = None,
) -> GlobalPipelineSettings:
    """Hợp nhất cấu hình pipeline cơ sở với cấu hình ghi đè riêng của từng video/project."""
    base = base_settings or get_global_pipeline_settings()
    if not overrides:
        return base

    dump_fn = getattr(base, "model_dump", getattr(base, "dict", None))
    base_dict = dump_fn()
    for section, values in overrides.items():
        if isinstance(values, dict) and section in base_dict and isinstance(base_dict[section], dict):
            base_dict[section].update(values)
        else:
            base_dict[section] = values

    parse_fn = getattr(GlobalPipelineSettings, "model_validate", getattr(GlobalPipelineSettings, "parse_obj", None))
    return parse_fn(base_dict)
