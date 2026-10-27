import pytest
from rest_framework.test import APIClient

from apps.actions.models import Action, ActionVersion, Plugin
from apps.agents.models import Agent
from apps.runs.models import Run
from apps.runs.services import create_run
from apps.workspaces.models import Domain, Membership, Workspace

pytestmark = pytest.mark.django_db


@pytest.fixture
def project_context(settings, user):
    settings.WORKSPACE_DOMAIN_ROUTING = True
    settings.ALLOWED_HOSTS = ["projects.example.test"]
    workspace = Workspace.objects.create(name="Projects")
    Domain.objects.create(hostname="projects.example.test", workspace=workspace)
    Membership.objects.create(user=user, workspace=workspace, role="owner")
    project = Agent.objects.create(workspace=workspace, name="Existing", model="private-model")
    client = APIClient(enforce_csrf_checks=True, HTTP_HOST="projects.example.test")
    client.force_login(user)
    response = client.get("/api/v1/session/")
    client.credentials(HTTP_X_CSRFTOKEN=response.cookies["csrftoken"].value)
    return client, workspace, project


def test_project_crud_sdk_and_workspace_boundary(project_context):
    client, workspace, project = project_context
    response = client.post("/api/v1/projects/", {"name": "New project"}, format="json")
    assert response.status_code == 201, response.data
    assert not {"model", "instructions", "credential"} & response.data.keys()
    created = Agent.objects.get(pk=response.data["id"])
    assert created.workspace == workspace
    assert created.model == "" and created.credential is None
    sdk = client.get(f"/api/v1/projects/{project.pk}/sdk/")
    assert sdk.status_code == 200
    assert sdk.data["project"] == str(project.pk)
    assert "readFile(path: string): Promise<string>" in sdk.data["builtins"]
    other = Agent.objects.create(workspace=Workspace.objects.create(name="Other"), name="Private")
    assert client.get(f"/api/v1/projects/{other.pk}/sdk/").status_code == 404
    client.credentials()
    assert client.post("/api/v1/projects/", {"name": "Denied"}).status_code == 403


def test_external_sdk_uses_the_runtimes_named_argument_contract(project_context):
    client, workspace, project = project_context
    Plugin.objects.create(
        workspace=workspace,
        agent=project,
        slug="data",
        version="1.0.2",
        distribution="external",
        digest="a" * 64,
        release_metadata={
            "tools": [
                {"name": "processData", "parameters": [], "calling": "positional"},
                {"name": "fetchData", "parameters": []},
            ]
        },
    )
    response = client.get(f"/api/v1/projects/{project.pk}/sdk/")
    assert response.status_code == 200
    tools = response.data["plugins"][0]["tools"]
    assert [tool["calling"] for tool in tools] == ["named", "named"]


def test_browser_action_snapshot_is_project_only_and_origin_is_server_owned(project_context, user):
    client, workspace, project = project_context
    Agent.objects.create(workspace=workspace, name="Other project", model="other-secret")
    action = Action.objects.create(workspace=workspace, agent=project, name="Action")
    version = ActionVersion.objects.create(action=action, number=1, source="return 1;")
    response = client.post(
        "/api/v1/runs/",
        {
            "project": str(project.pk),
            "operation": "action",
            "action": str(action.pk),
            "version": 1,
            "idempotency_key": "browser",
            "origin": "webhook",
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    run = Run.objects.get(pk=response.data["id"])
    assert run.action_version == version
    assert run.origin == "browser" and run.origin_reference == ""
    assert [entry["id"] for entry in run.snapshot["agents"]] == [str(project.pk)]
    selected = run.snapshot["agents"][0]
    assert selected["model"] == "" and selected["credential_id"] is None
    assert selected["instructions"] == ""
    assert str(response.data["project"]) == str(project.pk)
    run.status = "failed"
    run.save(update_fields=["status"])
    retry = client.post(f"/api/v1/runs/{run.pk}/retry/", {"idempotency_key": "retry"})
    assert retry.status_code == 201, retry.data
    assert retry.data["origin"] == "retry"
    assert retry.data["origin_reference"] == str(run.pk)
    assert Run.objects.get(pk=retry.data["id"]).snapshot == run.snapshot


def test_action_project_alias_and_conflicting_legacy_alias(project_context):
    client, _, project = project_context
    response = client.post(
        "/api/v1/actions/", {"project": str(project.pk), "name": "Canonical"}, format="json"
    )
    assert response.status_code == 201, response.data
    assert str(response.data["project"]) == str(project.pk)
    response = client.post(
        "/api/v1/runs/",
        {
            "project": str(project.pk),
            "agent": "00000000-0000-0000-0000-000000000001",
            "operation": "code",
            "source": "return 1;",
            "idempotency_key": "mismatch",
        },
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.parametrize("origin", ["schedule", "webhook"])
def test_trigger_origin_records_server_reference(project_context, user, origin):
    _, workspace, project = project_context
    run = create_run(
        workspace=workspace,
        actor=user,
        agent=project,
        operation="code",
        source="return 1;",
        inputs={},
        key=origin,
        origin=origin,
        origin_reference="trigger-id",
    )
    assert (run.origin, run.origin_reference) == (origin, "trigger-id")


def test_browser_retry_has_actual_caller_and_preserves_client_lineage(project_context, user):
    from apps.api_access.models import AccessToken
    from apps.core.tokens import digest

    client, workspace, project = project_context
    token = AccessToken.objects.create(
        workspace=workspace,
        actor=user,
        name="Original client",
        digest=digest("old-key"),
        scopes=["code:execute"],
    )
    token.projects.add(project)
    original = create_run(
        workspace=workspace,
        actor=user,
        agent=project,
        operation="code",
        inputs={},
        source="return 1;",
        key="original-client",
        client_token=token,
    )
    assert original.origin == "client" and original.origin_reference == str(token.pk)
    token.revoked = True
    token.save(update_fields=["revoked"])
    original.status = "failed"
    original.save(update_fields=["status"])
    response = client.post(
        f"/api/v1/runs/{original.pk}/retry/", {"idempotency_key": "browser-client-retry"}
    )
    assert response.status_code == 201, response.data
    retry = Run.objects.get(pk=response.data["id"])
    assert retry.client_token is None
    assert retry.retry_of == original
    assert retry.origin == "retry" and retry.origin_reference == str(original.pk)


def test_action_alias_relation_stays_in_workspace(project_context):
    client, _, project = project_context
    foreign = Agent.objects.create(
        workspace=Workspace.objects.create(name="Foreign"), name="Hidden"
    )
    response = client.post(
        "/api/v1/actions/", {"project": str(foreign.pk), "name": "Denied"}, format="json"
    )
    assert response.status_code == 400
    response = client.post(
        "/api/v1/actions/",
        {"project": str(project.pk), "agent": str(foreign.pk), "name": "Mismatch"},
        format="json",
    )
    assert response.status_code == 400
