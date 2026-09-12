from __future__ import annotations

import json
import logging
import os
import platform
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, root_validator

logger = logging.getLogger(__name__)

DEFAULT_SETTINGS_FILE = Path("pipeline_settings.json")


class ExtractionSettings(BaseModel):
    # Kiến trúc 2 Mode (Mặc định: Local OCR tốc độ cao, có thể bật Cloud API theo từng project):
    # - "api": Chạy qua đám mây Cloud AI (CapCut ByteDance ASR hoặc Gemini Multimodal VLM)
    # - "local": Chạy hoàn toàn trên máy cục bộ (Offline qua GPU RTX 3050 & CPU)
    mode: str = "local"  # "api" | "local" (Mặc định toàn hệ thống: Local OCR)

    # Tự động cứu hộ chuyển về Local Hybrid khi Cloud API gặp lỗi:
    auto_fallback: bool = True

    # Khi mode == "local":
    # Mặc định: Thuần Local OCR siêu nhẹ (RapidOCR ONNX FP16), bỏ hoàn toàn Whisper để giải phóng VRAM và chống dính BGM
    local_engine: str = "pure_ocr"  # "pure_ocr" | "rapidocr" | "demux" (legacy hybrid/whisper are ignored)

    # Khi mode == "api": chỉ hỗ trợ các provider còn được duy trì.
    api_provider: str = "capcut"  # "capcut" | "gemini"
    api_fusion_mode: str = "hybrid_ocr"  # Cloud + Local OCR; api_only dùng cloud trực tiếp
    capcut_api_endpoint: str = "https://editor-api-sg.capcutapi.com"
    capcut_session_token: str = ""
    capcut_mode: str = "cloud_api"  # "cloud_api" | "desktop_draft"
    capcut_draft_id: Optional[str] = ""

    # Phương thức tương thích ngược (chỉ giữ các phương thức không dùng ASR).
    # Dữ liệu cũ asr_whisper/hybrid bị chuẩn hóa về ocr khi nạp.
    method: str = "ocr"

    # 1. Cấu hình OCR (Thị giác):
    # RapidOCR remains the safe default because it includes DBNet detection;
    # PP-OCRv5 is recognition-only and is enabled explicitly after detector
    # boxes are available.
    engine: str = "ppocrv5"  # "rapidocr" | "ppocrv5" | "paddle"
    primary_backend: str = "ppocrv5"  # "rapidocr" | "ppocrv5" | "paddle" | "auto"
    fallback_backend: str = "rapidocr"
    # Number of detected text crops processed per recognizer call. RapidOCR
    # supports this batching internally; it does not batch video frames.
    recognition_batch_size: int = 16
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

    # Breakthrough OCR opt-in controls.  Defaults preserve legacy behaviour.
    ppocr_model_tier: str = "mobile"
    enable_nvdec_hwaccel: bool = True
    nvdec_device_id: int = 0
    enable_anti_noise_funnel: bool = True
    anti_noise_ar_min: float = 0.88
    anti_noise_h_max: int = 130
    anti_noise_swt_cov_max: float = 0.40
    anti_noise_lum_min: int = 135
    # vertical_short = ROI + phao cuu + chuyen vung; fixed_roi = chi OCR khung co dinh
    scan_profile: str = "vertical_short"  # "vertical_short" | "fixed_roi"
    enable_adaptive_rescue: bool = True
    # Persistent watermark / branding layer separation + cue-follow masking
    enable_persistent_text_filter: bool = False
    persistent_text_ratio: float = 0.55
    enable_cue_follow_mask: bool = False
    adaptive_rescue_mid_y: float = 0.35
    adaptive_rescue_mid_h: float = 0.30
    enable_stroke_dhash_cache: bool = True
    stroke_dhash_threshold: int = 4
    dbnet_limit_side_len: int = 960
    dbnet_limit_type: str = "max"
    hardware_tuning_mode: str = "auto"


    # 3. Cấu hình VLM Multimodal AI:
    vlm_provider: str = "gemini"  # "gemini" | "qwen_vl_local"
    vlm_prompt_style: str = "accurate_dialogue"

    # 4. Cấu hình Demux Phụ Đề Mềm:
    demux_fallback_to_ocr: bool = True
    demux_stream_lang: str = "auto"

    @root_validator(pre=True)
    def normalize_retired_modes(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        values = dict(values or {})
        if values.get("local_engine") in {"hybrid", "whisper"} or values.get("method") == "asr_whisper":
            values["local_engine"] = "pure_ocr"
            values["method"] = "ocr"
        if values.get("api_provider") == "groq":
            values["api_provider"] = "capcut"
        if values.get("api_fusion_mode") not in {"hybrid_ocr", "api_only"}:
            values["api_fusion_mode"] = "hybrid_ocr"
        return values





# Alias tương thích ngược hoàn toàn
OcrSettings = ExtractionSettings


class TranslationSettings(BaseModel):
    provider: str = "gemini"
    target_language: str = "vi"  # "vi" | "en" | "zh" | "none"
    # gemini-2.5-flash đã ngừng cấp cho tài khoản mới (HTTP 404 "no longer
    # available to new users"), nên mặc định dùng dòng 3.8 Flash.
    gemini_model: str = "gemini-3.8-flash"
    # Local slot 1 prioritizes quality; slot 2 is the fast rescue profile.
    local_model: str = "qwen3:14b"
    local_fallback_model: str = "gemma2:9b"
    # Hardware setup writes false when the host is below the minimum Local
    # gate. Keep the field permissive for older hand-written config files.
    local_supported: bool = True
    local_endpoint: str = "http://localhost:11434"  # Ollama / llama.cpp / OpenAI-compatible endpoint
    auto_fallback: bool = True
    # 0 = gửi toàn bộ kịch bản trong MỘT request (không chia batch). Gemini luôn
    # dịch một lần cho cả kịch bản; local model dùng giá trị này làm trần chunk.
    batch_size: int = 0
    prompt_tone: str = "dramatic"  # "dramatic" | "daily" | "humorous" | "literal"
    use_glossary: bool = True
    # auto: infer from dialogue. couple_anh_em: force anh-em for romance shorts.
    # neutral: keep generic ban for docs / large casts / unclear relations.
    addressing_mode: str = "auto"  # "auto" | "couple_anh_em" | "neutral"
    # Optional per-project/series cast & relationship notes (video-agnostic).
    character_context: str = ""

    @root_validator(pre=True)
    def normalize_gemini_model_aliases(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        values = dict(values or {})
        model = values.get("gemini_model")
        # Older clients sent bare versions ("3.8"); normalize them to real model
        # ids instead of forcing a retired model that newer keys cannot serve.
        aliases = {
            "3.7": "gemini-3.7-flash",
            "gemini-3.7": "gemini-3.7-flash",
            "3.8": "gemini-3.8-flash",
            "gemini-3.8": "gemini-3.8-flash",
        }
        if isinstance(model, str) and model.strip() in aliases:
            values["gemini_model"] = aliases[model.strip()]
        return values


class DubbingSettings(BaseModel):
    enabled: bool = True
    provider: str = "capcut"  # "edge" | "capcut" | "gemini" | "local"; CapCut lỗi fallback Edge
    mode: str = "single"  # "single" (1 người) | "multi" (nhiều người / phân vai nam nữ)
    voice: str = "vi-VN-NamMinhNeural"  # Giọng chính khi ở mode 1 người
    voice_male: str = "vi-VN-NamMinhNeural"  # Giọng nam khi ở mode phân vai
    voice_female: str = "vi-VN-HoaiMyNeural"  # Giọng nữ khi ở mode phân vai
    auto_detect_speakers: bool = True  # Tự động phân vai nam/nữ theo ngữ cảnh hội thoại
    gemini_prompt_style: str = "dramatic"  # Phong cách/sắc thái cho Gemini TTS
    rate: str = "+0%"
    pitch: str = "+0Hz"
    ducking_volume: float = 0.25
    local_rewrite_enabled: bool = True
    video_rescue_enabled: bool = True
    video_rescue_max_slowdown: float = 1.25
    edge_concurrency: int = Field(default=64, ge=1, le=128)
    capcut_concurrency: int = Field(default=80, ge=1, le=128)
    gemini_concurrency: int = Field(default=4, ge=1, le=128)
    request_timeout_seconds: float = Field(default=25.0, gt=0.1, le=300.0)


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
    enable_cue_follow_mask: bool = False


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
            # Drop removed providers/legacy ASR fields before validation. This
            # keeps old profiles readable without exposing or executing them.
            ocr_data = data.get("ocr") if isinstance(data, dict) else None
            if isinstance(ocr_data, dict):
                if ocr_data.get("local_engine") in {"hybrid", "whisper"}:
                    ocr_data["local_engine"] = "pure_ocr"
                if ocr_data.get("method") == "asr_whisper":
                    ocr_data["method"] = "ocr"
                if ocr_data.get("api_provider") == "groq":
                    ocr_data["api_provider"] = "capcut"
                for key in ("groq_api_key", "groq_model", "whisper_model", "whisper_device", "whisper_compute_type", "whisper_vad_filter", "hybrid_whisper_model", "hybrid_confidence_threshold", "hybrid_rescue_missing"):
                    ocr_data.pop(key, None)
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


def resolve_ocr_scan_profile(ocr_settings: ExtractionSettings) -> ExtractionSettings:
    """Apply scan_profile side-effects onto OCR flags.

    - vertical_short: keep ROI scan + adaptive rescue + ROI tightening (phim doc)
    - fixed_roi: only OCR inside the fixed frame; no rescue / no region shifting
    """
    profile = str(getattr(ocr_settings, "scan_profile", "vertical_short") or "vertical_short").strip().lower()
    if profile in {"fixed", "fixed_roi", "khung_co_dinh", "static"}:
        ocr_settings.scan_profile = "fixed_roi"
        ocr_settings.enable_adaptive_rescue = False
        ocr_settings.enable_roi_tightening = False
        ocr_settings.enable_gap_rescue = False
        ocr_settings.enable_persistent_text_filter = False
        ocr_settings.enable_cue_follow_mask = False
    else:
        ocr_settings.scan_profile = "vertical_short"
        ocr_settings.enable_adaptive_rescue = True
        # keep caller/user tightening if explicitly set; default on for vertical shorts
        if getattr(ocr_settings, "enable_roi_tightening", None) is None:
            ocr_settings.enable_roi_tightening = True
    return ocr_settings
