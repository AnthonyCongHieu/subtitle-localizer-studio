from __future__ import annotations

import argparse
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def lock_remote(source: dict[str, Any]) -> dict[str, Any]:
    remote_url = source.get("remote_url")
    if not remote_url:
        return {"id": source["id"], "status": "not_applicable", "pinned_ref": source.get("pinned_ref", "")}
    parsed = urlparse(remote_url)
    if parsed.hostname == "github.com":
        repository = parsed.path.strip("/").removesuffix(".git")
        try:
            request = Request(f"https://api.github.com/repos/{repository}/commits/HEAD", headers={"Accept": "application/vnd.github+json", "User-Agent": "subtitle-localizer-t00-lock/1"})
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
            sha = payload.get("sha")
        except Exception as error:  # The lock artifact records the exact public-metadata failure.
            return {"id": source["id"], "status": "verification_failed", "method": "github_public_metadata", "error": str(error), "pinned_ref": ""}
        if not isinstance(sha, str) or len(sha) != 40:
            return {"id": source["id"], "status": "verification_failed", "method": "github_public_metadata", "error": "public metadata did not contain a 40-character sha", "pinned_ref": ""}
        return {"id": source["id"], "status": "verified", "method": "github_public_metadata", "pinned_ref": sha}
    if parsed.hostname == "huggingface.co":
        model_id = parsed.path.strip("/").removesuffix(".git")
        try:
            request = Request(f"https://huggingface.co/api/models/{model_id}", headers={"User-Agent": "subtitle-localizer-t00-lock/1"})
            with urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
            sha = payload.get("sha")
        except Exception as error:  # The lock artifact records the exact public-metadata failure.
            return {"id": source["id"], "status": "verification_failed", "method": "huggingface_public_metadata", "error": str(error), "pinned_ref": ""}
        if not isinstance(sha, str) or len(sha) != 40:
            return {"id": source["id"], "status": "verification_failed", "method": "huggingface_public_metadata", "error": "public metadata did not contain a 40-character sha", "pinned_ref": ""}
        return {"id": source["id"], "status": "verified", "method": "huggingface_public_metadata", "pinned_ref": sha}
    try:
        environment = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "Never", "GIT_ASKPASS": ""}
        completed = subprocess.run(["git", "-c", "credential.helper=", "ls-remote", remote_url, "HEAD"], check=False, capture_output=True, text=True, timeout=20, env=environment)
    except (FileNotFoundError, subprocess.SubprocessError) as error:
        return {"id": source["id"], "status": "verification_failed", "method": "git_ls_remote", "error": str(error), "pinned_ref": ""}
    if completed.returncode != 0 or not completed.stdout.strip():
        return {"id": source["id"], "status": "verification_failed", "method": "git_ls_remote", "error": (completed.stderr or completed.stdout).strip() or f"git ls-remote exited {completed.returncode}", "pinned_ref": ""}
    return {"id": source["id"], "status": "verified", "method": "git_ls_remote", "pinned_ref": completed.stdout.split()[0]}


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh remote source pins with git ls-remote; never fabricates a hash.")
    parser.add_argument("--matrix", type=Path, default=REPOSITORY_ROOT / "docs" / "research" / "T00_SOURCE_MODEL_MATRIX.json")
    parser.add_argument("--output", type=Path, default=REPOSITORY_ROOT / "docs" / "research" / "T00_SOURCE_LOCK.json")
    arguments = parser.parse_args()
    matrix = json.loads(arguments.matrix.read_text(encoding="utf-8"))
    with ThreadPoolExecutor(max_workers=min(12, len(matrix["sources"]))) as executor:
        entries = list(executor.map(lock_remote, matrix["sources"]))
    lock = {"schema_version": "source-lock-v1", "generated_at_utc": datetime.now(UTC).isoformat(), "entries": entries}
    arguments.output.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(lock, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
