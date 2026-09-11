#!/usr/bin/env python3
"""Download PP-OCRv5 ONNX models and character dictionaries for local OCR.

Assets are stored under benchmarks/models/ (gitignored). Sources:
- ONNX: RapidAI RapidOCR on ModelScope
- inference.yml dictionaries: official PaddleX PP-OCRv5 rec infer tars
"""

from __future__ import annotations

import argparse
import shutil
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIR = ROOT / "benchmarks" / "models"
TMP_DIR = ROOT / "_tmp_ppocr"

ONNX_URLS = {
    "mobile": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx",
    "server": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_server.onnx",
}
TAR_URLS = {
    "mobile": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_rec_infer.tar",
    "server": "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_server_rec_infer.tar",
}


def download(url: str, dest: Path, force: bool = False) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0 and not force:
        print(f"skip existing {dest} ({dest.stat().st_size} bytes)")
        return
    print(f"downloading {url}")
    print(f" -> {dest}")
    urllib.request.urlretrieve(url, dest)
    print(f"done {dest.stat().st_size} bytes")


def extract_inference_yml(tar_path: Path, dest_yml: Path) -> None:
    extract_dir = TMP_DIR / f"{tar_path.stem}_extract"
    if extract_dir.exists():
        shutil.rmtree(extract_dir)
    extract_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tar_path, "r") as handle:
        handle.extractall(extract_dir)
    candidates = list(extract_dir.rglob("inference.yml"))
    if not candidates:
        raise FileNotFoundError(f"inference.yml not found inside {tar_path}")
    shutil.copy2(candidates[0], dest_yml)
    print(f"copied dictionary -> {dest_yml}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_DIR)
    parser.add_argument("--tiers", nargs="+", choices=("mobile", "server"), default=["mobile", "server"])
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--keep-temp", action="store_true")
    args = parser.parse_args()

    model_dir: Path = args.model_dir
    model_dir.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    for tier in args.tiers:
        onnx_dest = model_dir / f"ppocrv5_{tier}_rec.onnx"
        yml_dest = model_dir / f"ppocrv5_{tier}_inference.yml"
        tar_dest = TMP_DIR / Path(TAR_URLS[tier]).name
        download(ONNX_URLS[tier], onnx_dest, force=args.force)
        download(TAR_URLS[tier], tar_dest, force=args.force)
        if yml_dest.exists() and yml_dest.stat().st_size > 0 and not args.force:
            print(f"skip existing {yml_dest}")
        else:
            extract_inference_yml(tar_dest, yml_dest)

    print("installed:")
    for path in sorted(model_dir.glob("ppocrv5_*")):
        print(f"  {path.name:32} {path.stat().st_size:>10} bytes")

    if not args.keep_temp and TMP_DIR.exists():
        shutil.rmtree(TMP_DIR, ignore_errors=True)
        print(f"cleaned {TMP_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
