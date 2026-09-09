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
    check_frontend,
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

    assert (tmp_path / "subtitle_localizer.env").exists()
    assert (tmp_path / "gemini_keys_pool.json").exists()


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


def test_check_frontend():
    ok, msg = check_frontend(root_dir=ROOT_DIR, auto_build=False, force_build=False)
    assert ok is True
    assert "Web UI" in msg


def test_cli_build_web_check_only():
    import subprocess
    cmd = [sys.executable, str(SCRIPTS_DIR / "run_studio.py"), "--check-only", "--build-web", "--port", "59125"]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    assert res.returncode == 0
    assert "Giao diện Web UI" in res.stdout
    assert "SẴN SÀNG" in res.stdout


def test_host_and_worker_launchers_exist():
    """MVP distribution includes one-click host and copy-to-machine worker launchers."""
    assert (ROOT_DIR / "start-host.bat").exists()
    assert (ROOT_DIR / "start-worker.bat").exists()


def test_local_worker_factory_uses_loopback_by_default(monkeypatch, tmp_path):
    """Host bootstrap points its local agent at the co-located coordinator."""
    import run_studio
    monkeypatch.setenv("SL_DATABASE", str(tmp_path / "host.db"))
    monkeypatch.delenv("SL_COORDINATOR_URL", raising=False)
    agent, thread = run_studio.create_local_worker_agent(9876)
    try:
        assert agent.coordinator_url == "http://127.0.0.1:9876"
        assert agent.worker_id.startswith("worker-")
        assert thread.daemon is True
    finally:
        agent.stop()


def test_portable_worker_bundle_is_present_and_self_describing():
    """The copy-to-machine worker folder contains a bootstrap launcher and docs."""
    bundle = ROOT_DIR / "worker"
    assert (bundle / "start-worker.bat").exists()
    assert (bundle / "bootstrap_worker.py").exists()
    assert (bundle / "requirements.txt").exists()
    readme = (bundle / "README.md").read_text(encoding="utf-8")
    assert "UDP" in readme and "--skip-install" in readme


def test_worker_bootstrap_builds_agent_command(monkeypatch, tmp_path):
    """Bootstrap keeps coordinator discovery optional and passes an isolated DB."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("worker_bootstrap", ROOT_DIR / "worker" / "bootstrap_worker.py")
    bootstrap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bootstrap)
    monkeypatch.setattr(bootstrap, "VENV_DIR", tmp_path / ".venv")
    monkeypatch.setattr(bootstrap, "WORKER_DIR", tmp_path)
    monkeypatch.setattr(bootstrap, "REPO_ROOT", ROOT_DIR)
    fake_python = tmp_path / ".venv" / "Scripts" / "python.exe"
    fake_python.parent.mkdir(parents=True)
    fake_python.write_bytes(b"")
    monkeypatch.setattr(bootstrap, "_venv_python", lambda: fake_python)
    calls = []
    monkeypatch.setattr(bootstrap.subprocess, "call", lambda command, **kwargs: calls.append((command, kwargs)) or 0)
    monkeypatch.setattr(sys, "argv", ["bootstrap_worker.py", "--skip-install"])
    assert bootstrap.main() == 0
    assert calls and "run_worker_agent.py" in str(calls[0][0])
    assert "--database" in calls[0][0]
