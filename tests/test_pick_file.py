import importlib.util
from pathlib import Path
from unittest.mock import MagicMock, patch


_SPEC = importlib.util.spec_from_file_location("pick_file", Path(__file__).parents[1] / "scripts" / "pick_file.py")
assert _SPEC and _SPEC.loader
pick_file = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(pick_file)


def test_powershell_picker_uses_interactive_gui_mode() -> None:
    completed = MagicMock(stdout="", returncode=0)
    with patch.object(pick_file.subprocess, "run", return_value=completed) as run:
        pick_file.pick_via_powershell("single")

    command = run.call_args.args[0]
    assert "-STA" in command
    assert "-NonInteractive" not in command


def test_main_prefers_tkinter_in_interactive_windows_session(monkeypatch, capsys) -> None:
    monkeypatch.setattr(pick_file.os, "name", "nt")
    monkeypatch.setattr(pick_file, "pick_via_powershell", lambda mode: (_ for _ in ()).throw(RuntimeError("picker unavailable")))
    monkeypatch.setattr(pick_file, "pick_via_tkinter", lambda mode: "C:/video.mp4")

    pick_file.main()

    assert capsys.readouterr().out.strip() == "C:/video.mp4"


def test_main_uses_powershell_when_tkinter_is_unavailable(monkeypatch, capsys) -> None:
    monkeypatch.setattr(pick_file.os, "name", "nt")
    monkeypatch.setattr(pick_file, "pick_via_tkinter", lambda mode: (_ for _ in ()).throw(RuntimeError("tk unavailable")))
    monkeypatch.setattr(pick_file, "pick_via_powershell", lambda mode: "C:/video.mp4")

    pick_file.main()

    assert capsys.readouterr().out.strip() == "C:/video.mp4"
