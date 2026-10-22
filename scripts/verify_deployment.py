#!/usr/bin/env python3
"""Destructive fixture creation ONLY in the isolated orgsdk-platform-test Compose project."""

import json
import os
import secrets
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = [
    "docker",
    "compose",
    "--env-file",
    os.environ.get("ORGSDK_ENV_FILE", ".env.deployment"),
    "-f",
    os.environ.get("ORGSDK_COMPOSE_FILE", "compose.yaml"),
]


def command(*args, source=None, env=None):
    return subprocess.check_output(
        [*COMPOSE, *args],
        cwd=ROOT,
        input=source.encode() if source else None,
        env=os.environ | (env or {}),
        stderr=subprocess.STDOUT,
    ).decode()


def main():
    config = json.loads(command("config", "--format", "json"))
    if config["name"] != "orgsdk-platform-test":
        raise SystemExit("Only the isolated orgsdk-platform-test project is allowed.")
    port = config["services"]["app"]["ports"][0]["published"]
    token = secrets.token_urlsafe(32)
    seed = """
import os
from django.contrib.auth import get_user_model
from django.core.management import call_command
from allauth.account.models import EmailAddress
from apps.api_access.models import AccessToken
from apps.workspaces.models import Domain, Membership
from apps.core.tokens import digest
domain = Domain.objects.filter(hostname='localhost').first()
if domain is None:
    call_command('provision_workspace', domain='localhost',
        name='Verification', owner='product-check@example.test')
    domain = Domain.objects.get(hostname='localhost')
u, _ = get_user_model().objects.get_or_create(email='product-check@example.test',
    defaults={'username':'product-check'})
u.set_password('Local-journey-42!')
u.is_staff=True; u.save()
EmailAddress.objects.update_or_create(user=u, email=u.email,
    defaults={'verified':True, 'primary':True})
w=domain.workspace
Membership.objects.get_or_create(workspace=w,user=u,defaults={'role':'admin'})
AccessToken.objects.create(workspace=w,actor=u,name='deployment fixture',
    digest=digest(os.environ['ORGSDK_TEST_TOKEN']),scopes=['read','write','approve'])

"""
    command(
        "exec",
        "-T",
        "-e",
        "ORGSDK_TEST_TOKEN",
        "app",
        "python",
        "manage.py",
        "shell",
        source=seed,
        env={"ORGSDK_TEST_TOKEN": token},
    )
    base = f"http://localhost:{port}"

    def api(path, data=None, method=None):
        request = urllib.request.Request(
            base + "/api/v1/" + path,
            data=json.dumps(data).encode() if data is not None else None,
            method=method,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)

    suffix = "x" + secrets.token_hex(4)
    agents = api("agents/")["results"]
    agent = agents[0] if agents else api("agents/", {"name": "Container verification"})
    api(
        "plugins/",
        {
            "agent": agent["id"],
            "slug": f"fixture-{suffix}",
            "version": "1.0.0",
            "source": "export const safeFunctions = [{name:'double', calling:'positional', "
            "handler:(n:number)=>n*2}];",
        },
    )

    if len(agents) > 1:
        other = api(f"agents/{agents[1]['id']}/")
        assert not any(
            entry["slug"] == f"fixture-{suffix}" and entry["agent"] == other["id"]
            for entry in api("plugins/")["results"]
        )

    def queue(source):
        action = api("actions/", {"name": "Deployment fixture", "agent": agent["id"]})
        api(
            f"actions/{action['id']}/versions/",
            {"source": source, "input_schema": {"type": "object"}},
        )
        return api(
            "runs/",
            {
                "agent": agent["id"],
                "action": action["id"],
                "operation": "action",
                "inputs": {"a": 21},
                "idempotency_key": secrets.token_hex(16),
            },
        )

    def wait(run, expected="succeeded", approve=False):
        end = time.monotonic() + 100
        while time.monotonic() < end:
            state = api(f"runs/{run['id']}/")
            if approve:
                for approval in api("approvals/")["results"]:
                    if approval["run"] == run["id"] and approval["status"] == "pending":
                        api(f"approvals/{approval['id']}/decide/", {"decision": "approved"})
            if state["status"] in {"succeeded", "failed", "cancelled", "interrupted"}:
                assert state["status"] == expected, state
                return state
            time.sleep(1)
        raise AssertionError(f"Run did not finish: {run['id']}")

    command("--profile", "runner", "up", "-d", "executor")
    # Runtime namespace uses camelCase for a hyphenated plugin slug.
    namespace = "fixture" + suffix[0].upper() + suffix[1:]
    run = queue(
        f"const value = await {namespace}.double(actionParams.a); "
        "await saveArtifact('answer.txt', String(value)); "
        "await saveMemory('Verified', String(value)); return value;"
    )
    assert wait(run)["output"]["result"] == 42
    assert any(
        item["run"] == run["id"] and item["content"] == "42"
        for item in api("artifacts/")["results"]
    )
    assert (
        wait(
            queue("await requestApproval('Continue the test?'); return 'approved';"), approve=True
        )["output"]["result"]
        == "approved"
    )
    run = queue("await requestApproval('Cancel this test'); return 'unexpected';")
    for _ in range(30):
        if api(f"runs/{run['id']}/")["status"] == "waiting_approval":
            break
        time.sleep(1)
    api(f"runs/{run['id']}/cancel/", {})
    wait(run, "cancelled")
    print(
        "Verified HTTP -> Django/PostgreSQL -> disposable container: "
        "plugin, artifact, memory, approval, cancellation."
    )

    registration = api(f"agents/{agent['id']}/executor/", {})
    contract_token = registration["token"]
    try:
        run = queue("return actionParams;")
        fixture = (ROOT / "scripts/contract_executor.py").read_text()
        command(
            "exec",
            "-T",
            "-e",
            "EXECUTOR_TOKEN",
            "-e",
            "DJANGO_URL=http://app:8080",
            "-e",
            "ORGSDK_VERIFICATION_PROJECT=orgsdk-platform-test",
            "app",
            "python",
            "-",
            source=fixture,
            env={"EXECUTOR_TOKEN": contract_token},
        )
        assert wait(run)["output"]["implementation"] == "python-stdlib"
    finally:
        api(f"agents/{agent['id']}/executor/", {"locally_managed": True})
    print("Verified independent Python executor; local runner restored.")


if __name__ == "__main__":
    main()
