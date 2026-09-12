# Local model selection

`SETUP_STUDIO.bat` keeps `translation.provider=gemini` and selects Local slots
only for explicit Local mode or fallback. It detects physical RAM and NVIDIA
VRAM, then writes `local_model`, `local_fallback_model`, and
`local_supported` to `pipeline_settings.json`.

## Profiles

| Tier | Host requirement | Slot 1 | Slot 2 |
|---|---|---|---|
| high | >=10 GB VRAM, >=24 GB RAM, >=8 CPU threads | qwen3:14b | gemma2:9b |
| medium | >=6 GB VRAM, >=16 GB RAM, >=6 CPU threads | gemma2:9b | qwen3:8b |
| low | >=4 GB VRAM, >=8 GB RAM, >=4 CPU threads | qwen3:4b | qwen3:4b |
| unsupported | below the minimum GPU/RAM/CPU gate | qwen3:4b | qwen3:4b |

The minimum supported Local host is a CUDA-capable GPU with 4 GB VRAM, 8 GB
physical RAM, and 4 logical CPU threads. Below that gate the installer still
writes both Local slots (so configuration is never empty), but sets
`local_supported=false` and keeps Gemini as the only supported execution path.
This avoids claiming that a model can run when the machine cannot sustain it.

The selector never invents quality for an untested model. The catalog records
`pending_benchmark` until the model is evaluated on the repository's 181-cue
OCR/Gemini reference set.

## Evidence

Measured in this repository on the 181-cue set:

- `qwen3:14b`: 53.99 Token-F1, 3 empty cues, 406 seconds, batch 10,
  `temperature=0.1`, `/no_think`.
- `gemma2:9b`: 47.2--47.7 Token-F1, 0--1 empty cues, about 28 seconds,
  batch 10, retry 1.

Model sizes and runtime capabilities are taken from the Ollama registry pages:

- https://ollama.com/library/qwen3
- https://ollama.com/library/gemma2

The setup does not treat registry claims as translation-quality scores. New
models must be benchmarked before being promoted into a measured rank.
