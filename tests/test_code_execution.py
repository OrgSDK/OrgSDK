import hashlib
import json

import pytest
from rest_framework.test import APIClient

from apps.actions.models import Action, Plugin
from apps.agents.models import Agent
from apps.api_access.models import AccessToken
from apps.core.tokens import digest
from apps.execution.models import Executor
from apps.runs.models import Run
from apps.workspaces.models import Domain, Membership, Workspace

pytestmark = pytest.mark.django_db


@pytest.fixture
def context(settings, user):
    settings.WORKSPACE_DOMAIN_ROUTING = True
    settings.ALLOWED_HOSTS = ["code.example.test"]
    workspace = Workspace.objects.create(name="Code")
    Domain.objects.create(hostname="code.example.test", workspace=workspace)
    Membership.objects.create(user=user, workspace=workspace, role="owner")
    project = Agent.objects.create(workspace=workspace, name="Code", model="secret-model")
    other = Agent.objects.create(workspace=workspace, name="Other")
    token = AccessToken.objects.create(
        workspace=workspace,
        actor=user,
        name="Harness",
        digest=digest("code-token"),
        scopes=["catalog:read", "code:execute", "runs:read", "runs:cancel"],
    )
    token.projects.add(project)
    client = APIClient(HTTP_HOST="code.example.test")
    client.credentials(HTTP_AUTHORIZATION="Bearer code-token")
    return client, token, project, other


def rpc(client, method, params=None, **headers):
    return client.post(
        "/mcp/",
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
        format="json",
        **headers,
    )


def tool(client, name, **args):
    response = rpc(client, "tools/call", {"name": name, "arguments": args})
    assert response.status_code == 200
    result = response.data["result"]
    return result, json.loads(result["content"][0]["text"]) if not result["isError"] else None


def payload(project, **changes):
    return {
        "agent": str(project.pk),
        "operation": "code",
        "source": "return 42;",
        "inputs": {},
        "idempotency_key": "one",
        **changes,
    }


def test_source_snapshot_replay_and_private_inspection(context):
    client, token, project, other = context
    response = client.post("/api/v1/runs/", payload(project), format="json")
    assert response.status_code == 201, response.data
    run = Run.objects.get(pk=response.data["id"])
    assert not Action.objects.exists()
    assert run.snapshot["source"] == "return 42;"
    assert run.snapshot["source_digest"] == hashlib.sha256(b"return 42;").hexdigest()
    assert run.client_token == token
    assert len(run.snapshot["agents"]) == 1
    selected = run.snapshot["agents"][0]
    assert selected["id"] == str(project.pk)
    assert (selected["model"], selected["instructions"], selected["credential_id"]) == (
        "",
        "",
        None,
    )
    assert client.post("/api/v1/runs/", payload(project), format="json").data["id"] == str(run.pk)
    for change in [
        {"source": "return 43;"},
        {"inputs": {"v": 2}},
        {"version": 1},
        {"conversation": str(other.pk)},
    ]:
        assert (
            client.post("/api/v1/runs/", payload(project, **change), format="json").status_code
            == 400
        )
    assert client.get(f"/api/v1/runs/{run.pk}/").data["source"] == "return 42;"
    denied = client.post("/api/v1/runs/", payload(other), format="json")
    assert denied.status_code == 403
    result, inspected = tool(client, "get_run", id=str(run.pk))
    assert not result["isError"] and inspected["source"] == "return 42;"


def test_code_retry_preserves_snapshot_and_requires_current_authority(context):
    client, token, project, _ = context
    run_id = client.post("/api/v1/runs/", payload(project), format="json").data["id"]
    original = Run.objects.get(pk=run_id)
    original.status = "failed"
    original.save()
    project.instructions = "Changed"
    project.save()
    retry = client.post(
        f"/api/v1/runs/{run_id}/retry/", {"idempotency_key": "retry"}, format="json"
    )
    assert retry.status_code == 201, retry.data
    assert Run.objects.get(pk=retry.data["id"]).snapshot == original.snapshot
    token.projects.clear()
    assert (
        client.post(
            f"/api/v1/runs/{run_id}/retry/", {"idempotency_key": "no"}, format="json"
        ).status_code
        == 404
    )


