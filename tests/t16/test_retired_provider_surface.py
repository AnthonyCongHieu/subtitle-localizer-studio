"""Regression tests for retired Groq/Whisper integrations.

The old provider modules may remain on disk for migration purposes, but they
must not be exported or reachable through the production API/settings.
"""

import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))


def test_cloud_package_does_not_export_retired_whisper_provider() -> None:
    import subtitle_localizer.cloud as cloud

    assert not hasattr(cloud, "GroqWhisperExtractor")
    assert "GroqWhisperExtractor" not in getattr(cloud, "__all__", ())


def test_production_api_has_no_groq_endpoints() -> None:
    from subtitle_localizer.service.server import create_app

    client = TestClient(create_app())
    for path in (
        "/api/v1/settings/groq-pool",
        "/api/v1/settings/groq-pool/verify",
        "/api/v1/settings/groq-check",
    ):
        assert client.get(path).status_code == 404


def test_legacy_ocr_values_are_normalized_to_pure_ocr() -> None:
    import json
    from tempfile import TemporaryDirectory
    from subtitle_localizer.service.pipeline_settings import load_pipeline_settings

    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "legacy.json"
        path.write_text(json.dumps({"ocr": {"local_engine": "hybrid", "api_provider": "groq", "method": "asr_whisper"}}), encoding="utf-8")
        settings = load_pipeline_settings(path)
    assert settings.ocr.local_engine == "pure_ocr"
    assert settings.ocr.api_provider in {"gemini", "capcut", None}
    assert settings.ocr.method != "asr_whisper"
