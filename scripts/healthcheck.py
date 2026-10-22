"""Check supervised children, HTTP readiness and PostgreSQL connectivity."""

import json
import os
import urllib.request
from pathlib import Path

import psycopg

state = json.loads(Path("/tmp/orgsdk-health.json").read_text())
for pid in state["pids"]:
    os.kill(pid, 0)
role = state["role"]
if role in {"server", "gateway", "api"}:
    port = 8000 if role == "api" else 8080
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health/", timeout=3) as response:
        if response.status != 200:
            raise SystemExit(1)
if state["database_url"]:
    with psycopg.connect(state["database_url"], connect_timeout=3) as connection:
        connection.execute("SELECT 1")
