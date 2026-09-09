"""Run the LAN agent alongside a full Subtitle Localizer Studio worker."""
from __future__ import annotations

import argparse
import os
from pathlib import Path

from subtitle_localizer.persistence.database import Database
from subtitle_localizer.persistence.repository import ProjectRepository
from subtitle_localizer.service.lan_worker import LanWorkerAgent, build_pipeline_job_handler, build_download_handler, collect_worker_capabilities


def main() -> int:
    parser = argparse.ArgumentParser(description="Start a LAN worker agent")
    # Empty by default: discover the coordinator over UDP on the local LAN.
    # Set SL_COORDINATOR_URL or --coordinator for another subnet/VLAN.
    parser.add_argument("--coordinator", default=os.getenv("SL_COORDINATOR_URL", ""))
    parser.add_argument("--worker-id", default=os.getenv("SL_WORKER_ID", ""))
    parser.add_argument("--token", default=os.getenv("SL_WORKER_TOKEN", ""))
    parser.add_argument("--database", default=os.getenv("SL_DATABASE", "subtitle_localizer.db"))
    parser.add_argument("--interval", type=float, default=5.0)
    args = parser.parse_args()
    # Worker ID and coordinator URL are discoverable on the LAN.  A token is
    # still accepted (and recommended when the coordinator enforces auth),
    # but an empty token keeps the zero-config local/LAN setup usable.
    database = Database(Path(args.database))
    database.migrate()
    repository = ProjectRepository(database)
    agent = LanWorkerAgent(args.coordinator, args.worker_id, args.token, interval_seconds=args.interval)
    try:
        agent.run(build_pipeline_job_handler(repository), build_download_handler(repository), collect_worker_capabilities())
    except KeyboardInterrupt:
        agent.stop()
    finally:
        database.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
