# Worker portable bundle

Copy this `worker` folder to a Windows machine that has Python 3.10+ and run
`start-worker.bat`. The first run creates `worker\.venv` and installs the
canonical requirements automatically. The worker then discovers a coordinator
on the same LAN through UDP broadcast and registers with a stable machine ID.

For another subnet, pass a URL explicitly:

```text
start-worker.bat --coordinator http://192.168.1.10:8899 --token <registration-token>
```

Use `--skip-install` when dependencies were preinstalled or the machine is
offline. The local database is stored as `subtitle_localizer_worker.db` inside
this folder; it contains worker state only and can be backed up independently.

To create a standalone bundle from the checkout, run:

```text
python scripts/package_worker.py E:\subtitle-localizer-worker
```

Copy the resulting folder to the target machine. Do not copy runtime
databases, outputs, models, caches, or secrets.