def test_mcp_code_events_cancel_and_tool_visibility(context):
    client, token, project, _ = context
    names = {item["name"] for item in rpc(client, "tools/list").data["result"]["tools"]}
    assert {"execute_code", "get_project_sdk", "get_run_events", "cancel_run"} <= names
    assert "save_action" not in names and "chat" not in names
    result, accepted = tool(
        client, "execute_code", project=str(project.pk), source="return 42;", idempotency_key="mcp"
    )
    assert not result["isError"] and accepted["status"] == "queued"
    run = Run.objects.get(pk=accepted["id"])
    for sequence in range(1, 4):
        run.events.create(sequence=sequence, kind="execution.log", data={"message": str(sequence)})
    _, events = tool(client, "get_run_events", id=str(run.pk), after=1, limit=1)
    assert [event["sequence"] for event in events["events"]] == [2]
    assert events["next_cursor"] == 2
    _, cancelled = tool(client, "cancel_run", id=str(run.pk))
    assert cancelled["status"] == "cancelled" and cancelled["cancel_requested"]
    token.scopes = ["read", "write"]
    token.save()
    assert tool(
        client, "execute_code", project=str(project.pk), source="return 1", idempotency_key="legacy"
    )[0]["isError"]
    assert (
        client.post(
            "/api/v1/runs/", payload(project, idempotency_key="legacy-rest"), format="json"
        ).status_code
        == 403
    )


def test_utf8_limits_and_sdk_redaction(context):
    client, token, project, other = context
    for changes in [{"source": " "}, {"source": "é" * 100001}, {"inputs": {"v": "é" * 100001}}]:
        assert (
            client.post("/api/v1/runs/", payload(project, **changes), format="json").status_code
            == 400
        )
    Plugin.objects.create(
        workspace=project.workspace,
        agent=project,
        slug="safe-tools",
        version="1",
        distribution="external",
        source="PRIVATE_PROVIDER_CODE",
        digest="a" * 64,
        configuration={"secret": "PRIVATE_CONFIG"},
        release_metadata={
            "tools": [{"name": "double", "parameters": [{"name": "value", "type": "number"}]}]
        },
    )
    Plugin.objects.create(
        workspace=project.workspace,
        agent=project,
        slug="unknown",
        version="1",
        source="PRIVATE_INLINE",
        digest="b" * 64,
    )
    _, sdk = tool(client, "get_project_sdk", project=str(project.pk))
    serialized = json.dumps(sdk)
    assert "PRIVATE" not in serialized and "secret-model" not in serialized
    assert sdk["plugins"][0]["namespace"] == "safeTools"
    assert sdk["plugins"][1]["metadata_complete"] is False
    _, filtered = tool(client, "get_project_sdk", project=str(project.pk), namespace="safeTools")
    assert len(filtered["plugins"]) == 1
    assert tool(client, "get_project_sdk", project=str(other.pk))[0]["isError"]


def test_old_executor_cannot_claim_code(context):
    client, token, project, _ = context
    run_id = client.post("/api/v1/runs/", payload(project), format="json").data["id"]
    executor = Executor.objects.create(
        agent=project,
        name="Runner",
        token_hash=digest("executor"),
        capabilities=["code"],
        protocol_version=1,
    )
    runner = APIClient(HTTP_HOST="code.example.test")
    runner.credentials(HTTP_AUTHORIZATION="Bearer executor")
    assert runner.post("/internal/execution/v1/claim/").status_code == 204
    register = "/internal/execution/v1/register/"
    assert (
        runner.post(
            register, {"protocol_version": 1, "capabilities": ["code"]}, format="json"
        ).status_code
        == 400
    )
    response = runner.post(
        register, {"protocol_version": 2, "capabilities": ["code"]}, format="json"
    )
    assert response.status_code == 200, response.data
    executor.refresh_from_db()
    assert executor.protocol_version == 2
    claim = runner.post("/internal/execution/v1/claim/")
    assert claim.status_code == 200 and claim.data["run_id"] == run_id
    assert claim.data["protocol_version"] == 2


def test_transport_origins_versions_and_notifications(context):
    client, _, _, _ = context
    assert rpc(client, "ping", HTTP_ORIGIN="https://evil.example").status_code == 403
    assert rpc(client, "ping", HTTP_ORIGIN="http://code.example.test").status_code == 200
    assert rpc(client, "ping", HTTP_MCP_PROTOCOL_VERSION="2099-01-01").status_code == 400
    assert (
        rpc(client, "initialize", {"protocolVersion": "2099-01-01"}).data["result"][
            "protocolVersion"
        ]
        == "2025-03-26"
    )
    assert (
        client.post(
            "/mcp/", {"jsonrpc": "2.0", "method": "notifications/initialized"}, format="json"
        ).status_code
        == 202
    )
    assert client.get("/mcp/").status_code == 405
    assert client.delete("/mcp/").status_code == 405
    assert (
        client.post(
            "/mcp/", {"jsonrpc": "2.0", "id": True, "method": "ping"}, format="json"
        ).status_code
        == 400
    )


