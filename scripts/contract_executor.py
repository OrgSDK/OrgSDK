#!/usr/bin/env python3
"""One-shot protocol fixture. Use only in the isolated verification project."""

import json
import os
import urllib.error
import urllib.request


def call(base, token, path, body=None):
    request = urllib.request.Request(
        base.rstrip("/") + "/internal/execution/v1/" + path,
        data=json.dumps(body or {}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        payload = response.read()
        return json.loads(payload) if payload else None


def main():
    base = os.environ["DJANGO_URL"]
    token = os.environ["EXECUTOR_TOKEN"]
    if os.environ.get("ORGSDK_VERIFICATION_PROJECT") != "orgsdk-platform-test":
        raise SystemExit("Reference executor requires the isolated verification project.")
    call(base, token, "register/", {"protocol_version": 1, "capabilities": ["action"]})
    job = call(base, token, "claim/")
    if job is None:
        raise SystemExit("No fixture job available.")
    token = job["capability"]
    prefix = f"runs/{job['run_id']}/"
    call(base, token, prefix + "heartbeat/")
    call(
        base,
        token,
        prefix + "events/",
        {
            "sequence": 1,
            "kind": "contract.fixture",
            "data": {"implementation": "python-stdlib"},
        },
    )
    call(
        base,
        token,
        prefix + "complete/",
        {
            "status": "succeeded",
            "output": {"echo": job["inputs"], "implementation": "python-stdlib"},
        },
    )
    print("Independent executor completed the versioned protocol.")


if __name__ == "__main__":
    main()
