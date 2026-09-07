import os
import sys
from pathlib import Path
import pytest

# Ensure scripts directory is in path
ROOT_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = ROOT_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from run_studio import (
    check_python_version,
    check_dependencies,
    is_port_in_use,
    free_port,
    check_and_fix_configs,
    check_database,
    check_ffmpeg,
    CORE_MODULES,
)


def test_check_python_version():
    ok, msg = check_python_version()
    assert ok is True
    assert "Python" in msg


def test_check_dependencies():
    ok, missing = check_dependencies(CORE_MODULES)
    # On the test environment, core modules should be present
    assert isinstance(missing, list)
    assert isinstance(ok, bool)


def test_is_port_in_use_on_unused_port():
    # An unusual high port should not be in use
    in_use = is_port_in_use(59123)
    assert in_use is False


def test_check_and_fix_configs(tmp_path):
    # Test on a temporary directory to verify auto-creation
    example_env = tmp_path / "subtitle_localizer.env.example"
    example_env.write_text("TEST_KEY=123", encoding="utf-8")

    example_gemini = tmp_path / "gemini_keys_pool.json.example"
    example_gemini.write_text("[\"AIzaSyTestKey\"]", encoding="utf-8")

    results = check_and_fix_configs(tmp_path)
    assert results["env"] is True
    assert results["gemini_pool"] is True
    assert results["groq_pool"] is True

    assert (tmp_path / "subtitle_localizer.env").exists()
    assert (tmp_path / "gemini_keys_pool.json").exists()
    assert (tmp_path / "groq_keys_pool.json").exists()


def test_check_and_fix_configs_corrupted_json(tmp_path):
    import json
    corrupted_gemini = tmp_path / "gemini_keys_pool.json"
    corrupted_gemini.write_text("{broken json invalid syntax", encoding="utf-8")

    results = check_and_fix_configs(tmp_path)
    assert results["gemini_pool"] is True

    # After healing, it should be a valid JSON list
    data = json.loads(corrupted_gemini.read_text(encoding="utf-8"))
    assert isinstance(data, list)


def test_check_database(tmp_path):
    # Database check with temporary database
    db_file = tmp_path / "test_launcher.db"
    ok, msg = check_database(db_file)
    assert ok is True
    assert db_file.exists()


def test_check_ffmpeg():
    ok, msg = check_ffmpeg()
    assert isinstance(ok, bool)
    assert isinstance(msg, str)


def test_free_port_on_free_port():
    assert free_port(59124) is True


def test_run_preflight_checks():
    from run_studio import run_preflight_checks
    ok = run_preflight_checks(root_dir=ROOT_DIR, auto_fix=False, port=59124)
    assert ok is True


def test_cli_check_only():
    import subprocess
    cmd = [sys.executable, str(SCRIPTS_DIR / "run_studio.py"), "--check-only", "--port", "59124"]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    assert res.returncode == 0
    assert "SUBTITLE LOCALIZER STUDIO" in res.stdout
    assert "SẴN SÀNG" in res.stdout
