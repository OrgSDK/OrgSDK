import json

import pytest
from rest_framework.test import APIClient

from apps.actions.models import Action, ActionVersion
from apps.agents.models import Agent
from apps.api_access.models import AccessToken
from apps.api_access.policy import require_scope
from apps.api_access.serializers import TokenSerializer
from apps.core.tokens import digest
from apps.runs.models import Run
from apps.workspaces.models import Domain, Membership, Workspace

pytestmark = pytest.mark.django_db


@pytest.fixture
def clients(settings, user):
    settings.WORKSPACE_DOMAIN_ROUTING = True
    settings.ALLOWED_HOSTS = ["scoped.example.test"]
    workspace = Workspace.objects.create(name="Scoped")
    Domain.objects.create(hostname="scoped.example.test", workspace=workspace)
    Membership.objects.create(user=user, workspace=workspace, role="owner")
    project = Agent.objects.create(workspace=workspace, name="Allowed")
    other = Agent.objects.create(workspace=workspace, name="Denied")
    action = Action.objects.create(workspace=workspace, agent=project, name="Saved")
    versions = [
        ActionVersion.objects.create(action=action, number=n, source=f"return {n}") for n in [1, 2]
    ]
    tokens = []
    clients = []
    for index in range(2):
        token = AccessToken.objects.create(
            workspace=workspace,
            actor=user,
            name=str(index),
            digest=digest(str(index)),
            scopes=["catalog:read", "actions:run", "runs:read", "runs:cancel", "actions:write"],
        )
        token.action_versions.add(versions[0])
        client = APIClient(HTTP_HOST="scoped.example.test")
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {index}")
        tokens.append(token)
        clients.append(client)
    return clients, tokens, project, other, action, versions


def tool(client, name, arguments):
    response = client.post(
        "/mcp/",
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        },
        format="json",
    )
    assert response.status_code == 200
    return response.data["result"]


def payload(project, action, **overrides):
    return {
        "agent": str(project.pk),
        "action": str(action.pk),
        "operation": "action",
        "version": 1,
        "inputs": {},
        "idempotency_key": "same",
        **overrides,
    }


def test_exact_version_resources_and_denied_endpoints(clients):
    (client, _), tokens, project, other, action, versions = clients
    assert client.get("/api/v1/agents/").data["count"] == 1
    assert client.get(f"/api/v1/agents/{other.pk}/").status_code == 404
    listed = client.get(f"/api/v1/actions/{action.pk}/versions/").data
    assert [row["id"] for row in listed] == [str(versions[0].pk)]
    assert (
        client.post(
            "/api/v1/actions/", {"agent": str(project.pk), "name": "Denied"}, format="json"
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/v1/actions/{action.pk}/versions/", {"source": "return 4"}, format="json"
        ).status_code
        == 404
    )
    for endpoint in [
        "credentials",
        "tokens",
        "plugins",
        "conversations",
        "approvals",
        "schedules",
        "webhooks",
        "documents",
        "tables",
    ]:
        assert client.get(f"/api/v1/{endpoint}/").status_code == 403
    denied = payload(project, action, version=2)
    assert client.post("/api/v1/runs/", denied, format="json").status_code == 403
    denied.pop("version")
    assert client.post("/api/v1/runs/", denied, format="json").status_code == 403
    tokens[0].action_versions.clear()
    assert client.get("/api/v1/actions/").data["count"] == 0


def test_client_namespace_and_run_ownership(clients):
    (first, second), tokens, project, _, action, _ = clients
    data = payload(project, action)
    one = first.post("/api/v1/runs/", data, format="json")
    two = second.post("/api/v1/runs/", data, format="json")
    assert one.status_code == two.status_code == 201
    assert one.data["id"] != two.data["id"]
    run = Run.objects.get(pk=one.data["id"])
    assert run.client_token == tokens[0]
    assert len(run.snapshot["agents"]) == 1
    assert first.post("/api/v1/runs/", data, format="json").data["id"] == one.data["id"]
    assert (
        first.post(
            "/api/v1/runs/", {**data, "inputs": {"changed": True}}, format="json"
        ).status_code
        == 400
    )
    assert second.get(f"/api/v1/runs/{run.pk}/").status_code == 404
    assert second.post(f"/api/v1/runs/{run.pk}/cancel/").status_code == 404
    run.status = "failed"
    run.save()
    tokens[0].action_versions.clear()
    assert (
        first.post(
            f"/api/v1/runs/{run.pk}/retry/", {"idempotency_key": "retry"}, format="json"
        ).status_code
        == 404
    )


def test_mcp_shares_grants_and_client_attribution(clients):
    (first, second), _, project, other, action, _ = clients
    listed = tool(first, "list_projects", {})
    assert len(json.loads(listed["content"][0]["text"])["projects"]) == 1
    args = {"agent": str(project.pk), "action": str(action.pk), "idempotency_key": "mcp"}
    invalid = first.post(
        "/mcp/",
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "run_action", "arguments": args},
        },
        format="json",
    )
    assert invalid.data["error"]["code"] == -32602
    result = tool(first, "run_action", {**args, "version": 1})
    assert not result["isError"]
    run = json.loads(result["content"][0]["text"])
    assert tool(second, "get_run", {"id": run["id"]})["isError"]
    assert tool(first, "run_action", {**args, "version": 2})["isError"]
    assert tool(
        first, "save_action", {"agent": str(project.pk), "name": "Denied", "source": "return 4"}
    )["isError"]
    assert tool(
        first, "save_action", {"agent": str(other.pk), "name": "Denied", "source": "return 4"}
    )["isError"]
    assert tool(first, "list_plugins", {})["isError"]


def test_scope_validation_and_legacy_cannot_execute_code(clients):
    _, tokens, _, _, _, _ = clients
    serializer = TokenSerializer(data={"name": "bad", "scopes": ["read", "code:execute"]})
    assert not serializer.is_valid()
    tokens[0].scopes = ["read", "write"]
    with pytest.raises(Exception, match="scope"):
        require_scope(tokens[0], "code:execute")


def test_retry_preserves_pinned_snapshot_while_rechecking_grants(clients):
    (client, _), _, project, _, action, _ = clients
    response = client.post("/api/v1/runs/", payload(project, action), format="json")
    run = Run.objects.get(pk=response.data["id"])
    run.status = "failed"
    run.snapshot["agents"][0]["plugins"] = [
        {
            "slug": "pinned",
            "version": "1",
            "digest": "original",
            "configuration": {"region": "original"},
        }
    ]
    run.save()
    project.instructions = "Changed after acceptance"
    project.save()
    response = client.post(
        f"/api/v1/runs/{run.pk}/retry/", {"idempotency_key": "retry-pinned"}, format="json"
    )
    assert response.status_code == 201
    retry = Run.objects.get(pk=response.data["id"])
    assert retry.snapshot == run.snapshot
