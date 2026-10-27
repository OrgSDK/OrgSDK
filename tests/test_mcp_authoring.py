"""External-client exploration, promotion and pinned test-suite submission."""

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
def harness(user, settings):
    settings.WORKSPACE_DOMAIN_ROUTING = True
    workspace = Workspace.objects.create(name="MCP authoring")
    Domain.objects.create(hostname="testserver", workspace=workspace)
    Membership.objects.create(workspace=workspace, user=user, role="owner")
    project = Agent.objects.create(workspace=workspace, name="Project")
    token = AccessToken.objects.create(
        workspace=workspace,
        actor=user,
        name="Harness",
        digest=digest("mcp-authoring"),
        scopes=[
            "catalog:read",
            "actions:write",
            "actions:test",
            "actions:run",
            "code:execute",
            "runs:read",
        ],
    )
    token.projects.add(project)
    return APIClient(HTTP_AUTHORIZATION="Bearer mcp-authoring"), token, project


def call(harness, tool_name, **arguments):
    response = harness[0].post(
        "/mcp/",
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    assert "error" not in response.data, response.data
    result = response.data["result"]
    return result, json.loads(result["content"][0]["text"]) if not result["isError"] else None


def save(harness):
    _, _, project = harness
    result, saved = call(
        harness,
        "save_action",
        agent=str(project.pk),
        name="Sum",
        source="return 42;",
        input_schema={},
        output_schema={"type": "integer"},
    )
    assert result["isError"] is False
    return saved


def test_mcp_explore_promote_validate_and_run_tests(harness):
    _, _, project = harness
    source = "  return 42;\n"
    _, one_off = call(
        harness,
        "execute_code",
        project=str(project.pk),
        source=source,
        inputs={"example": 99},
        idempotency_key="explore",
    )
    assert not Action.objects.exists()
    _, promoted = call(
        harness,
        "promote_run",
        id=one_off["id"],
        name="Promoted",
        input_schema={},
        output_schema={"type": "integer"},
    )
    assert promoted["version"]["source"] == source
    assert promoted["version"]["input_schema"] == {}
    assert promoted["version"]["promoted_from"] == one_off["id"]
    action_id = promoted["action"]
    version = promoted["version"]["number"]
    _, inspected = call(harness, "get_action", action=action_id, version=version)
    assert inspected["version"]["source"] == source
    _, validation = call(
        harness, "validate_code", project=str(project.pk), source=source, idempotency_key="static"
    )
    assert validation["operation"] == "validate"
    _, suite = call(
        harness,
        "save_tests",
        action=action_id,
        version=version,
        cases=[{"name": "answer", "inputs": {}, "expected": 42}],
    )
    assert suite["revision"] == 1
    _, inspected_suite = call(
        harness, "get_tests", action=action_id, version=version, suite_revision=1
    )
    assert inspected_suite["digest"] == suite["digest"]
    params = {
        "action": action_id,
        "version": version,
        "suite_revision": 1,
        "idempotency_key": "mocked",
    }
    _, tests = call(harness, "run_tests", **params)
    _, duplicate = call(harness, "run_tests", **params)
    assert tests["operation"] == "test" and tests["id"] == duplicate["id"]
    assert Run.objects.get(pk=tests["id"]).snapshot["test_suite"]["digest"] == suite["digest"]
    _, live = call(
        harness,
        "run_action",
        agent=str(project.pk),
        action=action_id,
        version=version,
        inputs={},
        idempotency_key="live",
    )
    assert live["action_version"] == promoted["version"]["id"]


def test_exact_version_test_client_cannot_author_or_select_another_version(harness):
    _, token, _ = harness
    saved = save(harness)
    action_id = saved["action"]
    _, suite = call(
        harness,
        "save_tests",
        action=action_id,
        version=1,
        cases=[{"name": "answer", "inputs": {}, "expected": 42}],
    )
    granted = ActionVersion.objects.get(pk=saved["version"]["id"])
    ActionVersion.objects.create(action=granted.action, number=2, source="return 43;")
    token.projects.clear()
    token.action_versions.add(granted)
    token.scopes = ["catalog:read", "actions:test", "runs:read"]
    token.save(update_fields=["scopes"])
    _, run = call(
        harness,
        "run_tests",
        action=action_id,
        version=1,
        suite_revision=suite["revision"],
        idempotency_key="exact",
    )
    assert run["operation"] == "test"
    assert call(harness, "get_action", action=action_id, version=2)[0]["isError"]
    assert call(
        harness,
        "save_tests",
        action=action_id,
        version=1,
        cases=[{"name": "replace", "inputs": {}, "expected": 43}],
    )[0]["isError"]
    record = Run.objects.get(pk=run["id"])
    record.status = "failed"
    record.save(update_fields=["status"])
    retry = harness[0].post(
        f"/api/v1/runs/{record.pk}/retry/", {"idempotency_key": "retry-test"}, format="json"
    )
    assert retry.status_code == 201, retry.data
    assert Run.objects.get(pk=retry.data["id"]).snapshot == record.snapshot
