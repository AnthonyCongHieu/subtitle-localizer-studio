"""Objective quality evaluators for OCR and subtitle outputs."""

from .ocr_quality import evaluate_srt_pair

__all__ = ["evaluate_srt_pair"]
