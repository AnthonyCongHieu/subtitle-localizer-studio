@echo off
chcp 65001 >nul
title SUBTITLE LOCALIZER STUDIO - BENCHMARK REMOTE RTX 5090

echo ======================================================================
echo    SUBTITLE LOCALIZER STUDIO - MULTI-MODEL TRANSLATION BENCHMARK
echo    Endpoint Remote RTX 5090: http://192.168.1.219:11434
echo ======================================================================
echo.

set PYTHONIOENCODING=utf-8
python benchmarks\run_remote_models_benchmark.py --endpoint http://192.168.1.219:11434 --local-fallback http://localhost:11434 --models qwen2.5:14b qwen2.5:32b sailor2:20b deepseek-r1:14b qwen2.5:7b-instruct --limit-cues 25

echo.
echo ======================================================================
echo    Benchmark hoàn tất! Kết quả đã được lưu tại:
echo    - benchmarks\results\remote_models_benchmark_report.md
echo    - benchmarks\results\remote_models_benchmark_results.json
echo ======================================================================
pause
