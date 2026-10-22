#!/usr/bin/env python3
"""Exercise configured MCP code execution without exposing connection credentials."""

import argparse
import hashlib
import json
import os
import sys
import time
import tomllib
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PROTOCOL = "2025-03-26"
TERMINAL = {"succeeded", "failed", "cancelled", "interrupted"}
TOOLS = {
    "list_projects",
    "get_project_sdk",
    "execute_code",
    "get_run",
    "get_run_events",
    "cancel_run",
}


class CheckFailed(Exception):
    pass


class Client:
    def __init__(self, config, timeout):
        self.url = config.get("url")
        if not isinstance(self.url, str) or not self.url.startswith(("http://", "https://")):
            raise CheckFailed("Configured server needs an HTTP MCP URL.")
        self.timeout = timeout
        self.headers = dict(config.get("http_headers", {}))
        for name, variable in config.get("env_http_headers", {}).items():
            if variable not in os.environ:
                raise CheckFailed("A configured header environment variable is missing.")
            self.headers[name] = os.environ[variable]
        variable = config.get("bearer_token_env_var")
        if variable:
            if variable not in os.environ:
                raise CheckFailed("The configured bearer token environment variable is missing.")
            self.headers["Authorization"] = "Bearer " + os.environ[variable]
        self.headers.update(
            {
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "MCP-Protocol-Version": PROTOCOL,
            }
        )

    def rpc(self, method, params=None, *, notification=False):
        payload = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        if not notification:
            payload["id"] = str(uuid.uuid4())
        request = Request(self.url, data=json.dumps(payload).encode(), headers=self.headers)
        try:
            with urlopen(request, timeout=min(self.timeout, 30)) as response:
                if notification:
                    if response.status != 202:
                        raise CheckFailed(
                            "Initialized notification was not accepted with HTTP 202."
                        )
                    return None
                body = response.read(2_000_001)
        except HTTPError as error:
            if error.code in {401, 403}:
                raise CheckFailed(
                    "Access denied: verify explicit catalog:read, code:execute, runs:read, "
                    "runs:cancel scopes and a selected project grant."
                ) from None
            raise CheckFailed(f"MCP HTTP request failed with status {error.code}.") from None
        except URLError, TimeoutError, OSError:
            raise CheckFailed("MCP connection failed or timed out.") from None
        if len(body) > 2_000_000:
            raise CheckFailed("MCP response exceeded the verification size limit.")
        try:
            envelope = json.loads(body)
        except ValueError, UnicodeError:
            raise CheckFailed("MCP did not return a JSON response.") from None
        if "error" in envelope or "result" not in envelope:
            raise CheckFailed("MCP rejected a protocol request; check server compatibility.")
        return envelope["result"]

    def tool(self, name, arguments):
        result = self.rpc("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError"):
            raise CheckFailed(
                f"Tool {name} rejected the request; check explicit scopes, project grants "
                "and runner availability."
            )
        try:
            return json.loads(result["content"][0]["text"])
        except KeyError, IndexError, TypeError, ValueError:
            raise CheckFailed(f"Tool {name} returned an unsupported response shape.") from None

    def connect(self):
        result = self.rpc(
            "initialize",
            {
                "protocolVersion": PROTOCOL,
                "capabilities": {},
                "clientInfo": {"name": "orgsdk-local-check", "version": "1"},
            },
        )
        if result.get("protocolVersion") != PROTOCOL:
            raise CheckFailed("Server negotiated an unsupported protocol version.")
        self.rpc("notifications/initialized", notification=True)
        discovered = self.rpc("tools/list")
        if not {tool["name"] for tool in discovered["tools"]} >= TOOLS:
            raise CheckFailed("Server is missing required code execution tools or permissions.")

    def wait(self, run_id):
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            run = self.tool("get_run", {"id": run_id})
            if run["status"] in TERMINAL:
                return run
            time.sleep(0.5)
        raise CheckFailed("Run did not reach a terminal state within the polling timeout.")


