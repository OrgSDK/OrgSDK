"""Check supervised processes and the API's SQLite readiness."""

import json
import os
import urllib.request
from pathlib import Path

state = json.loads(Path("/tmp/orgsdk-health.json").read_text())
for pid in state["pids"]:
    os.kill(pid, 0)
with urllib.request.urlopen("http://127.0.0.1:8080/api/health/", timeout=3) as response:
    if response.status != 200:
        raise SystemExit(1)
