from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.agents.models import Agent
from apps.agents.services import agent_snapshot
from apps.core.tokens import digest
from apps.documents.models import Document
from apps.execution.models import Executor
from apps.runs.models import Run
from apps.tables.models import TableRow, WorkspaceTable
from apps.workspaces.models import Domain, Membership, Workspace

pytestmark = pytest.mark.django_db
ENDPOINT = "/internal/execution/v1/product/project-data/"
LEGACY = "/internal/execution/v1/product/documents/"


@pytest.fixture
def data_run(user, settings):
    settings.WORKSPACE_DOMAIN_ROUTING = False
    workspace = Workspace.objects.create(name="Project data")
    Membership.objects.create(workspace=workspace, user=user, role="owner")
    agent = Agent.objects.create(workspace=workspace, name="Project")
    table = WorkspaceTable.objects.create(
        workspace=workspace,
        name="Records",
        columns=[{"key": "name", "type": "text", "required": True}],
    )
    document = Document.objects.create(
        workspace=workspace, kind="memory", title="Notes", content="First"
    )
    agent.writable_tables.add(table)
    agent.writable_documents.add(document)
    executor = Executor.objects.create(agent=agent, name="Runner", token_hash=digest("executor"))
    run = Run.objects.create(
        workspace=workspace,
        agent=agent,
        actor=user,
        operation="code",
        snapshot={"agents": [agent_snapshot(agent)]},
        executor=executor,
        status="running",
        idempotency_key="data",
        capability_hash=digest("run-data"),
        deadline=timezone.now() + timedelta(minutes=30),
        lease_expires_at=timezone.now() + timedelta(minutes=5),
    )
    client = APIClient(HTTP_AUTHORIZATION="Bearer run-data")
    return client, run, table, document


def call(env, operation, **params):
    return env[0].post(ENDPOINT, {"operation": operation, **params}, format="json")


def test_grants_intersect_snapshot_and_current_project(data_run):
    client, run, table, _ = data_run
    assert call(data_run, "list_tables").data["items"][0]["id"] == str(table.pk)
    new = WorkspaceTable.objects.create(
        workspace=run.workspace, name="Later", columns=table.columns
    )
    run.agent.writable_tables.add(new)
    assert call(data_run, "get_table", table_id=str(new.pk)).status_code == 403
    run.agent.writable_tables.remove(table)
    assert call(data_run, "get_table", table_id=str(table.pk)).status_code == 403
    assert call(data_run, "list_tables").data == {"items": [], "next_offset": None}


def test_row_mutation_revision_and_write_authority(data_run):
    _, run, table, _ = data_run
    created = call(
        data_run, "write_row", table_id=str(table.pk), table_revision=1, values={"name": "one"}
    )
    assert created.status_code == 200, created.data
    row_id = created.data["id"]
    assert (
        call(
            data_run,
            "write_row",
            table_id=str(table.pk),
            table_revision=2,
            values={"name": "two"},
            row_id=row_id,
            revision=1,
        ).status_code
        == 409
    )
    updated = call(
        data_run,
        "write_row",
        table_id=str(table.pk),
        table_revision=1,
        values={"name": "two"},
        row_id=row_id,
        revision=1,
    )
    assert updated.data["revision"] == 2
    assert (
        call(data_run, "delete_row", table_id=str(table.pk), row_id=row_id, revision=1).status_code
        == 409
    )
    run.agent.writable_tables.remove(table)
    run.agent.readable_tables.add(table)
    assert call(data_run, "list_rows", table_id=str(table.pk)).status_code == 200
    assert (
        call(data_run, "delete_row", table_id=str(table.pk), row_id=row_id, revision=2).status_code
        == 403
    )


