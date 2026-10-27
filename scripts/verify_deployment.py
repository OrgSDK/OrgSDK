#!/usr/bin/env python3
"""Exercise a fresh installation only in the isolated orgsdk-platform-test project."""

import json
import os
import re
import secrets
import subprocess
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = [
    "docker",
    "compose",
    "--env-file",
    os.environ.get("ORGSDK_ENV_FILE", ".env.deployment"),
    "-f",
    os.environ.get("ORGSDK_COMPOSE_FILE", "compose.yaml"),
]
PASSWORD = "Isolated-SQLite-journey-42!"


def compose(*args):
    return subprocess.check_output([*COMPOSE, *args], cwd=ROOT, stderr=subprocess.STDOUT)


def wait_for(callback, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = callback()
        if result:
            return result
        time.sleep(0.5)
    raise AssertionError("Deployment verification timed out")


def main():
    config = json.loads(compose("config", "--format", "json"))
    if config["name"] != "orgsdk-platform-test":
        raise SystemExit("Only the isolated orgsdk-platform-test project is allowed.")
    assert "postgres" not in config["services"]
    port = config["services"]["app"]["ports"][0]["published"]
    base = f"http://localhost:{port}"
    browser = httpx.Client(base_url=base, timeout=20)

    def request(path, body=None, method=None):
        response = browser.request(
            method or ("POST" if body is not None else "GET"),
            path,
            json=body,
            headers={"X-CSRFToken": browser.cookies.get("csrftoken", "")},
        )
        assert response.status_code < 400, f"{path}: HTTP {response.status_code}"
        return response.json() if response.content else None

    setup = request("/api/v1/setup/")
    if setup["setup_required"]:
        request(
            "/api/v1/setup/",
            {
                "domain": "localhost",
                "workspace_name": "SQLite verification",
                "username": "sqlite-check",
                "email": "sqlite-check@example.test",
                "password1": PASSWORD,
                "password2": PASSWORD,
            },
        )
    request(
        "/api/auth/browser/v1/auth/login",
        {"email": "sqlite-check@example.test", "password": PASSWORD},
    )
    project = request("/api/v1/projects/")["results"][0]
    assert httpx.get(base + "/api/v1/projects/").status_code in {401, 403}
    assert httpx.post(base + "/internal/execution/v1/bootstrap/").status_code == 404
    assert request("/api/v1/setup/")["setup_required"] is False
    issued = request(
        "/api/v1/tokens/",
        {
            "name": "SQLite verification",
            "projects": [project["id"]],
            "scopes": ["catalog:read", "code:execute", "runs:read", "runs:cancel"],
        },
    )
    machine = httpx.Client(
        base_url=base, timeout=20, headers={"Authorization": "Bearer " + issued["token"]}
    )
    try:
        catalog = machine.post(
            "/mcp/", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
        )
        assert catalog.status_code == 200
        assert "execute_code" in {tool["name"] for tool in catalog.json()["result"]["tools"]}
        marker = "sqlite-check-" + secrets.token_hex(6)
        filename = marker + ".txt"

        def queue(source):
            response = machine.post(
                "/api/v1/runs/",
                json={
                    "project": project["id"],
                    "operation": "code",
                    "source": source,
                    "inputs": {},
                    "idempotency_key": secrets.token_hex(16),
                },
            )
            assert response.status_code == 201, f"Code submission: HTTP {response.status_code}"
            return response.json()

        def wait(run, expected="succeeded"):
            def finished():
                response = machine.get(f"/api/v1/runs/{run['id']}/")
                assert response.status_code == 200
                state = response.json()
                if state["status"] in {"succeeded", "failed", "cancelled", "interrupted"}:
                    assert state["status"] == expected, state.get("error")
                    return state
                return None

            return wait_for(finished)

        write = queue(
            f"await writeFile({json.dumps(filename)}, '42'); "
            "await saveArtifact('answer.txt', '42'); console.log('SQLite verification'); return 42;"
        )
        assert wait(write)["output"] == {"result": 42}
        assert machine.get(f"/api/v1/runs/{write['id']}/events/").status_code == 200
        assert any(item["content"] == "42" for item in request("/api/v1/artifacts/")["results"])
        compose("restart", "app")

        def ready():
            try:
                return httpx.get(base + "/api/health/", timeout=3).status_code == 200
            except httpx.HTTPError:
                return False

        wait_for(ready)
        read = queue(
            f"const value = await readFile({json.dumps(filename)}); "
            f"await removeFile({json.dumps(filename)}); return Number(value);"
        )
        assert wait(read)["output"] == {"result": 42}
        assert machine.get(f"/api/v1/runs/{write['id']}/").json()["status"] == "succeeded"
        approval_run = queue("return await requestApproval('Continue SQLite verification?');")

        def pending():
            return next(
                (
                    item
                    for item in request("/api/v1/approvals/")["results"]
                    if item["run"] == approval_run["id"] and item["status"] == "pending"
                ),
                None,
            )

        approval = wait_for(pending)
        request(f"/api/v1/approvals/{approval['id']}/decide/", {"decision": "approved"})
        assert wait(approval_run)["output"] == {"result": True}
        cancel = queue("await requestApproval('Cancel SQLite verification'); return 'unexpected';")
        wait_for(
            lambda: (
                machine.get(f"/api/v1/runs/{cancel['id']}/").json()["status"] == "waiting_approval"
            )
        )
        assert machine.post(f"/api/v1/runs/{cancel['id']}/cancel/", json={}).status_code == 200
        wait(cancel, "cancelled")
        request(
            "/api/v1/workspaces/invitations/", {"email": marker + "@example.test", "role": "member"}
        )

        def delivered():
            page = browser.get("/admin/core/backgroundjob/").text
            return any(
                "send_invitation" in row and "succeeded" in row.lower()
                for row in re.findall(r"<tr[^>]*>.*?</tr>", page, flags=re.DOTALL)
            )

        wait_for(delivered)
        print(
            "Verified fresh setup, login, REST/MCP scopes, Docker execution, artifacts, "
            "approvals, cancellation, durable mail delivery and restart persistence."
        )
    finally:
        request(f"/api/v1/tokens/{issued['id']}/", method="DELETE")
        machine.close()
        browser.close()


if __name__ == "__main__":
    main()
