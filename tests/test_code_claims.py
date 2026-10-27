"""SQLite contention checks for caller deduplication and project serialization."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from django.db import close_old_connections
from rest_framework.test import APIClient

from apps.actions.models import Action, ActionVersion
from apps.agents.models import Agent
from apps.api_access.models import AccessToken
from apps.core.tokens import digest
from apps.execution.models import Executor, WorkspaceSettings
from apps.runs.models import Run
from apps.runs.services import create_run
from apps.workspaces.models import Membership, Workspace

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def execution(user):
    workspace = Workspace.objects.create(name="Concurrent code")
    Membership.objects.create(workspace=workspace, user=user, role="owner")
    project = Agent.objects.create(workspace=workspace, name="Serial project")
    WorkspaceSettings.objects.create(workspace=workspace, max_concurrent_runs=4)
    tokens = []
    for index in range(2):
        token = AccessToken.objects.create(
            workspace=workspace,
            actor=user,
            name=str(index),
            digest=digest(str(uuid4())),
            scopes=["code:execute", "actions:run"],
        )
        token.projects.add(project)
        tokens.append(token)
    return workspace, user, project, tokens


def concurrent(callback, items):
    barrier = Barrier(2)

    def contender(item):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return callback(item)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(contender, items))


@pytest.mark.parametrize("same_client", [True, False])
def test_concurrent_code_idempotency_is_caller_scoped(execution, same_client):
    workspace, actor, project, tokens = execution

    def submit(token):
        return create_run(
            workspace=workspace,
            actor=actor,
            agent=project,
            operation="code",
            source="return 42;",
            inputs={},
            key="shared-key",
            client_token=token,
        ).pk

    clients = [tokens[0], tokens[0] if same_client else tokens[1]]
    ids = concurrent(submit, clients)
    assert len(set(ids)) == (1 if same_client else 2)
    assert Run.objects.filter(agent=project).count() == len(set(ids))


def test_code_and_action_claims_serialize_per_project(execution):
    workspace, actor, project, tokens = execution
    action = Action.objects.create(workspace=workspace, agent=project, name="Saved")
    version = ActionVersion.objects.create(action=action, number=1, source="return 43;")
    code = create_run(
        workspace=workspace,
        actor=actor,
        agent=project,
        operation="code",
        source="return 42;",
        inputs={},
        key="code",
        client_token=tokens[0],
    )
    saved = create_run(
        workspace=workspace,
        actor=actor,
        agent=project,
        operation="action",
        version=version,
        inputs={},
        key="action",
        client_token=tokens[0],
    )
    secret = str(uuid4())
    Executor.objects.create(
        agent=project,
        name=secret,
        token_hash=digest(secret),
        protocol_version=2,
        capabilities=["code", "action"],
    )

    def claim(_):
        return (
            APIClient(HTTP_AUTHORIZATION=f"Bearer {secret}")
            .post("/internal/execution/v1/claim/")
            .status_code
        )

    assert sorted(concurrent(claim, [0, 1])) == [200, 204]
    code.refresh_from_db()
    assert code.status == "running"
    assert Run.objects.filter(agent=project, status="running").count() == 1
    Run.objects.filter(pk=code.pk).update(status="succeeded", capability_hash="")
    assert claim(0) == 200
    saved.refresh_from_db()
    assert saved.status == "running"


def test_protocol_one_cannot_claim_code_even_when_advertised(execution):
    workspace, actor, project, tokens = execution
    run = create_run(
        workspace=workspace,
        actor=actor,
        agent=project,
        operation="code",
        source="return 42;",
        inputs={},
        key="old-runner",
        client_token=tokens[0],
    )
    secret = str(uuid4())
    Executor.objects.create(
        agent=project,
        name=secret,
        token_hash=digest(secret),
        protocol_version=1,
        capabilities=["code", "action"],
    )
    response = APIClient(HTTP_AUTHORIZATION=f"Bearer {secret}").post(
        "/internal/execution/v1/claim/"
    )
    assert response.status_code == 204
    run.refresh_from_db()
    assert run.status == "queued"
