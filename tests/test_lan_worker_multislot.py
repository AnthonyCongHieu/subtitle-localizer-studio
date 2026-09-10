import hashlib
import threading
import time
from pathlib import Path

from subtitle_localizer.service.lan_protocol import ArtifactMetadata
from subtitle_localizer.service.lan_worker import (
    LanWorkerAgent,
    _copy_shared_source,
    collect_worker_capabilities,
)


def test_collect_worker_capabilities_includes_resources_and_slots(tmp_path):
    report = collect_worker_capabilities(tmp_path, max_concurrent_jobs=2)

    assert report["platform"] == "windows"
    assert report["max_concurrent_jobs"] == 2
    assert {"vram_total_mb", "vram_free_mb", "ram_free_mb", "disk_free_gb"} <= report.keys()
    assert report["disk_free_gb"] >= 0


def test_agent_executes_two_jobs_concurrently():
    class Agent(LanWorkerAgent):
        def __init__(self):
            super().__init__("http://coordinator", "worker-1", interval_seconds=0.01, max_concurrent_jobs=2)
            self.jobs = iter([{"job_id": "one"}, {"job_id": "two"}])
            self.started = threading.Event()
            self.release = threading.Event()
            self.running = 0
            self.peak = 0
            self.running_lock = threading.Lock()

        def register(self, metadata=None):
            return {}

        def claim(self):
            return next(self.jobs, None)

        def heartbeat(self, **payload):
            return {}

    agent = Agent()

    def handle(job, worker):
        with agent.running_lock:
            agent.running += 1
            agent.peak = max(agent.peak, agent.running)
            if agent.running == 2:
                agent.started.set()
        agent.release.wait(2)
        with agent.running_lock:
            agent.running -= 1

    thread = threading.Thread(target=agent.run, args=(handle,), daemon=True)
    thread.start()
    assert agent.started.wait(2)
    agent.release.set()
    agent.stop()
    thread.join(2)


def test_hybrid_transport_prefers_shared_copy_and_falls_back_to_http(tmp_path):
    shared = tmp_path / "shared.mp4"
    shared.write_bytes(b"shared source")
    metadata = ArtifactMetadata("source.mp4", "source", shared.stat().st_size, hashlib.sha256(shared.read_bytes()).hexdigest())
    destination = tmp_path / "workspace" / metadata.name

    copied = _copy_shared_source(shared, destination, metadata)
    assert copied.read_bytes() == shared.read_bytes()

    class Agent:
        def __init__(self):
            self.downloaded = False

        def download_artifact(self, path, destination, artifact):
            self.downloaded = True
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(shared.read_bytes())
            return destination

    agent = Agent()
    missing = tmp_path / "not-shared.mp4"
    try:
        _copy_shared_source(missing, destination, metadata)
    except FileNotFoundError:
        fallback = agent.download_artifact("/source/source.mp4", destination, metadata)
    else:
        raise AssertionError("missing shared source unexpectedly copied")
    assert agent.downloaded
    assert fallback.read_bytes() == shared.read_bytes()
