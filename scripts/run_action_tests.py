#!/usr/bin/env python3
"""Run an explicit saved suite through the configured MCP connection, without an LLM."""

import argparse
import json
import sys
import tomllib
import uuid
from pathlib import Path

from check_local_mcp import PROTOCOL, CheckFailed, Client, require


def run(args):
    path = Path(__file__).resolve().parents[1] / ".codex" / "config.toml"
    try:
        with path.open("rb") as stream:
            config = tomllib.load(stream)["mcp_servers"][args.server]
    except OSError, ValueError, KeyError:
        raise CheckFailed("Cannot load the selected project MCP connection.") from None
    client = Client(config, args.timeout)
    initialized = client.rpc(
        "initialize",
        {
            "protocolVersion": PROTOCOL,
            "capabilities": {},
            "clientInfo": {"name": "orgsdk-action-tests", "version": "1"},
        },
    )
    require(initialized.get("protocolVersion") == PROTOCOL, "Unsupported MCP protocol version.")
    client.rpc("notifications/initialized", notification=True)
    available = {tool["name"] for tool in client.rpc("tools/list")["tools"]}
    require(
        {"run_tests", "get_run"} <= available,
        "Connection requires actions:test, runs:read and a selected action/project grant.",
    )
    accepted = client.tool(
        "run_tests",
        {
            "action": str(args.action),
            "version": args.version,
            "suite_revision": args.suite_revision,
            "idempotency_key": "ci-tests:" + str(uuid.uuid4()),
        },
    )
    record = client.wait(accepted["id"])
    report = record.get("output", {}).get("result", {})
    passed = record["status"] == "succeeded" and report.get("passed") is True
    cases = report.get("cases", [])
    print(
        json.dumps(
            {
                "id": record["id"],
                "status": record["status"],
                "passed": passed,
                "cases": len(cases),
                "failed_cases": sum(case.get("passed") is not True for case in cases),
            }
        )
    )
    return 0 if passed else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default="orgsdk_local")
    parser.add_argument("--action", required=True, type=uuid.UUID)
    parser.add_argument("--version", required=True, type=int)
    parser.add_argument("--suite-revision", required=True, type=int)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    if args.version < 1 or args.suite_revision < 1 or not 5 <= args.timeout <= 300:
        parser.error("Versions must be positive; timeout must be between 5 and 300 seconds.")
    try:
        return run(args)
    except CheckFailed as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
