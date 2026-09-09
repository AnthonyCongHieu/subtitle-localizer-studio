from types import SimpleNamespace

import numpy as np

from subtitle_localizer.domain.models import OcrObservationV1
from subtitle_localizer.ocr.ppocrv5 import PPOCRv5Provider
from subtitle_localizer.ocr.registry import OcrRegistry


def test_ctc_decoder_collapses_repeats_and_blank() -> None:
    provider = PPOCRv5Provider(character_dict=["", "你", "好"])
    logits = np.full((1, 5, 3), -10.0, dtype=np.float32)
    logits[0, 0, 1] = 10.0
    logits[0, 1, 1] = 10.0
    logits[0, 2, 0] = 10.0
    logits[0, 3, 2] = 10.0
    logits[0, 4, 0] = 10.0
    assert provider._decode_ctc(logits) == [("你好", 1.0)]


def test_recognize_batches_and_returns_public_observation_contract(monkeypatch, tmp_path) -> None:
    class FakeSession:
        def __init__(self, *_args, **_kwargs):
            self._inputs = [SimpleNamespace(name="x")]

        def get_inputs(self):
            return self._inputs

        def run(self, _outputs, feed):
            assert feed["x"].shape == (2, 3, 48, 64)
            logits = np.full((2, 3, 3), -10.0, dtype=np.float32)
            logits[:, 0, 1] = 10.0
            logits[:, 1, 0] = 10.0
            logits[:, 2, 2] = 10.0
            return [logits]

    monkeypatch.setattr("onnxruntime.InferenceSession", FakeSession)
    model_path = tmp_path / "fake.onnx"
    model_path.write_bytes(b"placeholder")
    provider = PPOCRv5Provider(model_path=model_path, character_dict=["", "你", "好"], batch_size=2)
    provider.load()
    crops = [np.zeros((24, 32, 3), dtype=np.uint8), np.zeros((48, 64, 3), dtype=np.uint8)]
    observations = provider.recognize(crops, [1.0, 2.0], language="zh")
    assert all(isinstance(item, OcrObservationV1) for item in observations)
    assert [item.raw_text for item in observations] == ["你好", "你好"]
    assert [item.pts for item in observations] == [1.0, 2.0]


def test_runtime_status_reports_provider_without_loading_model() -> None:
    provider = PPOCRv5Provider(character_dict=["", "你"])
    status = provider.runtime_status()
    assert status["loaded"] is False
    assert status["model_tier"] == "mobile"


def test_registry_exposes_mobile_and_server_aliases_without_loading() -> None:
    registry = OcrRegistry()
    assert isinstance(registry.get_provider("ppocrv5"), PPOCRv5Provider)
    assert isinstance(registry.get_provider("ppocrv5-mobile"), PPOCRv5Provider)
    assert isinstance(registry.get_provider("ppocrv5-server"), PPOCRv5Provider)


def test_cuda_initialization_retries_cpu_execution_provider(monkeypatch, tmp_path) -> None:
    import onnxruntime as ort

    calls = []

    class FallbackSession:
        def __init__(self, _path, providers):
            calls.append(list(providers))
            if "CUDAExecutionProvider" in providers:
                raise RuntimeError("CUDA DLL unavailable")
            self._inputs = [SimpleNamespace(name="x")]

        def get_inputs(self):
            return self._inputs

    monkeypatch.setattr(ort, "get_available_providers", lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"])
    monkeypatch.setattr(ort, "InferenceSession", FallbackSession)
    model_path = tmp_path / "fake.onnx"
    model_path.write_bytes(b"placeholder")
    provider = PPOCRv5Provider(model_path=model_path, character_dict=["", "你"])
    provider.load()
    assert calls == [["CUDAExecutionProvider", "CPUExecutionProvider"], ["CPUExecutionProvider"]]
    assert provider.execution_provider == "CPUExecutionProvider"


def test_inference_runtime_error_retries_cpu_once(monkeypatch, tmp_path) -> None:
    import onnxruntime as ort

    calls = []

    class RuntimeFallbackSession:
        def __init__(self, _path, providers):
            self.providers = list(providers)
            self._inputs = [SimpleNamespace(name="x")]
            calls.append(self.providers)

        def get_inputs(self):
            return self._inputs

        def get_providers(self):
            return self.providers

        def run(self, _outputs, _feed):
            if "CUDAExecutionProvider" in self.providers:
                raise RuntimeError("CUDA out of memory")
            logits = np.full((1, 2, 2), -10.0, dtype=np.float32)
            logits[:, 0, 1] = 10.0
            logits[:, 1, 0] = 10.0
            return [logits]

    monkeypatch.setattr(ort, "get_available_providers", lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"])
    monkeypatch.setattr(ort, "InferenceSession", RuntimeFallbackSession)
    model_path = tmp_path / "fake.onnx"
    model_path.write_bytes(b"placeholder")
    provider = PPOCRv5Provider(model_path=model_path, character_dict=["", "你"])
    result = provider.recognize([np.zeros((48, 32, 3), dtype=np.uint8)], [0.0])
    assert result[0].raw_text == "你"
    assert provider.execution_provider == "CPUExecutionProvider"
    assert calls == [["CUDAExecutionProvider", "CPUExecutionProvider"], ["CPUExecutionProvider"]]