def test_document_scope_and_legacy_bypass(data_run):
    client, run, _, document = data_run
    assert (
        call(data_run, "write_document", document_id=str(document.pk), content="Saved").status_code
        == 200
    )
    assert (
        client.post(
            LEGACY, {"kind": "memory", "title": "Escape", "content": ""}, format="json"
        ).status_code
        == 403
    )
    assert client.delete(f"{LEGACY}{document.pk}/").status_code == 403
    run.agent.writable_documents.remove(document)
    run.agent.readable_documents.add(document)
    assert client.get(f"{LEGACY}{document.pk}/").status_code == 200
    assert (
        client.patch(f"{LEGACY}{document.pk}/", {"content": "escape"}, format="json").status_code
        == 403
    )
    assert (
        call(data_run, "write_document", document_id=str(document.pk), content="escape").status_code
        == 403
    )
    document.refresh_from_db()
    assert document.content == "Saved"


@pytest.mark.parametrize("change", ["cancel", "complete", "membership"])
def test_revoked_run_denies_data(data_run, change):
    _, run, _, _ = data_run
    if change == "membership":
        Membership.objects.filter(workspace=run.workspace, user=run.actor).delete()
    else:
        if change == "cancel":
            run.cancel_requested = True
        else:
            run.status = "succeeded"
        run.save()
    assert call(data_run, "list_tables").status_code in {401, 403}


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 101}, {"limit": True}, {"offset": "1"}, {"unexpected": 1}]
)
def test_strict_pagination(data_run, params):
    assert call(data_run, "list_tables", **params).status_code == 400


def test_document_and_row_response_bounds(data_run):
    _, run, table, document = data_run
    document.content = "é" * 100_000
    document.save()
    assert call(data_run, "get_document", document_id=str(document.pk)).status_code == 400
    assert (
        call(
            data_run, "write_document", document_id=str(document.pk), content="é" * 100_001
        ).status_code
        == 400
    )
    table.columns = [{"key": f"field{i}", "type": "text", "required": False} for i in range(25)]
    table.save()
    TableRow.objects.create(table=table, values={f"field{i}": "x" * 10_000 for i in range(25)})
    response = call(data_run, "list_rows", table_id=str(table.pk))
    assert response.status_code == 400
    assert "200000-byte" in str(response.data)


def test_snapshot_read_grant_cannot_become_write_mid_run(data_run):
    _, run, table, _ = data_run
    grants = run.snapshot["agents"][0]["resources"]["tables"]
    grants["read"], grants["write"] = grants["write"], []
    run.save(update_fields=["snapshot"])
    assert call(data_run, "get_table", table_id=str(table.pk)).status_code == 200
    assert (
        call(
            data_run,
            "write_row",
            table_id=str(table.pk),
            table_revision=1,
            values={"name": "blocked"},
        ).status_code
        == 403
    )


def test_foreign_workspace_and_other_project_are_excluded(data_run):
    _, run, table, _ = data_run
    other_project = Agent.objects.create(workspace=run.workspace, name="Other")
    private = WorkspaceTable.objects.create(
        workspace=run.workspace, name="Private", columns=table.columns
    )
    other_project.writable_tables.add(private)
    foreign_workspace = Workspace.objects.create(name="Foreign")
    foreign = WorkspaceTable.objects.create(
        workspace=foreign_workspace, name="Foreign", columns=table.columns
    )
    # Even accidentally inconsistent stored grants and snapshots cannot cross the workspace.
    run.agent.writable_tables.add(foreign)
    run.snapshot["agents"][0]["resources"]["tables"]["write"].append(str(foreign.pk))
    run.save(update_fields=["snapshot"])
    assert call(data_run, "get_table", table_id=str(private.pk)).status_code == 403
    assert call(data_run, "get_table", table_id=str(foreign.pk)).status_code == 403
    listed = call(data_run, "list_tables").data["items"]
    assert [item["id"] for item in listed] == [str(table.pk)]


