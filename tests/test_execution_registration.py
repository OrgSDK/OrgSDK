from io import StringIO
from uuid import uuid4

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from rest_framework.test import APIClient

from apps.agents.models import Agent
from apps.core.tokens import digest
from apps.execution.models import Executor
from apps.runs.models import Approval, Run
from apps.workspaces.models import Workspace


@pytest.mark.django_db
def test_executor_registration_rotates_digest_without_printing_secret(monkeypatch, user):
    workspace = Workspace.objects.create(name="Local registration")
    agent = Agent.objects.create(workspace=workspace, name="Agent")
    output = StringIO()
    original = "initial-executor-secret-for-registration"
    rotated = "rotated-executor-secret-for-registration"
    monkeypatch.setenv("EXECUTOR_TOKEN", original)
    call_command("register_executor", name="Runner", agent=str(agent.pk), stdout=output)
    executor = Executor.objects.get(agent=agent)
    assert executor.token_hash == digest(original)
    assert not executor.locally_managed
    old_client = APIClient(HTTP_AUTHORIZATION=f"Bearer {original}")
    assert old_client.get("/internal/execution/v1/configuration/").status_code == 200
    run = Run.objects.create(
        workspace=workspace,
        agent=agent,
        actor=user,
        operation="chat",
        idempotency_key="active",
        status="running",
        executor=executor,
        capability_hash=digest("run-token"),
    )
    approval = Approval.objects.create(workspace=workspace, run=run, prompt="Approve")
    monkeypatch.setenv("EXECUTOR_TOKEN", rotated)
    call_command("register_executor", name="Renamed runner", agent=str(agent.pk), stdout=output)
    executor.refresh_from_db()
    run.refresh_from_db()
    approval.refresh_from_db()
    assert Executor.objects.count() == 1
    assert executor.token_hash == digest(rotated)
    assert executor.name == "Renamed runner" and executor.enabled
    assert executor.agent_id == agent.pk
    assert run.status == "cancelled" and not run.capability_hash
    assert approval.status == "interrupted"
    assert old_client.get("/internal/execution/v1/configuration/").status_code == 401
    assert (
        APIClient(HTTP_AUTHORIZATION=f"Bearer {rotated}")
        .get("/internal/execution/v1/configuration/")
        .status_code
        == 200
    )
    assert original not in output.getvalue() and rotated not in output.getvalue()


@pytest.mark.django_db
@pytest.mark.parametrize("agent_id", ["invalid-uuid", str(uuid4())])
def test_executor_registration_requires_existing_agent(monkeypatch, agent_id):
    monkeypatch.setenv("EXECUTOR_TOKEN", "test-executor-secret-for-registration")
    with pytest.raises(CommandError, match="existing agent UUID"):
        call_command("register_executor", name="Runner", agent=agent_id)
    assert not Executor.objects.exists()
