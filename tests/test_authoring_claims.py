"""Protocol gating and capability isolation for static validation and mocked tests."""

from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from apps.agents.models import Agent
from apps.agents.services import agent_snapshot
from apps.core.tokens import digest
from apps.execution.models import Executor, WorkspaceSettings
from apps.runs.models import Run
from apps.workspaces.models import Membership, Workspace

pytestmark = pytest.mark.django_db


@pytest.fixture
def authoring_executor(user, settings):
    settings.WORKSPACE_DOMAIN_ROUTING = False
    workspace = Workspace.objects.create(name="Authoring protocol")
    Membership.objects.create(workspace=workspace, user=user, role="owner")
    project = Agent.objects.create(workspace=workspace, name="Authoring")
    WorkspaceSettings.objects.create(workspace=workspace)
    executor = Executor.objects.create(
        agent=project,
        name="Authoring",
        token_hash=digest("authoring-executor"),
        protocol_version=2,
        capabilities=["action", "code", "validate", "test"],
    )
    client = APIClient(HTTP_AUTHORIZATION="Bearer authoring-executor")
    return client, executor, user


def queued(env, operation, semantic=False):
    _, executor, actor = env
    snapshot = {
        "agents": [agent_snapshot(executor.agent)],
        "root_agent_id": str(executor.agent_id),
        "source": "return 42;",
    }
    if semantic:
        snapshot["validation_mode"] = "semantic"
    return Run.objects.create(
        workspace=executor.agent.workspace,
        agent=executor.agent,
        actor=actor,
        operation=operation,
        inputs={},
        snapshot=snapshot,
        idempotency_key=str(uuid4()),
    )


@pytest.mark.parametrize("operation", ["validate", "test", "action"])
def test_protocol_two_cannot_claim_authoring_jobs(authoring_executor, operation):
    client, executor, _ = authoring_executor
    run = queued(authoring_executor, operation, semantic=operation == "action")
    assert client.post("/internal/execution/v1/claim/").status_code == 204
    run.refresh_from_db()
    assert run.status == "queued"
    executor.protocol_version = 3
    executor.save(update_fields=["protocol_version"])
    claim = client.post("/internal/execution/v1/claim/")
    assert claim.status_code == 200, claim.data
    assert claim.data["run_id"] == str(run.pk)
    assert claim.data["protocol_version"] == 3


@pytest.mark.parametrize("operation,protocol", [("action", 1), ("code", 2)])
def test_legacy_claim_payloads_remain_compatible(authoring_executor, operation, protocol):
    client, _, _ = authoring_executor
    run = queued(authoring_executor, operation)
    claim = client.post("/internal/execution/v1/claim/")
    assert claim.status_code == 200, claim.data
    assert claim.data["run_id"] == str(run.pk)
    assert claim.data["protocol_version"] == protocol


def test_registration_requires_protocol_three_for_authoring(authoring_executor):
    client, executor, _ = authoring_executor
    path = "/internal/execution/v1/register/"
    for operation in ("validate", "test"):
        response = client.post(
            path, {"protocol_version": 2, "capabilities": [operation]}, format="json"
        )
        assert response.status_code == 400
    response = client.post(
        path, {"protocol_version": 3, "capabilities": ["validate", "test"]}, format="json"
    )
    assert response.status_code == 200, response.data
    executor.refresh_from_db()
    assert executor.protocol_version == 3


@pytest.mark.parametrize("operation", ["validate", "test"])
def test_isolated_run_capability_only_reports_lifecycle(authoring_executor, operation):
    client, executor, _ = authoring_executor
    executor.protocol_version = 3
    executor.save(update_fields=["protocol_version"])
    run = queued(authoring_executor, operation)
    claim = client.post("/internal/execution/v1/claim/")
    assert claim.status_code == 200
    reporting = APIClient(HTTP_AUTHORIZATION=f"Bearer {claim.data['capability']}")
    forbidden = [
        ("get", "/internal/execution/v1/product/documents/", None),
        ("get", f"/internal/execution/v1/credentials/{uuid4()}/", None),
        ("post", "/internal/execution/v1/product/project-data/", {"operation": "list_tables"}),
        ("post", f"/internal/execution/v1/runs/{run.pk}/delegate/", {}),
    ]
    for method, path, data in forbidden:
        response = getattr(reporting, method)(path, data, format="json")
        assert response.status_code in {401, 403}, response.data
    prefix = f"/internal/execution/v1/runs/{run.pk}/"
    assert reporting.post(prefix + "heartbeat/").status_code == 200
    assert (
        reporting.post(
            prefix + "events/",
            {"sequence": 1, "kind": "test.case", "data": {"passed": True}},
            format="json",
        ).status_code
        == 204
    )
    assert (
        reporting.post(prefix + "complete/", {"status": "succeeded"}, format="json").status_code
        == 204
    )
