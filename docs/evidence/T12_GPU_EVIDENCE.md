# T12 GPU OCR validation checkpoint

Date: 2026-09-03. This is a checkpoint, not completion of T12 or a release gate.

## Changes and regression risks

- RapidOCR previously constructed all sessions with default CPU settings.
- The provider now detects CUDA availability, preloads NVIDIA DLLs, enables CUDA
  for detection/classification/recognition, and verifies each actual session.
- CUDA sessions disable ONNX Runtime's inference-time CPU fallback. A broken GPU
  installation now fails explicitly instead of reporting CUDA while using CPU.
- CPU-only installations retain CPU execution. A GPU wheel with missing DLLs is
  intentionally an error; merely advertising CUDA is not evidence of inference.
- Rescue preprocessing stops at confidence 0.90. This reduces repeated work but
  may retain confidently incorrect OCR; confidence is not an accuracy measure.
- Chinese OCR ignores Latin-only lines. Chinese mixed with numbers is retained;
  purely numeric lines remain possible. Latin-only names require manual review.

## Environment and installation

- NVIDIA GeForce RTX 3050 6GB Laptop GPU, 6144 MiB, driver 581.86.
- Python 3.11; RapidOCR ONNX Runtime 1.4.4.
- Existing CUDA Toolkit 12.1 binaries are on PATH.
- `python -m pip install "onnxruntime-gpu[cuda,cudnn]==1.23.2"` failed
  with exit 1 during the 732.3 MB cuDNN download (HTTP read timeout).
- `python -m pip install "onnxruntime-gpu==1.23.2" "nvidia-cuda-runtime-cu12==12.9.79" "nvidia-cuda-nvrtc-cu12==12.9.86" --timeout 120`
  completed with exit 0.
- Resumed the official cuDNN wheel using `curl.exe -4 -L --fail --retry 3
  --connect-timeout 20 --max-time 300 -C - -o WHEEL_PATH WHEEL_URL`; exit 0.
  The verified PyPI SHA-256 is
  `debb5f5901ae6071f34d0a2b256acecc33dc3277f1fd5a11f8249f921db8a40d`.
  `python -m pip install --no-deps WHEEL_PATH` completed with exit 0.
  Here `WHEEL_PATH` was the resumed pip temporary wheel, and `WHEEL_URL` was
  `https://files.pythonhosted.org/packages/0b/ee/b5699f1960e358ec995bb72f71c2ec06c550fd0c8280525796d6646c0299/nvidia_cudnn_cu12-9.25.1.1-py3-none-win_amd64.whl`.
  cuBLAS/cuFFT come from the existing CUDA Toolkit, not their Python wheels.
- Initial actual inference failed with missing delayed cuDNN engine DLLs, exit 1.
  `os.add_dll_directory` alone was insufficient. Adding installed NVIDIA `bin`
  directories to the process PATH fixed cuDNN's delayed library loading.
  The provider now does both automatically; no global/system PATH is modified.
- All three actual model sessions initialized CUDA. Warm inference succeeded
  with runtime CPU fallback disabled.
- For a fresh GPU setup, install base project dependencies first, then the GPU
  runtime and CUDA/cuDNN extras. The legacy RapidOCR dependency also installs the
  CPU `onnxruntime` distribution; reinstalling it afterward can overwrite the
  shared Python module. Always verify actual sessions after environment changes.

## Verification commands

| Command | Result | Exit |
| --- | --- | --- |
| `python -m pytest -q tests/t12/test_gpu_ocr.py` before GPU implementation | 3 failed as expected | 1 |
| `python -m pytest -q tests/t12/test_gpu_ocr.py tests/t04` after initial GPU fix | 7 passed | 0 |
| `python -m pytest -q tests/t12/test_real_video_hardening.py -k "stops_rescue or only_original or discards_latin"` before rescue/filter fix | 3 failed as expected | 1 |
| `python -m pytest -q tests/t12 tests/t04 tests/t07` after rescue/filter fix | 30 passed | 0 |
| `python -m pytest -q tests/t12/test_gpu_ocr.py` before runtime-fallback fix | 1 failed, 4 passed | 1 |
| `python -m pytest -q tests/t12/test_gpu_ocr.py` after runtime-fallback fix | 5 passed | 0 |
| `python -m pytest -q tests/t12/test_gpu_ocr.py -k delayed` before DLL fix and before partial-handle cleanup | failed as expected in each red run | 1 |
| `python -m pytest -q tests/t12/test_gpu_ocr.py` after DLL/cleanup fixes | 6 passed | 0 |
| `python -m pytest -q` | 106 passed | 0 |
| `python -m compileall -q src scripts` | passed | 0 |
| `python scripts/t00/utf8_scan.py .` | passed | 0 |
| `npm run build` (working directory `web`) | passed | 0 |
| `git diff --check` | passed; Git CRLF conversion warnings only | 0 |

Independent read-only reviewer: scoped GPU/rescue/filter code approved after
fixing inference-time fallback and partial DLL handle cleanup. Reviewer reran
22 focused tests, exit 0. This verdict does not establish full T12 completion.

## CPU baseline

On `01_Three_Minutes_TranKhaTan.mp4`, frame 58.320 seconds, ROI
`(x=0.10, y=0.75, width=0.80, height=0.20)`, three direct CPU engine calls:
3.456, 1.692, 1.902 seconds. Chinese line: `前几天我妹突然跟我说，`.

Earlier end-to-end 60-second CPU smoke: 861.510 seconds, 15 cues, exit 0.
Artifacts: ignored `outputs/real_video_ocr/smoke/`.
The direct-frame timing and end-to-end timing measure different workloads.

## GPU results

Same direct crop as CPU: three CUDA calls took 1.466, 0.395, 0.400 seconds.
Warm-call means: CPU 1.797 seconds, GPU 0.397 seconds (approximately 4.5x).
The Chinese text remained `前几天我妹突然跟我说，`.

Normal application CLI, without an external environment wrapper:

```powershell
python scripts/run_real_video_batch.py --input-dir 'C:/Users/PC/.gemini/antigravity/scratch/chinese_short_films' --output-dir outputs/real_video_ocr/gpu-smoke --language zh --no-translate --max-duration 60 --limit 1
```

Exit 0: 117.332 seconds, 10 cues, SRT and ASS written. Approximately 7.3x faster
than the earlier CPU smoke; this includes BOTH GPU and preprocessing/filter
changes, so it is not an isolated hardware-only speedup.
During execution, `nvidia-smi --query-gpu=utilization.gpu,memory.used,power.draw --format=csv,noheader`
reported 92%, 3060 MiB, 20.25 W (exit 0).

Report: `outputs/real_video_ocr/gpu-smoke/01_Three_Minutes_TranKhaTan/01_Three_Minutes_TranKhaTan.report.json`.
SHA-256: `568b8c381384a950e661c86e4e2549b4152a8e95dcda6464dd63a95a4db46fd5`.

Visual checks against exported evidence frames:

| Timestamp | OCR | Finding |
| --- | --- | --- |
| 18.960 | 我跑的这趟车是从南宁到哈尔滨的 | Chinese characters match; final punctuation omitted |
| 58.320 | 前几天我妹突然跟我说 | Chinese characters match; final punctuation omitted |

No CER/accuracy percentage is claimed. Opening centered titles remain outside
the default bottom ROI. Cue 3 reads `般跑六天。` and needs review for a possible
missing leading character. GPU acceleration does not itself fix model errors.

## Remaining T12 validation

- Complete the five-video run and spot checks required by the approved T12 plan.
- Resolve remaining OCR quality findings before calling the overall ticket done.