def rows(value):
    if isinstance(value, list):
        return value
    for key in ["results", "projects", "events", "items"]:
        if isinstance(value.get(key), list):
            return value[key]
    raise CheckFailed("Tool returned an unsupported collection shape.")


def require(condition, message):
    if not condition:
        raise CheckFailed(message)


def check(args):
    path = Path(__file__).resolve().parents[1] / ".codex" / "config.toml"
    try:
        with path.open("rb") as stream:
            config = tomllib.load(stream)["mcp_servers"][args.server]
    except OSError, ValueError, KeyError:
        raise CheckFailed(
            "Cannot load the selected server from project .codex/config.toml."
        ) from None
    client = Client(config, args.timeout)
    client.connect()
    projects = rows(client.tool("list_projects", {}))
    project = args.project or next((str(p["id"]) for p in projects if p.get("enabled", True)), None)
    require(
        project is not None, "No permitted enabled project; configure an explicit project grant."
    )
    client.tool("get_project_sdk", {"project": project})
    prefix = "local-mcp-check:" + str(uuid.uuid4())
    source = (
        "const p = defineParams(z.object({a: z.number(), b: z.number()})); "
        'console.log("sum42"); return p.a + p.b;'
    )
    submission = {
        "project": project,
        "source": source,
        "inputs": {"a": 20, "b": 22},
        "idempotency_key": prefix,
    }
    accepted = client.tool("execute_code", submission)
    duplicate = client.tool("execute_code", submission)
    require(accepted["id"] == duplicate["id"], "Duplicate submission created a different run.")
    run = client.wait(accepted["id"])
    require(
        run["status"] == "succeeded"
        and isinstance(run.get("output"), dict)
        and run["output"].get("result") == 42,
        "Sum run did not succeed with output 42.",
    )
    require(run.get("source") == source, "Accepted source was not preserved.")
    require(
        run.get("source_digest") == hashlib.sha256(source.encode()).hexdigest(),
        "Accepted source digest did not match.",
    )
    events = client.tool("get_run_events", {"id": run["id"], "after": 0, "limit": 100})
    require("sum42" in json.dumps(rows(events)), "Successful run did not retain its log event.")
    reconnected = Client(config, args.timeout)
    reconnected.connect()
    retained = reconnected.tool("get_run", {"id": run["id"]})
    require(
        retained["id"] == run["id"] and retained.get("output") == run["output"],
        "Reconnect lost the accepted result.",
    )
    failed = client.tool(
        "execute_code",
        {
            **submission,
            "source": 'console.log("before-failure"); throw new Error("expected-check-failure");',
            "idempotency_key": prefix + ":failure",
        },
    )
    failed = client.wait(failed["id"])
    require(failed["status"] == "failed", "Throwing snippet did not fail.")
    events = client.tool("get_run_events", {"id": failed["id"], "after": 0, "limit": 100})
    require("before-failure" in json.dumps(rows(events)), "Failure lost its earlier log event.")
    pending = client.tool(
        "execute_code",
        {
            **submission,
            "source": 'console.log("pending"); await new Promise(() => {});',
            "idempotency_key": prefix + ":cancel",
        },
    )
    client.tool("cancel_run", {"id": pending["id"]})
    cancelled = client.wait(pending["id"])
    require(
        cancelled["status"] == "cancelled", "Explicit cancellation did not finish as cancelled."
    )
    print(
        json.dumps(
            {
                "ok": True,
                "sum": 42,
                "deduplicated": True,
                "reconnected": True,
                "failure_log_retained": True,
                "cancelled": True,
            }
        )
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default="orgsdk_local")
    parser.add_argument("--project")
    parser.add_argument("--timeout", type=int, default=60, choices=range(5, 301), metavar="5..300")
    args = parser.parse_args()
    try:
        check(args)
    except (CheckFailed, KeyError, TypeError, ValueError) as error:
        message = (
            str(error) if isinstance(error, CheckFailed) else "Unexpected server response shape."
        )
        print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
