import json

import pytest
from rest_framework.test import APIClient

from apps.actions.models import Action, ActionVersion
from apps.agents.models import Agent
from apps.api_access.models import AccessToken
from apps.core.tokens import digest
from apps.runs.models import Run
from apps.workspaces.models import Domain, Membership, Workspace

pytestmark = pytest.mark.django_db


@pytest.fixture
def mcp_client(settings, django_user_model):
    settings.WORKSPACE_DOMAIN_ROUTING = True
    settings.ALLOWED_HOSTS = ["acme.example.test"]
    user = django_user_model.objects.create_user(username="mcp-owner")
    workspace = Workspace.objects.create(name="MCP workspace")
    Domain.objects.create(hostname="acme.example.test", workspace=workspace)
    Membership.objects.create(user=user, workspace=workspace, role="owner")
    token = AccessToken.objects.create(
        actor=user,
        workspace=workspace,
        name="MCP",
        digest=digest("test-mcp-token"),
        scopes=["read"],
    )
    client = APIClient(HTTP_HOST="acme.example.test")
    client.credentials(HTTP_AUTHORIZATION="Bearer test-mcp-token")
    return client, token


def rpc(client, method, params=None):
    return client.post(
        "/mcp/",
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params if params is not None else {},
        },
        format="json",
    )


def call_tool(client, name, arguments=None):
    return rpc(client, "tools/call", {"name": name, "arguments": arguments or {}})


def test_protocol_handshake_and_errors(mcp_client):
    client, _ = mcp_client
    result = rpc(client, "initialize").data["result"]
    assert result["protocolVersion"] == "2025-03-26"
    assert result["capabilities"] == {"tools": {}}
    assert rpc(client, "notifications/initialized").status_code == 202
    assert rpc(client, "ping").data == {"jsonrpc": "2.0", "id": 1, "result": {}}
    assert rpc(client, "unknown").data["error"]["code"] == -32601
    assert rpc(client, "tools/call", []).data["error"]["code"] == -32602
    assert call_tool(client, "unknown").data["error"]["code"] == -32602
    assert call_tool(client, "create_agent").data["error"]["code"] == -32602
    assert client.post("/mcp/", [], format="json").status_code == 400
    tools = rpc(client, "tools/list").data["result"]["tools"]
    assert {tool["name"] for tool in tools} == {
        "list_projects",
        "get_project_sdk",
        "execute_code",
        "get_run_events",
        "cancel_run",
        "list_actions",
        "get_action",
        "validate_code",
        "promote_run",
        "save_tests",
        "get_tests",
        "run_tests",
        "save_action",
        "run_action",
        "get_run",
        "list_approvals",
        "list_plugins",
        "list_documents",
    }


def test_workspace_and_token_boundaries(mcp_client):
    client, token = mcp_client
    own_agent = Agent.objects.create(workspace=token.workspace, name="Visible")
    other = Workspace.objects.create(name="Private")
    outsider = Agent.objects.create(workspace=other, name="Hidden")
    result = call_tool(client, "list_projects").data["result"]
    assert [row["id"] for row in json.loads(result["content"][0]["text"])["projects"]] == [
        str(own_agent.pk)
    ]
    assert call_tool(client, "create_agent", {"name": "Denied"}).data["error"]["code"] == -32602
    token.scopes = ["read", "write"]
    token.save()
    assert "error" in call_tool(client, "create_agent", {"name": "Created"}).data
    assert not Agent.objects.filter(workspace=token.workspace, name="Created").exists()
    result = call_tool(
        client,
        "save_action",
        {
            "agent": str(outsider.pk),
            "name": "Denied",
            "source": "return 1",
        },
    ).data["result"]
    assert result["isError"] is True
    assert not Action.objects.filter(agent=outsider).exists()
    Membership.objects.filter(user=token.actor, workspace=token.workspace).delete()
    assert rpc(client, "tools/list").status_code == 403


def test_mcp_and_rest_share_run_submission(mcp_client):
    client, token = mcp_client
    token.scopes = ["read", "write"]
    token.save()
    agent = Agent.objects.create(workspace=token.workspace, name="Runner")
    action = Action.objects.create(workspace=token.workspace, agent=agent, name="Action")
    version = ActionVersion.objects.create(action=action, number=1, source="return 1")
    arguments = {
        "agent": str(agent.pk),
        "action": str(action.pk),
        "version": 1,
        "inputs": {},
        "idempotency_key": "shared-request",
    }
    result = call_tool(client, "run_action", arguments).data["result"]
    assert result["isError"] is False
    mcp_run = json.loads(result["content"][0]["text"])
    response = client.post("/api/v1/runs/", {**arguments, "operation": "action"}, format="json")
    assert response.status_code == 201
    assert response.data["id"] == mcp_run["id"]
    run = Run.objects.get(pk=mcp_run["id"])
    assert run.action_version_id == version.pk
    assert run.actor_id == token.actor_id
    assert Run.objects.filter(workspace=token.workspace).count() == 1
    retired = call_tool(
        client,
        "chat",
        {"agent": str(agent.pk), "message": "Hello", "idempotency_key": "chat-request"},
    )
    assert retired.data["error"]["code"] == -32602
    assert not Run.objects.filter(workspace=token.workspace, operation="chat").exists()


def test_mcp_requires_authentication(mcp_client):
    client, _ = mcp_client
    client.credentials()
    assert rpc(client, "tools/list").status_code == 403


def test_document_listing_consumes_document_app_and_scopes_workspace(mcp_client):
    from apps.documents.models import Document

    client, token = mcp_client
    document = Document.objects.create(
        workspace=token.workspace, kind="memory", title="Visible", content="Own"
    )
    other = Workspace.objects.create(name="Private")
    Document.objects.create(workspace=other, kind="memory", title="Hidden")
    result = call_tool(client, "list_documents").data["result"]
    assert result["isError"] is False
    assert json.loads(result["content"][0]["text"]) == [
        {
            "id": str(document.pk),
            "kind": "memory",
            "title": "Visible",
            "content": "Own",
        }
    ]


def test_mcp_approval_listing_reads_pending_run_app_records_in_workspace(mcp_client):
    from apps.runs.models import Approval

    client, token = mcp_client
    agent = Agent.objects.create(workspace=token.workspace, name="Agent")
    run = Run.objects.create(
        workspace=token.workspace, actor=token.actor, agent=agent, idempotency_key="own"
    )
    pending = Approval.objects.create(workspace=token.workspace, run=run, prompt="Continue?")
    Approval.objects.create(
        workspace=token.workspace,
        run=run,
        prompt="Resolved",
        status="denied",
        decided_by=token.actor,
    )
    other = Workspace.objects.create(name="Other")
    outsider = Agent.objects.create(workspace=other, name="Other")
    foreign_run = Run.objects.create(
        workspace=other, actor=token.actor, agent=outsider, idempotency_key="other"
    )
    Approval.objects.create(workspace=other, run=foreign_run, prompt="Hidden")
    result = call_tool(client, "list_approvals").data["result"]
    rows = json.loads(result["content"][0]["text"])
    assert [row["id"] for row in rows] == [str(pending.pk)]
    assert rows[0]["decided_by"] is None