def test_pages_use_byte_budget_without_losing_items(data_run):
    _, _, table, _ = data_run
    table.columns = [{"key": f"field{i}", "type": "text", "required": False} for i in range(15)]
    table.save()
    for _ in range(2):
        TableRow.objects.create(table=table, values={f"field{i}": "x" * 10_000 for i in range(15)})
    first = call(data_run, "list_rows", table_id=str(table.pk)).data
    assert len(first["items"]) == 1 and first["next_offset"] == 1
    second = call(data_run, "list_rows", table_id=str(table.pk), offset=first["next_offset"]).data
    assert len(second["items"]) == 1 and second["next_offset"] is None
    assert first["items"][0]["id"] != second["items"][0]["id"]


def test_write_response_bound_failure_rolls_back(data_run):
    _, _, _, document = data_run
    document.content = "x" * 199_950
    document.save()
    result = call(data_run, "write_document", document_id=str(document.pk), title="Changed")
    assert result.status_code == 400
    document.refresh_from_db()
    assert document.title == "Notes"


def test_grants_require_manager_session_and_same_workspace(data_run, settings):
    _, run, table, _ = data_run
    settings.WORKSPACE_DOMAIN_ROUTING = True
    Domain.objects.create(workspace=run.workspace, hostname="testserver")
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(run.actor)
    session = client.session
    session["workspace_id"] = str(run.workspace_id)
    session.save()
    bootstrap = client.get("/api/v1/session/")
    csrf = bootstrap.cookies["csrftoken"].value
    path = f"/api/v1/agents/{run.agent_id}/"
    member = Membership.objects.get(workspace=run.workspace, user=run.actor)
    member.role = "member"
    member.save()
    response = client.patch(
        path, {"readable_tables": [str(table.pk)]}, format="json", HTTP_X_CSRFTOKEN=csrf
    )
    assert response.status_code == 403
    member.role = "owner"
    member.save()
    foreign = Document.objects.create(
        workspace=Workspace.objects.create(name="Foreign grant"), kind="document", title="Private"
    )
    response = client.patch(
        path, {"readable_documents": [str(foreign.pk)]}, format="json", HTTP_X_CSRFTOKEN=csrf
    )
    assert response.status_code == 400
    response = client.patch(
        path, {"readable_tables": [str(table.pk)]}, format="json", HTTP_X_CSRFTOKEN=csrf
    )
    assert response.status_code == 200, response.data
    assert run.agent.readable_tables.filter(pk=table.pk).exists()


@pytest.mark.parametrize("body", [[], ["operation"], None, "list_tables", 3])
def test_nonobject_requests_fail_cleanly(data_run, body):
    assert data_run[0].post(ENDPOINT, body, format="json").status_code == 400


def test_legacy_owner_write_key_cannot_manage_grants(data_run, settings):
    from apps.api_access.models import AccessToken

    _, run, table, _ = data_run
    settings.WORKSPACE_DOMAIN_ROUTING = True
    Domain.objects.create(workspace=run.workspace, hostname="testserver")
    AccessToken.objects.create(
        workspace=run.workspace,
        actor=run.actor,
        name="Legacy owner",
        digest=digest("legacy-owner"),
        scopes=["read", "write"],
    )
    client = APIClient(HTTP_AUTHORIZATION="Bearer legacy-owner")
    response = client.patch(
        f"/api/v1/agents/{run.agent_id}/", {"readable_tables": [str(table.pk)]}, format="json"
    )
    assert response.status_code == 403
    assert not run.agent.readable_tables.exists()


def test_cancellation_while_waiting_for_workspace_lock_is_rechecked(data_run, monkeypatch):
    from apps.tables import services

    _, run, _, document = data_run
    original = services.lock_actor

    def cancel_after_lock(workspace, actor, **kwargs):
        original(workspace, actor, **kwargs)
        Run.objects.filter(pk=run.pk).update(cancel_requested=True)

    monkeypatch.setattr(services, "lock_actor", cancel_after_lock)
    assert (
        call(data_run, "write_document", document_id=str(document.pk), content="Race").status_code
        == 403
    )
    document.refresh_from_db()
    assert document.content == "First"
