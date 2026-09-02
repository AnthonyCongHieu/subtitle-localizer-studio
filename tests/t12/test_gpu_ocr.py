import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from subtitle_localizer.ocr.rapid import RapidOcrProvider


def install_runtime(monkeypatch, available, actual):
    runtime = SimpleNamespace(
        get_available_providers=lambda: available,
        preload_dlls=Mock(),
    )
    sessions = [
        SimpleNamespace(get_providers=lambda: actual, disable_fallback=Mock())
        for _ in range(3)
    ]
    engine = SimpleNamespace(
        text_det=SimpleNamespace(infer=SimpleNamespace(session=sessions[0])),
        text_cls=SimpleNamespace(infer=SimpleNamespace(session=sessions[1])),
        text_rec=SimpleNamespace(session=SimpleNamespace(session=sessions[2])),
    )
    factory = Mock(return_value=engine)
    monkeypatch.setitem(sys.modules, 'onnxruntime', runtime)
    monkeypatch.setitem(
        sys.modules, 'rapidocr_onnxruntime', SimpleNamespace(RapidOCR=factory)
    )
    return runtime, factory


def test_gpu_is_enabled_for_all_ocr_sessions(monkeypatch):
    runtime, factory = install_runtime(
        monkeypatch, ['CUDAExecutionProvider', 'CPUExecutionProvider'],
        ['CUDAExecutionProvider', 'CPUExecutionProvider'],
    )
    provider = RapidOcrProvider()
    provider.load()
    factory.assert_called_once_with(det_use_cuda=True, cls_use_cuda=True, rec_use_cuda=True)
    runtime.preload_dlls.assert_called_once_with(directory='')
    assert provider.execution_provider == 'CUDAExecutionProvider'


def test_cpu_only_install_remains_supported(monkeypatch):
    runtime, factory = install_runtime(
        monkeypatch, ['CPUExecutionProvider'], ['CPUExecutionProvider']
    )
    provider = RapidOcrProvider()
    provider.load()
    factory.assert_called_once_with(det_use_cuda=False, cls_use_cuda=False, rec_use_cuda=False)
    runtime.preload_dlls.assert_not_called()
    assert provider.execution_provider == 'CPUExecutionProvider'


def test_gpu_session_fallback_is_an_explicit_failure(monkeypatch):
    install_runtime(
        monkeypatch, ['CUDAExecutionProvider', 'CPUExecutionProvider'], ['CPUExecutionProvider']
    )
    provider = RapidOcrProvider()
    with pytest.raises(RuntimeError, match='CUDA'):
        provider.load()
    assert not provider.is_loaded
    assert provider.engine is None


def test_gpu_disables_runtime_fallback_on_every_session(monkeypatch):
    install_runtime(monkeypatch, ['CUDAExecutionProvider'], ['CUDAExecutionProvider'])
    provider = RapidOcrProvider()
    provider.load()
    sessions = [provider.engine.text_det.infer.session,
                provider.engine.text_cls.infer.session,
                provider.engine.text_rec.session.session]
    for session in sessions:
        session.disable_fallback.assert_called_once_with()


def test_gpu_rejects_one_cpu_recognition_session(monkeypatch):
    _, factory = install_runtime(monkeypatch, ['CUDAExecutionProvider'], ['CUDAExecutionProvider'])
    factory.return_value.text_rec.session.session.get_providers = lambda: ['CPUExecutionProvider']
    with pytest.raises(RuntimeError, match='CUDA'):
        RapidOcrProvider().load()


def test_windows_cuda_paths_are_available_to_delayed_cudnn_loads(monkeypatch, tmp_path):
    import subtitle_localizer.ocr.rapid as rapid
    import importlib.metadata
    import os
    toolkit = tmp_path / 'toolkit'
    (toolkit / 'bin').mkdir(parents=True)
    package_bin = tmp_path / 'nvidia' / 'cudnn' / 'bin'
    package_bin.mkdir(parents=True)
    monkeypatch.setenv('CUDA_PATH', str(toolkit))
    monkeypatch.setenv('PATH', 'original-path')
    monkeypatch.setattr(sys, 'platform', 'win32')
    monkeypatch.setattr(importlib.metadata, 'distribution',
                        lambda name: SimpleNamespace(locate_file=lambda path: tmp_path / path))
    add_directory = Mock(return_value=SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(os, 'add_dll_directory', add_directory, raising=False)
    handles = rapid._prepare_windows_cuda_dlls()
    assert str(package_bin) in os.environ['PATH'].split(os.pathsep)
    assert str(toolkit / 'bin') in os.environ['PATH'].split(os.pathsep)
    assert 'original-path' in os.environ['PATH'].split(os.pathsep)
    assert len(handles) == 2

    first_handle = Mock()
    add_directory.side_effect = [first_handle, OSError('directory unavailable')]
    with pytest.raises(OSError, match='directory unavailable'):
        rapid._prepare_windows_cuda_dlls()
    first_handle.close.assert_called_once_with()
