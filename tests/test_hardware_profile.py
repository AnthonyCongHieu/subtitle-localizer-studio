from scripts.configure_hardware import select_profile


def test_high_memory_profile():
    profile = select_profile(32, 12, 16)
    assert profile["local_model"] == "qwen3:14b"
    assert profile["local_fallback_model"] == "gemma2:9b"
    assert profile["local_supported"] is True


def test_medium_profile():
    profile = select_profile(16, 8, 8)
    assert profile["local_model"] == "gemma2:9b"
    assert profile["local_fallback_model"] == "qwen3:8b"


def test_cpu_safe_profile():
    profile = select_profile(8, 0, 8)
    assert profile["local_model"] == "qwen3:4b"
    assert profile["local_supported"] is False
    assert profile["tier"] == "unsupported"


def test_minimum_supported_gpu_profile():
    profile = select_profile(8, 4, 4)
    assert profile["local_model"] == "qwen3:4b"
    assert profile["local_supported"] is True
