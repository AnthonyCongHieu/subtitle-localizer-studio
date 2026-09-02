from __future__ import annotations

from pathlib import Path


MOJIBAKE_PREFIXES = ("\u00e3\u201a", "\u00e3\u0192", "\u00c3\u00a2", "\u00c3\u00a3", "\u00c3\u00a4", "\u00c3\u00a5", "\u00c3\u00a6", "\u00c3\u00b8")


def scan_text(text: str) -> list[str]:
    findings: list[str] = []
    if "\ufffd" in text:
        findings.append("replacement character")
    if any(prefix in text for prefix in MOJIBAKE_PREFIXES):
        findings.append("mojibake indicator")
    return findings


def scan_paths(paths: list[Path]) -> list[str]:
    findings: list[str] = []
    for path in paths:
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            findings.append(f"{path}: invalid UTF-8")
            continue
        for finding in scan_text(content):
            findings.append(f"{path}: {finding}")
    return findings