def test_malformed_requests_and_invalid_namespaces_are_bounded(context):
    client, token, project, _ = context
    for body in [[], "wrong", 42]:
        assert client.post("/api/v1/runs/", body, format="json").status_code == 400
    for changes in [
        {"source": "\ud800"},
        {"inputs": {"value": "\ud800"}},
        {"source": "return '\x00';"},
        {"inputs": {"nested": ["\x00"]}},
        {"inputs": {"\x00": "value"}},
    ]:
        assert (
            client.post(
                "/api/v1/runs/",
                json.dumps(payload(project, **changes)),
                content_type="application/json",
            ).status_code
            == 400
        )
    for slug in ["bad_name", "console", "--", "foo-bar", "foo--bar"]:
        Plugin.objects.create(
            workspace=project.workspace,
            agent=project,
            slug=slug,
            version="1",
            source="",
            digest="c" * 64,
        )
    _, sdk = tool(client, "get_project_sdk", project=str(project.pk))
    assert all(
        plugin["available"] is False and plugin["namespace"] is None for plugin in sdk["plugins"]
    )
    _, listing = tool(client, "list_projects")
    assert listing["next_offset"] is None
    assert rpc(client, "ping", HTTP_ORIGIN="http://[").status_code == 403


def test_sdk_incomplete_tool_metadata_remains_explicit(context):
    client, _, project, _ = context
    Plugin.objects.create(
        workspace=project.workspace,
        agent=project,
        slug="incomplete",
        version="1",
        distribution="external",
        source="",
        digest="d" * 64,
        release_metadata={"tools": [{}, {"name": "knownTool", "description": "Known name"}]},
    )
    _, sdk = tool(client, "get_project_sdk", project=str(project.pk))
    plugin = sdk["plugins"][0]
    assert plugin["metadata_complete"] is False
    assert plugin["tools"] == [
        {"name": "knownTool", "description": "Known name", "calling": "named"}
    ]


def test_sdk_revisions_capture_resource_configuration(context):
    from apps.tables.models import WorkspaceTable

    client, _, project, _ = context
    _, before = tool(client, "get_project_sdk", project=str(project.pk))
    table = WorkspaceTable.objects.create(
        workspace=project.workspace,
        name="Records",
        columns=[{"key": "name", "type": "text", "required": True}],
    )
    project.writable_tables.add(table)
    _, sdk = tool(client, "get_project_sdk", project=str(project.pk))
    assert sdk["sdk_revision"] == 3
    assert sdk["configuration_revision"] != before["configuration_revision"]
    assert sdk["resources"]["tables"] == {"read": [], "write": [str(table.pk)]}
    assert any(signature.startswith("readFile(") for signature in sdk["builtins"])
    assert not any(signature.startswith("saveMemory(") for signature in sdk["builtins"])
    accepted = client.post("/api/v1/runs/", payload(project), format="json")
    assert accepted.status_code == 201, accepted.data
    run = Run.objects.get(pk=accepted.data["id"])
    assert accepted.data["sdk_revision"] == 3
    assert accepted.data["configuration_revision"] == sdk["configuration_revision"]
    project.writable_tables.clear()
    _, changed = tool(client, "get_project_sdk", project=str(project.pk))
    assert changed["configuration_revision"] == before["configuration_revision"]
    run.refresh_from_db()
    assert run.snapshot["configuration_revision"] == sdk["configuration_revision"]
    assert run.snapshot["agents"][0]["resources"]["tables"]["write"] == [str(table.pk)]


@pytest.mark.parametrize("slug", ["read-file", "list-tables", "write-document"])
def test_context_builtins_cannot_be_shadowed_in_discovery(context, slug):
    client, _, project, _ = context
    Plugin.objects.create(
        workspace=project.workspace,
        agent=project,
        slug=slug,
        version="1",
        source="",
        digest="e" * 64,
    )
    _, sdk = tool(client, "get_project_sdk", project=str(project.pk))
    assert sdk["plugins"][0]["available"] is False
