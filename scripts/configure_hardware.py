"""Select a supported local translation profile from the host capabilities.

The selector is deliberately conservative: it never assumes a GPU is present
and emits a machine-readable report for the Windows bootstrap script.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any


# Facts are model metadata, not guessed quality scores.  Quality is only
# reported where this repository has measured the model on the 181-cue OCR/API
# corpus; all other entries are explicitly marked pending benchmark.
MODEL_CATALOG = {
    "qwen3:14b": {"min_vram_gb": 10, "min_ram_gb": 24, "size_gb": 9.3, "quality": 53.99, "quality_status": "measured_181_cues"},
    "gemma2:9b": {"min_vram_gb": 6, "min_ram_gb": 16, "size_gb": 5.4, "quality": 47.6, "quality_status": "measured_181_cues"},
    "qwen3:8b": {"min_vram_gb": 6, "min_ram_gb": 16, "size_gb": 5.2, "quality": None, "quality_status": "pending_benchmark"},
    "qwen3:4b": {"min_vram_gb": 4, "min_ram_gb": 8, "size_gb": 2.5, "quality": None, "quality_status": "pending_benchmark"},
}

# A Local slot is always persisted, but these are the minimum host facts for
# claiming that the selected model can actually be run.  CPU is intentionally
# conservative because Ollama may spill layers to system memory on small GPUs.
MIN_CPU_THREADS = 4
MIN_GPU_VRAM_GB = 4
MIN_RAM_GB = 8


def _ram_gb() -> float:
    try:
        import psutil  # type: ignore

        return round(psutil.virtual_memory().total / (1024**3), 1)
    except Exception:
        # Windows exposes this without requiring an extra dependency.
        try:
            raw = subprocess.check_output(
                ["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"],
                text=True,
                timeout=5,
            )
            return round(int(raw.strip()) / (1024**3), 1)
        except (OSError, ValueError, subprocess.SubprocessError):
            return 0.0


def _nvidia_vram_gb() -> float:
    try:
        raw = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            text=True,
            timeout=8,
        )
        values = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", raw)]
        return round(max(values, default=0.0) / 1024, 1)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0.0


def select_profile(ram_gb: float, vram_gb: float, cpu_threads: int = MIN_CPU_THREADS) -> dict[str, Any]:
    """Return a model tier that fits both memory and the local runtime."""
    # Only models maintained by this project are candidates.  Qwen3 is the
    # quality slot; Gemma2 is the lower-memory rescue slot.
    if vram_gb >= 10 and ram_gb >= 24 and cpu_threads >= 8:
        model, fallback, tier, supported = "qwen3:14b", "gemma2:9b", "high", True
    elif vram_gb >= 6 and ram_gb >= 16 and cpu_threads >= 6:
        model, fallback, tier, supported = "gemma2:9b", "qwen3:8b", "medium", True
    elif vram_gb >= MIN_GPU_VRAM_GB and ram_gb >= MIN_RAM_GB and cpu_threads >= MIN_CPU_THREADS:
        model, fallback, tier, supported = "qwen3:4b", "qwen3:4b", "low", True
    else:
        # Every machine gets a Local slot.  The smallest profile is still
        # explicitly marked conservative; setup pulls the tiny model and API
        # remains the default if the host cannot sustain its throughput.
        model, fallback, tier, supported = "qwen3:4b", "qwen3:4b", "unsupported", False
    return {"tier": tier, "local_model": model, "local_fallback_model": fallback, "local_supported": supported,
            "minimum_requirements": {"cpu_threads": MIN_CPU_THREADS, "ram_gb": MIN_RAM_GB, "vram_gb": MIN_GPU_VRAM_GB},
            "hardware_gate": {"cpu_threads": cpu_threads, "ram_gb": ram_gb, "vram_gb": vram_gb},
            "model_rank": [model, fallback], "model_facts": {name: MODEL_CATALOG[name] for name in dict.fromkeys((model, fallback))}}


def configure(settings_path: Path) -> dict[str, Any]:
    ram, vram, cpu_threads = _ram_gb(), _nvidia_vram_gb(), os.cpu_count() or 0
    profile = select_profile(ram, vram, cpu_threads)
    data = json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.exists() else {}
    translation = data.setdefault("translation", {})
    # API remains the product default; this command only selects the Local
    # slots used when the user explicitly chooses Local or fallback activates.
    translation.update({k: profile[k] for k in ("local_model", "local_fallback_model", "local_supported")})
    # Setup is the product bootstrap contract: API/Gemini remains the active
    # provider even when an older settings file selected Local explicitly.
    translation["provider"] = "gemini"
    translation.setdefault("local_endpoint", "http://localhost:11434")
    settings_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {"ram_gb": ram, "nvidia_vram_gb": vram, "cpu_threads": cpu_threads, **profile, "settings": str(settings_path)}
    print(json.dumps(report, ensure_ascii=False))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--settings", type=Path, default=Path("pipeline_settings.json"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.dry_run:
        ram, vram, cpu_threads = _ram_gb(), _nvidia_vram_gb(), os.cpu_count() or 0
        print(json.dumps({"ram_gb": ram, "nvidia_vram_gb": vram, "cpu_threads": cpu_threads, **select_profile(ram, vram, cpu_threads)}, ensure_ascii=False))
    else:
        configure(args.settings)


if __name__ == "__main__":
    main()
