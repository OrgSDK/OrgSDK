from datetime import timedelta
from io import StringIO
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.actions.models import Action, ActionVersion
from apps.actions.tasks import dispatch_schedules
from apps.agents.models import Agent
from apps.core.tokens import digest
from apps.credentials.models import Credential
from apps.credentials.secrets import encrypt
from apps.execution.models import Executor, WorkspaceSettings
from apps.execution.tasks import expire_leases
from apps.runs.models import Approval, Run
from apps.runs.services import create_run
from apps.workspaces.models import Domain, Membership, Workspace

pytestmark = pytest.mark.django_db


@pytest.fixture
def environment(settings, django_user_model):
    settings.WORKSPACE_DOMAIN_ROUTING = True
    settings.ALLOWED_HOSTS = ["testserver", "localhost", ".example.test"]
    settings.CREDENTIAL_ENCRYPTION_KEY = Fernet.generate_key().decode()
    user = django_user_model.objects.create_user(
        username="owner", email="owner@example.test", password="test"
    )
    other = django_user_model.objects.create_user(
        username="other", email="other@example.test", password="test"
    )
    first = Workspace.objects.create(name="Acme")
    second = Workspace.objects.create(name="Other")
    for host, workspace, owner in [
        ("acme.example.test", first, user),
        ("other.example.test", second, other),
    ]:
        Domain.objects.create(hostname=host, workspace=workspace)
        WorkspaceSettings.objects.create(workspace=workspace)
        Membership.objects.create(workspace=workspace, user=owner, role="owner")
    agent = Agent.objects.create(workspace=first, name="Helper")
    outsider = Agent.objects.create(workspace=second, name="Private")
    action = Action.objects.create(workspace=first, agent=agent, name="Sum")
    version = ActionVersion.objects.create(
        action=action,
        number=1,
        source="return actionParams.a + 1",
        input_schema={"type": "object", "properties": {"a": {"type": "number"}}, "required": ["a"]},
    )
    client = APIClient(HTTP_HOST="acme.example.test")
    client.force_authenticate(user)
    return client, user, first, second, agent, outsider, version


def new_run(env, key="first"):
    _, user, workspace, _, agent, _, version = env
    return create_run(
        workspace=workspace,
        actor=user,
        agent=agent,
        operation="action",
        inputs={"a": 2},
        key=key,
        version=version,
    )


def claim(env, pool="shared"):
    token = str(uuid4())
    executor, _ = Executor.objects.update_or_create(
        agent=env[4],
        defaults={
            "name": str(uuid4()),
            "pool": pool,
            "token_hash": digest(token),
            "capabilities": ["action", "chat"],
        },
    )
    client = APIClient(HTTP_AUTHORIZATION=f"Bearer {token}")
    result = client.post("/internal/execution/v1/claim/")
    if result.status_code == 204:
        return client, result, executor
    assert result.status_code == 200, result.data
    worker = APIClient(HTTP_AUTHORIZATION=f"Bearer {result.data['capability']}")
    return worker, result, executor


def test_hostname_is_context_not_authority(environment):
    client, user, first, second, agent, outsider, _ = environment
    assert client.get("/api/v1/agents/").data["count"] == 1
    assert client.get(f"/api/v1/agents/{outsider.pk}/").status_code == 404
    assert client.get("/api/v1/agents/", HTTP_HOST="other.example.test").status_code == 403
    assert client.get("/api/v1/agents/", HTTP_HOST="unknown.example.test").status_code == 404
    session = client.session
    session["workspace_id"] = second.pk
    session.save()
    assert client.get("/api/v1/agents/").data["results"][0]["id"] == str(agent.pk)
    assert client.post(f"/api/v1/workspaces/{second.pk}/select/").status_code == 403


def test_localhost_dedicated_same_api(environment):
    client, _, workspace, *_ = environment
    Domain.objects.create(hostname="localhost", workspace=workspace)
    assert client.get("/api/v1/agents/", HTTP_HOST="localhost:8080").status_code == 200


def test_foreign_reference_rejected(environment):
    client, *_ = environment
    response = client.post(
        "/api/v1/actions/", {"agent": str(environment[5].pk), "name": "Leak"}, format="json"
    )
    assert response.status_code == 400


def test_membership_removed_immediately(environment):
    client, user, workspace, *_ = environment
    Membership.objects.filter(user=user, workspace=workspace).delete()
    assert client.get("/api/v1/agents/").status_code == 403


def test_versions_immutable_and_inputs_validated(environment):
    client, _, _, _, agent, _, version = environment
    path = f"/api/v1/actions/{version.action_id}/versions/"
    assert (
        client.post(path, {"source": "return 42", "input_schema": {}}, format="json").data["number"]
        == 2
    )
    version.refresh_from_db()
    assert version.source == "return actionParams.a + 1"
    bad = client.post(
        "/api/v1/runs/",
        {
            "agent": str(agent.pk),
            "operation": "action",
            "action": str(version.action_id),
            "version": 1,
            "inputs": {"a": "bad"},
            "idempotency_key": "bad",
        },
        format="json",
    )
    assert bad.status_code == 400


def test_run_idempotency_pins_snapshot(environment):
    first = new_run(environment)
    second = new_run(environment)
    assert first.pk == second.pk
    environment[4].instructions = "Changed"
    environment[4].save()
    assert first.snapshot["agents"][0]["instructions"] == ""
    client = environment[0]
    conflict = client.post(
        "/api/v1/runs/",
        {
            "agent": str(environment[4].pk),
            "operation": "action",
            "action": str(environment[6].action_id),
            "inputs": {"a": 99},
            "idempotency_key": "first",
        },
        format="json",
    )
    assert conflict.status_code == 400


def test_executor_claim_scopes_and_completion(environment):
    run = new_run(environment)
    worker, result, _ = claim(environment)
    assert "capability" in result.data
    assert worker.get("/internal/execution/v1/product/agents/").data["count"] == 1
    assert worker.post(f"/internal/execution/v1/runs/{uuid4()}/heartbeat/").status_code == 403
    event = {"sequence": 1, "kind": "log", "data": {"message": "hello"}}
    path = f"/internal/execution/v1/runs/{run.pk}/events/"
    assert worker.post(path, event, format="json").status_code == 204
    assert worker.post(path, event, format="json").status_code == 204
    assert worker.post(path, event | {"kind": "other"}, format="json").status_code == 400
    finish = f"/internal/execution/v1/runs/{run.pk}/complete/"
    payload = {"status": "succeeded", "output": {"result": 3}}
    assert worker.post(finish, payload, format="json").status_code == 204
    assert worker.post(finish, payload, format="json").status_code == 204
    assert worker.get("/internal/execution/v1/product/agents/").status_code == 403
    run.refresh_from_db()
    assert run.status == "succeeded"


def test_agent_routing_and_capacity(environment):
    config = WorkspaceSettings.objects.get(workspace=environment[2])
    config.execution_pool = "dedicated"
    config.max_concurrent_runs = 1
    config.save()
    new_run(environment)
    _, result, _ = claim(environment)
    assert result.status_code == 200
    new_run(environment, "second")
    _, result, _ = claim(environment, pool="dedicated")
    assert result.status_code == 204


def test_expired_lease_never_replayed(environment):
    run = new_run(environment)
    worker, _, _ = claim(environment)
    Approval.objects.create(workspace=run.workspace, run=run, prompt="Send?")
    Run.objects.filter(pk=run.pk).update(lease_expires_at=timezone.now() - timedelta(seconds=1))
    expire_leases()
    run.refresh_from_db()
    assert run.status == "interrupted"
    assert run.approvals.get().status == "interrupted"
    assert worker.post(f"/internal/execution/v1/runs/{run.pk}/heartbeat/").status_code == 401
    assert Run.objects.count() == 1
    result = environment[0].post(
        f"/api/v1/runs/{run.pk}/retry/", {"idempotency_key": "retry"}, format="json"
    )
    assert result.status_code == 201
    retried = Run.objects.get(pk=result.data["id"])
    assert retried.snapshot == run.snapshot


def test_credential_metadata_and_job_scope(environment):
    client, user, workspace, other, agent, _, _ = environment
    result = client.post(
        "/api/v1/credentials/",
        {"name": "Model", "provider": "openai", "secret": {"api_key": "private-value"}},
        format="json",
    )
    assert result.status_code == 201 and "secret" not in result.data
    credential = Credential.objects.get(pk=result.data["id"])
    assert "private-value" not in credential.encrypted_secret
    from apps.actions.models import Plugin

    Plugin.objects.create(
        workspace=workspace,
        agent=agent,
        slug="credential-test",
        version="1",
        source="source",
        digest="digest",
        credential=credential,
    )
    foreign = Credential.objects.create(
        workspace=other,
        name="Other",
        provider="model",
        encrypted_secret=encrypt({"api_key": "other-secret"}),
    )
    run = new_run(environment)
    worker, _, _ = claim(environment)
    assert (
        worker.get(f"/internal/execution/v1/credentials/{credential.pk}/").data["secret"]["api_key"]
        == "private-value"
    )
    assert worker.get(f"/internal/execution/v1/credentials/{foreign.pk}/").status_code == 403
    worker.post(
        f"/internal/execution/v1/runs/{run.pk}/events/",
        {"sequence": 1, "kind": "log", "data": {"message": "private-value"}},
        format="json",
    )
    assert run.events.get().data["message"] == "[redacted]"


def test_executor_cannot_approve_or_edit_another_run(environment):
    run = new_run(environment)
    other = new_run(environment, "other")
    worker, _, _ = claim(environment)
    path = "/internal/execution/v1/product/approvals/"
    assert (
        worker.post(path, {"run": str(other.pk), "prompt": "Other"}, format="json").status_code
        == 400
    )
    created = worker.post(path, {"run": str(run.pk), "prompt": "Send?"}, format="json")
    assert created.status_code == 201
    url = f"{path}{created.data['id']}/decide/"
    assert worker.post(url, {"decision": "approved"}, format="json").status_code == 403
    public = f"/api/v1/approvals/{created.data['id']}/decide/"
    assert environment[0].post(public, {"decision": "approved"}, format="json").status_code == 200
    assert environment[0].post(public, {"decision": "approved"}, format="json").status_code == 400


def test_api_tokens_bound_to_domain_and_scope(environment):
    client = environment[0]
    token = client.post(
        "/api/v1/tokens/", {"name": "reader", "scopes": ["read"]}, format="json"
    ).data["token"]
    machine = APIClient(HTTP_AUTHORIZATION=f"Bearer {token}", HTTP_HOST="acme.example.test")
    assert machine.get("/api/v1/agents/").status_code == 200
    assert machine.post("/api/v1/agents/", {"name": "no"}, format="json").status_code == 403
    assert machine.get("/api/v1/agents/", HTTP_HOST="other.example.test").status_code == 403


def test_schedule_occurrence_deduplicated(environment):
    client = environment[0]
    version = environment[6]
    response = client.post(
        "/api/v1/schedules/",
        {"action": str(version.action_id), "cron": "* * * * *", "inputs": {"a": 1}},
        format="json",
    )
    assert response.status_code == 201
    from apps.actions.models import Schedule

    Schedule.objects.update(next_run_at=timezone.now() - timedelta(seconds=10))
    dispatch_schedules()
    dispatch_schedules()
    assert Run.objects.count() == 1
    assert Run.objects.get().origin == "schedule"
    assert Run.objects.get().origin_reference == str(Schedule.objects.get().pk)


def test_provisioning_repeatable_without_reset(environment):
    out = StringIO()
    call_command(
        "provision_workspace",
        domain="new.example.test",
        name="New",
        owner="new@example.test",
        stdout=out,
    )
    call_command(
        "provision_workspace",
        domain="new.example.test",
        name="New",
        owner="new@example.test",
        stdout=out,
    )
    assert Domain.objects.filter(hostname="new.example.test").count() == 1
    assert "already provisioned" in out.getvalue()


def test_mcp_validation_and_scopes(environment):
    client = environment[0]

    def rpc(method, params):
        return client.post(
            "/mcp/", {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, format="json"
        )

    assert rpc("tools/list", {}).data["result"]["tools"]
    assert rpc("tools/call", []).data["error"]["code"] == -32602
    assert rpc("tools/call", {"name": "get_run", "arguments": {"id": "invalid"}}).data["result"][
        "isError"
    ]
    assert (
        rpc("tools/call", {"name": "list_projects", "arguments": {}}).data["result"]["isError"]
        is False
    )


@pytest.mark.django_db(transaction=True)
def test_concurrent_claims_respect_capacity(environment):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("Row-lock contention requires PostgreSQL")
    config = WorkspaceSettings.objects.get(workspace=environment[2])
    config.max_concurrent_runs = 1
    config.save()
    new_run(environment, "concurrent-a")
    new_run(environment, "concurrent-b")
    tokens = [str(uuid4()), str(uuid4())]
    token = tokens[0]
    Executor.objects.create(
        agent=environment[4], name=token, token_hash=digest(token), capabilities=["action"]
    )
    tokens = [token, token]
    barrier = Barrier(2)

    def contender(token):
        close_old_connections()
        try:
            client = APIClient(HTTP_AUTHORIZATION=f"Bearer {token}")
            barrier.wait(timeout=10)
            return client.post("/internal/execution/v1/claim/").status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(contender, tokens))
    assert sorted(results) == [200, 204]
    assert Run.objects.filter(status="running").count() == 1


def test_event_stream_accept_header(environment):
    run = new_run(environment)
    response = environment[0].get(f"/api/v1/runs/{run.pk}/stream/", HTTP_ACCEPT="text/event-stream")
    assert response.status_code == 200
    assert response.streaming
    assert response["Content-Type"] == "text/event-stream"
    response.close()


def test_document_app_supports_independent_workspace_crud(environment):
    from apps.documents.models import Document

    client, _, workspace, other_workspace, *_ = environment
    # Documents can be created before an agent exists in the workspace.
    Agent.objects.filter(workspace=workspace).delete()
    payload = {"kind": "memory", "title": "Remember", "content": "Before"}
    response = client.post("/api/v1/documents/", payload, format="json")
    assert response.status_code == 201
    assert "agent" not in response.data
    document = Document.objects.get(pk=response.data["id"])
    assert document.workspace_id == workspace.pk
    hidden = Document.objects.create(workspace=other_workspace, kind="document", title="Private")
    assert client.get(f"/api/v1/documents/{hidden.pk}/").status_code == 404
    assert client.get("/api/v1/documents/").data["count"] == 1
    path = f"/api/v1/documents/{document.pk}/"
    assert client.patch(path, {"content": "After"}, format="json").status_code == 200
    agent = Agent.objects.create(workspace=workspace, name="Temporary")
    agent.delete()
    document.refresh_from_db()
    assert document.content == "After"
    assert client.delete(path).status_code == 204
    assert not Document.objects.filter(workspace=workspace).exists()


def test_artifact_app_preserves_workspace_access_and_immutability(environment):
    from apps.actions.models import Artifact

    client, user, workspace, other_workspace, _, outsider, _ = environment
    run = new_run(environment)
    foreign_run = Run.objects.create(
        workspace=other_workspace, actor=user, agent=outsider, idempotency_key="foreign"
    )
    payload = {
        "run": str(run.pk),
        "name": "Result",
        "content": "Output",
        "media_type": "text/plain",
    }
    response = client.post("/api/v1/artifacts/", payload, format="json")
    assert response.status_code == 201
    artifact = Artifact.objects.get(pk=response.data["id"])
    assert artifact.workspace_id == workspace.pk
    assert run.artifacts.get() == artifact
    assert artifact._meta.app_label == "actions"
    assert (
        client.post(
            "/api/v1/artifacts/", payload | {"run": str(foreign_run.pk)}, format="json"
        ).status_code
        == 400
    )
    hidden = Artifact.objects.create(
        workspace=other_workspace, run=foreign_run, name="Private", content="Hidden"
    )
    assert client.get(f"/api/v1/artifacts/{hidden.pk}/").status_code == 404
    assert client.get("/api/v1/artifacts/").data["count"] == 1
    path = f"/api/v1/artifacts/{artifact.pk}/"
    assert client.patch(path, {"content": "Overwrite"}, format="json").status_code == 405
    assert client.delete(path).status_code == 204


def test_executor_documents_are_workspace_scoped_and_artifacts_remain_run_scoped(environment):
    from apps.actions.models import Artifact
    from apps.documents.models import Document

    _, _, workspace, other_workspace, *_ = environment
    document = Document.objects.create(
        workspace=workspace, kind="memory", title="Visible", content="Memory"
    )
    run = new_run(environment)
    for agent in run.snapshot["agents"]:
        agent.pop("resources", None)
    run.save(update_fields=["snapshot"])
    other_run = new_run(environment, "other")
    hidden = Document.objects.create(workspace=other_workspace, kind="document", title="Hidden")
    other_artifact = Artifact.objects.create(
        workspace=workspace, run=other_run, name="Hidden", content="Other run"
    )
    worker, _, _ = claim(environment)
    documents = "/internal/execution/v1/product/documents/"
    artifacts = "/internal/execution/v1/product/artifacts/"
    assert worker.get(documents).data["count"] == 1
    assert worker.get(f"{documents}{hidden.pk}/").status_code == 404
    assert (
        worker.patch(
            f"{documents}{document.pk}/", {"content": "Updated"}, format="json"
        ).status_code
        == 200
    )
    response = worker.post(
        documents, {"kind": "memory", "title": "Created", "content": "New"}, format="json"
    )
    assert response.status_code == 201
    created = Document.objects.get(pk=response.data["id"])
    assert created.workspace_id == workspace.pk
    assert "agent" not in response.data
    assert (
        worker.patch(f"{documents}{hidden.pk}/", {"content": "Leak"}, format="json").status_code
        == 404
    )
    assert worker.delete(f"{documents}{hidden.pk}/").status_code == 404
    assert worker.delete(f"{documents}{created.pk}/").status_code == 204
    payload = {"run": str(run.pk), "name": "Result", "content": "Output"}
    assert worker.post(artifacts, payload, format="json").status_code == 201
    assert worker.get(artifacts).data["count"] == 1
    assert worker.get(f"{artifacts}{other_artifact.pk}/").status_code == 404
    assert (
        worker.post(artifacts, payload | {"run": str(other_run.pk)}, format="json").status_code
        == 400
    )
    Run.objects.filter(pk=run.pk).update(status="succeeded")
    assert worker.get(documents).status_code == 403
    assert worker.get(artifacts).status_code == 403


def test_agent_app_crud_scopes_plugins_and_credentials_and_pins_snapshot(environment):
    from apps.actions.models import Plugin
    from apps.audit.models import AuditEvent
    from apps.documents.models import Document

    client, _, workspace, other, _, _, _ = environment
    Credential.objects.create(
        workspace=workspace,
        name="Model",
        provider="model",
        encrypted_secret=encrypt({"key": "secret"}),
    )
    foreign = Credential.objects.create(
        workspace=other, name="Private", provider="model", encrypted_secret="ciphertext"
    )
    plugin = Plugin.objects.create(
        workspace=workspace, slug="installed", version="1", source="source", digest="digest"
    )
    _hidden = Plugin.objects.create(
        workspace=other, slug="private", version="1", source="private", digest="private"
    )
    payload = {
        "name": "Created",
        "plugins": [str(plugin.pk)],
    }
    assert (
        client.post(
            "/api/v1/agents/", payload | {"credential": str(foreign.pk)}, format="json"
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/plugins/",
            {
                "agent": str(environment[5].pk),
                "slug": "foreign",
                "version": "1",
                "source": "source",
            },
            format="json",
        ).status_code
        == 400
    )
    response = client.post("/api/v1/agents/", payload, format="json")
    assert response.status_code == 201
    agent = Agent.objects.get(pk=response.data["id"])
    assert agent._meta.app_label == "agents"
    assert agent.workspace_id == workspace.pk
    Document.objects.create(workspace=workspace, kind="memory", title="Remember", content="Memory")
    disabled = Plugin.objects.create(
        workspace=workspace,
        slug="disabled",
        version="1",
        source="disabled",
        digest="disabled",
        enabled=False,
    )
    disabled.agent = agent
    disabled.save()
    plugin.agent = agent
    plugin.save()
    run = create_run(
        workspace=workspace,
        actor=environment[1],
        agent=agent,
        operation="code",
        source="return 1;",
        inputs={},
        key="new-agent",
    )
    snapshot = next(row for row in run.snapshot["agents"] if row["id"] == str(agent.pk))
    assert snapshot["plugins"] == [
        {
            "slug": "installed",
            "version": "1",
            "source": "source",
            "digest": "digest",
            "credential_id": None,
            "credential_provider": None,
            "distribution": "inline",
            "configuration": {},
            "package_url": "",
            "contract_version": 1,
        }
    ]
    assert snapshot["credential_id"] is None
    assert snapshot["documents"] == []
    # Documents stay available through tools; they are not injected into every agent snapshot.
    path = f"/api/v1/agents/{agent.pk}/"
    assert client.patch(path, {"name": "After"}, format="json").status_code == 200
    run.refresh_from_db()
    assert (
        next(row for row in run.snapshot["agents"] if row["id"] == str(agent.pk))["name"]
        == "Created"
    )
    assert client.delete(path).status_code == 400
    run.delete()
    assert client.delete(path).status_code == 204
    assert set(
        AuditEvent.objects.filter(object_id=str(agent.pk)).values_list("kind", flat=True)
    ) == {"agent.created", "agent.updated", "agent.deleted"}


def test_actions_app_owns_workflows_plugins_and_artifacts_and_retains_management_rules(environment):
    from django.apps import apps

    from apps.actions.models import Artifact, Plugin
    from apps.actions.services import source_digest

    client, user, workspace, *_ = environment
    assert {model._meta.app_label for model in [Action, ActionVersion, Plugin, Artifact]} == {
        "actions"
    }
    assert not apps.is_installed("apps.artifacts")
    payload = {
        "agent": str(environment[4].pk),
        "slug": "installed",
        "version": "1",
        "description": "Plugin",
        "source": "return 1",
    }
    response = client.post("/api/v1/plugins/", payload, format="json")
    assert response.status_code == 201
    plugin = Plugin.objects.get(pk=response.data["id"])
    assert plugin.workspace_id == workspace.pk
    assert plugin.digest == source_digest(payload["source"])
    assert client.post("/api/v1/plugins/", payload, format="json").status_code == 400
    path = f"/api/v1/plugins/{plugin.pk}/"
    assert client.patch(path, {"source": "return 2"}, format="json").status_code == 400
    assert (
        client.patch(path, {"source": "return 2", "version": "2"}, format="json").status_code == 200
    )
    Membership.objects.filter(user=user, workspace=workspace).update(role="member")
    assert client.get(path).status_code == 200
    assert client.patch(path, {"enabled": False}, format="json").status_code == 403
    assert client.delete(path).status_code == 403


def test_executor_action_api_remains_snapshot_scoped_after_app_move(environment):
    _, _, workspace, *_ = environment
    new_run(environment)
    late_agent = Agent.objects.create(workspace=workspace, name="Outside snapshot")
    hidden = Action.objects.create(workspace=workspace, agent=late_agent, name="Hidden")
    worker, _, _ = claim(environment)
    path = "/internal/execution/v1/product/actions/"
    assert worker.get(path).data["count"] == 1
    assert worker.get(f"{path}{hidden.pk}/").status_code == 404
    assert (
        worker.post(
            path, {"agent": str(late_agent.pk), "name": "Denied"}, format="json"
        ).status_code
        == 405
    )
    response = worker.post(
        path, {"agent": str(environment[4].pk), "name": "Allowed"}, format="json"
    )
    assert response.status_code == 405


def test_credentials_app_keeps_public_secrets_write_only_and_manager_scoped(environment):
    from apps.credentials.secrets import decrypt

    client, user, workspace, other, *_ = environment
    payload = {
        "name": "Provider",
        "provider": "model",
        "secret": {"api_key": "initial-provider-secret"},
    }
    response = client.post("/api/v1/credentials/", payload, format="json")
    assert response.status_code == 201
    assert set(response.data) == {"id", "name", "provider"}
    credential = Credential.objects.get(pk=response.data["id"])
    assert credential._meta.app_label == "credentials"
    assert decrypt(credential.encrypted_secret) == payload["secret"]
    path = f"/api/v1/credentials/{credential.pk}/"
    assert set(client.get(path).data) == {"id", "name", "provider"}
    assert "initial-provider-secret" not in str(client.get("/api/v1/credentials/").data)
    ciphertext = credential.encrypted_secret
    assert client.patch(path, {"name": "Renamed"}, format="json").status_code == 200
    credential.refresh_from_db()
    assert credential.encrypted_secret == ciphertext
    response = client.patch(path, {"secret": {"api_key": "rotated-provider-secret"}}, format="json")
    assert response.status_code == 200
    assert "secret" not in response.data
    credential.refresh_from_db()
    assert decrypt(credential.encrypted_secret) == {"api_key": "rotated-provider-secret"}
    foreign = Credential.objects.create(
        workspace=other, name="Foreign", provider="model", encrypted_secret="ciphertext"
    )
    assert client.get(f"/api/v1/credentials/{foreign.pk}/").status_code == 404
    Membership.objects.filter(user=user, workspace=workspace).update(role="member")
    assert client.get(path).status_code == 200
    assert client.post("/api/v1/credentials/", payload, format="json").status_code == 403
    assert client.patch(path, {"secret": {"api_key": "denied"}}, format="json").status_code == 403
    assert client.delete(path).status_code == 403


def test_credentials_app_requires_encryption_configuration(environment, settings):
    settings.CREDENTIAL_ENCRYPTION_KEY = ""
    response = environment[0].post(
        "/api/v1/credentials/",
        {"name": "Provider", "provider": "model", "secret": {"api_key": "private-secret"}},
        format="json",
    )
    assert response.status_code == 400
    assert not Credential.objects.exists()
    assert "private-secret" not in str(response.data)


def test_executor_credentials_remain_snapshot_scoped_and_redact_plugin_secrets(environment):
    from apps.actions.models import Plugin
    from apps.audit.models import AuditEvent

    client, user, workspace, _, agent, *_ = environment
    credential = Credential.objects.create(
        workspace=workspace,
        name="Plugin",
        provider="plugin",
        encrypted_secret=encrypt({"api_key": "plugin-provider-secret"}),
    )
    unbound = Credential.objects.create(
        workspace=workspace,
        name="Other",
        provider="model",
        encrypted_secret=encrypt({"api_key": "unbound-provider-secret"}),
    )
    plugin = Plugin.objects.create(
        workspace=workspace,
        slug="installed",
        version="1",
        source="source",
        digest="digest",
        credential=credential,
    )
    plugin.agent = agent
    plugin.save()
    run = new_run(environment)
    worker, _, _ = claim(environment)
    plugin.enabled = False
    plugin.save()
    secret = worker.get(f"/internal/execution/v1/credentials/{credential.pk}/")
    assert secret.status_code == 200
    assert secret.data == {"secret": {"api_key": "plugin-provider-secret"}}
    assert secret["Cache-Control"] == "no-store"
    assert worker.get(f"/internal/execution/v1/credentials/{unbound.pk}/").status_code == 403
    assert worker.get("/api/v1/credentials/", HTTP_HOST="acme.example.test").status_code in {
        401,
        403,
    }
    assert AuditEvent.objects.filter(kind="credential.used", object_id=str(credential.pk)).exists()
    event_path = f"/internal/execution/v1/runs/{run.pk}/events/"
    assert (
        worker.post(
            event_path,
            {"sequence": 1, "kind": "log", "data": {"nested": ["plugin-provider-secret"]}},
            format="json",
        ).status_code
        == 204
    )
    assert run.events.get().data == {"nested": ["[redacted]"]}
    finish = worker.post(
        f"/internal/execution/v1/runs/{run.pk}/complete/",
        {"status": "succeeded", "output": {"value": "plugin-provider-secret"}},
        format="json",
    )
    assert finish.status_code == 204
    run.refresh_from_db()
    assert run.output == {"value": "[redacted]"}
    assert "plugin-provider-secret" not in str(client.get(f"/api/v1/runs/{run.pk}/").data)
    assert worker.get(f"/internal/execution/v1/credentials/{credential.pk}/").status_code == 403


def test_run_app_supports_code_cancellation_and_explicit_retry(environment):
    client, _, _, _, agent, *_ = environment
    payload = {
        "agent": str(agent.pk),
        "operation": "code",
        "source": "return 1;",
        "inputs": {},
        "idempotency_key": "chat",
    }
    response = client.post("/api/v1/runs/", payload, format="json")
    assert response.status_code == 201
    run = Run.objects.get(pk=response.data["id"])
    assert run._meta.app_label == "runs"
    assert run.action_version_id is None
    assert client.post("/api/v1/runs/", payload, format="json").data["id"] == str(run.pk)
    path = f"/api/v1/runs/{run.pk}/"
    assert (
        client.post(path + "retry/", {"idempotency_key": "too-soon"}, format="json").status_code
        == 400
    )
    assert client.post(path + "cancel/").data["status"] == "cancelled"
    assert client.post(path + "cancel/").data["status"] == "cancelled"
    agent.instructions = "Changed"
    agent.save()
    response = client.post(path + "retry/", {"idempotency_key": "retry-chat"}, format="json")
    assert response.status_code == 201
    retried = Run.objects.get(pk=response.data["id"])
    assert retried.retry_of_id == run.pk
    assert retried.snapshot == run.snapshot
    assert retried.status == "queued"
    assert retried.operation == "code"


def test_run_completion_observes_pending_approvals_and_cancellation(environment):
    from apps.runs.models import Approval, RunEvent

    run = new_run(environment)
    worker, _, _ = claim(environment)
    approval = Approval.objects.create(workspace=run.workspace, run=run, prompt="Continue?")
    event_path = f"/internal/execution/v1/runs/{run.pk}/events/"
    for sequence in [2, 1]:
        assert (
            worker.post(
                event_path, {"sequence": sequence, "kind": "log", "data": {}}, format="json"
            ).status_code
            == 204
        )
    assert RunEvent._meta.app_label == "runs"
    assert [
        event["sequence"] for event in environment[0].get(f"/api/v1/runs/{run.pk}/events/").data
    ] == [1, 2]
    finish = f"/internal/execution/v1/runs/{run.pk}/complete/"
    assert worker.post(finish, {"status": "succeeded"}, format="json").status_code == 400
    environment[0].post(f"/api/v1/runs/{run.pk}/cancel/")
    assert worker.post(finish, {"status": "succeeded"}, format="json").status_code == 204
    run.refresh_from_db()
    approval.refresh_from_db()
    assert run.status == "cancelled"
    assert approval.status == "interrupted"
    assert worker.post(finish, {"status": "cancelled"}, format="json").status_code == 204
    assert worker.post(finish, {"status": "failed"}, format="json").status_code == 400
    assert (
        worker.post(
            event_path, {"sequence": 3, "kind": "log", "data": {}}, format="json"
        ).status_code
        == 400
    )


@pytest.mark.django_db(transaction=True)
def test_concurrent_run_submissions_remain_idempotent(environment):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent run submission requires PostgreSQL")
    barrier = Barrier(2)
    payload = {
        "agent": str(environment[4].pk),
        "operation": "action",
        "action": str(environment[6].action_id),
        "inputs": {"a": 1},
        "idempotency_key": "concurrent",
    }

    def submit(_):
        close_old_connections()
        try:
            client = APIClient(HTTP_HOST="acme.example.test")
            client.force_authenticate(environment[1])
            barrier.wait(timeout=10)
            response = client.post("/api/v1/runs/", payload, format="json")
            assert response.status_code == 201
            return response.data["id"]
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(submit, range(2)))
    assert ids[0] == ids[1]
    assert Run.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_executor_event_replays_remain_idempotent(environment):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent event replay requires PostgreSQL")
    run = new_run(environment)
    _, claimed, _ = claim(environment)
    capability = claimed.data["capability"]
    barrier = Barrier(2)

    def submit(_):
        close_old_connections()
        try:
            client = APIClient(HTTP_AUTHORIZATION=f"Bearer {capability}")
            barrier.wait(timeout=10)
            return client.post(
                f"/internal/execution/v1/runs/{run.pk}/events/",
                {"sequence": 1, "kind": "log", "data": {"message": "Once"}},
                format="json",
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(submit, range(2))) == [204, 204]
    assert run.events.count() == 1


@pytest.mark.parametrize("decision", ["approved", "denied"])
def test_run_approval_requests_and_decisions_keep_actor_and_audit_rules(environment, decision):
    from apps.audit.models import AuditEvent

    client, user, workspace, *_ = environment
    run = new_run(environment)
    assert (
        client.post(
            "/api/v1/approvals/", {"run": str(run.pk), "prompt": "Queued?"}, format="json"
        ).status_code
        == 400
    )
    worker, _, _ = claim(environment)
    response = worker.post(
        "/internal/execution/v1/product/approvals/",
        {"run": str(run.pk), "prompt": "Continue?", "status": "approved", "decided_by": user.pk},
        format="json",
    )
    assert response.status_code == 201
    approval = Approval.objects.get(pk=response.data["id"])
    assert approval._meta.app_label == "runs"
    assert approval.status == "pending"
    assert approval.decided_by_id is None
    run.refresh_from_db()
    assert run.status == "waiting_approval"
    path = f"/api/v1/approvals/{approval.pk}/decide/"
    response = client.post(path, {"decision": decision}, format="json")
    assert response.status_code == 200
    assert response.data["decided_by"] == user.pk
    approval.refresh_from_db()
    assert approval.status == decision
    assert approval.workspace_id == workspace.pk
    assert approval.decided_by_id == user.pk
    assert client.post(path, {"decision": decision}, format="json").status_code == 400
    assert (
        AuditEvent.objects.filter(object_id=str(approval.pk), kind="approval.created").count() == 1
    )
    assert (
        AuditEvent.objects.filter(
            object_id=str(approval.pk), kind="approval.decided", actor=user
        ).count()
        == 1
    )


def test_approval_decision_requires_manager_and_explicit_token_scope(environment):
    client, user, workspace, *_ = environment
    run = new_run(environment)
    Run.objects.filter(pk=run.pk).update(status="waiting_approval")
    approval = Approval.objects.create(workspace=workspace, run=run, prompt="Continue?")
    path = f"/api/v1/approvals/{approval.pk}/decide/"
    token = client.post(
        "/api/v1/tokens/", {"name": "Writer", "scopes": ["read", "write"]}, format="json"
    ).data["token"]
    machine = APIClient(HTTP_AUTHORIZATION=f"Bearer {token}", HTTP_HOST="acme.example.test")
    assert machine.post(path, {"decision": "approved"}, format="json").status_code == 403
    Membership.objects.filter(user=user, workspace=workspace).update(role="member")
    assert client.post(path, {"decision": "approved"}, format="json").status_code == 403
    Membership.objects.filter(user=user, workspace=workspace).update(role="owner")
    token = client.post(
        "/api/v1/tokens/",
        {"name": "Approver", "scopes": ["read", "write", "approve"]},
        format="json",
    ).data["token"]
    machine.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    assert machine.post(path, {"decision": "denied"}, format="json").status_code == 200
    approval.refresh_from_db()
    assert approval.decided_by_id == user.pk


def test_approval_access_stays_workspace_and_run_scoped_and_terminal_decisions_fail(environment):
    client, user, workspace, other, _, outsider, _ = environment
    run = new_run(environment)
    second = new_run(environment, "second")
    foreign_run = Run.objects.create(
        workspace=other, actor=user, agent=outsider, idempotency_key="foreign", status="running"
    )
    hidden = Approval.objects.create(workspace=other, run=foreign_run, prompt="Private")
    assert client.get(f"/api/v1/approvals/{hidden.pk}/").status_code == 404
    assert (
        client.post(
            f"/api/v1/approvals/{hidden.pk}/decide/", {"decision": "approved"}, format="json"
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/v1/approvals/", {"run": str(foreign_run.pk), "prompt": "Denied"}, format="json"
        ).status_code
        == 400
    )
    second_approval = Approval.objects.create(workspace=workspace, run=second, prompt="Other run")
    worker, _, _ = claim(environment)
    assert (
        worker.get(f"/internal/execution/v1/product/approvals/{second_approval.pk}/").status_code
        == 404
    )
    pending = Approval.objects.create(workspace=workspace, run=run, prompt="Pending")
    Run.objects.filter(pk=run.pk).update(status="failed")
    assert (
        client.post(
            f"/api/v1/approvals/{pending.pk}/decide/", {"decision": "approved"}, format="json"
        ).status_code
        == 400
    )
    pending.refresh_from_db()
    assert pending.decided_by_id is None


@pytest.mark.django_db(transaction=True)
def test_concurrent_approval_decisions_record_only_one_human_decision(environment):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from apps.audit.models import AuditEvent

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent approval decisions require PostgreSQL")
    run = new_run(environment)
    Run.objects.filter(pk=run.pk).update(status="waiting_approval")
    approval = Approval.objects.create(workspace=environment[2], run=run, prompt="Continue?")
    barrier = Barrier(2)

    def decide(decision):
        close_old_connections()
        try:
            client = APIClient(HTTP_HOST="acme.example.test")
            client.force_authenticate(environment[1])
            barrier.wait(timeout=10)
            return client.post(
                f"/api/v1/approvals/{approval.pk}/decide/", {"decision": decision}, format="json"
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(decide, ["approved", "denied"]))
    assert sorted(statuses) == [200, 400]
    approval.refresh_from_db()
    assert approval.decided_by_id == environment[1].pk
    assert (
        AuditEvent.objects.filter(kind="approval.decided", object_id=str(approval.pk)).count() == 1
    )


@pytest.mark.django_db(transaction=True)
def test_concurrent_schedule_dispatch_submits_one_occurrence(environment):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from apps.actions.models import Schedule

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent schedule dispatch requires PostgreSQL")
    Schedule.objects.create(
        workspace=environment[2],
        actor=environment[1],
        action=environment[6].action,
        cron="* * * * *",
        inputs={"a": 1},
        next_run_at=timezone.now() - timedelta(seconds=1),
    )
    barrier = Barrier(2)

    def dispatch(_):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            dispatch_schedules()
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(dispatch, range(2)))
    assert Run.objects.count() == 1
    assert Schedule.objects.get().next_run_at > timezone.now()


def test_api_token_metadata_and_lifecycle_boundaries(environment):
    from apps.api_access.models import AccessToken

    client, user, workspace, *_ = environment
    created = client.post(
        "/api/v1/tokens/", {"name": "Automation", "scopes": ["read", "write"]}, format="json"
    )
    assert created.status_code == 201
    raw = created.data["token"]
    token = AccessToken.objects.get(pk=created.data["id"])
    assert token.actor == user and token.workspace == workspace
    assert token.digest == digest(raw) and token.digest != raw
    metadata = client.get(f"/api/v1/tokens/{token.pk}/")
    assert {"id", "name", "scopes", "revoked", "request_count", "activity_state"} <= set(
        metadata.data
    )
    assert "digest" not in metadata.data and "token" not in metadata.data
    machine = APIClient(HTTP_AUTHORIZATION=f"Bearer {raw}", HTTP_HOST="acme.example.test")
    assert (
        machine.post(
            "/api/v1/tokens/", {"name": "Nested", "scopes": ["read"]}, format="json"
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/tokens/", {"name": "Invalid", "scopes": ["admin"]}, format="json"
        ).status_code
        == 400
    )
    token.revoked = True
    token.save(update_fields=["revoked"])
    assert machine.get("/api/v1/agents/").status_code == 403
    token.revoked = False
    token.save(update_fields=["revoked"])
    user.is_active = False
    user.save(update_fields=["is_active"])
    assert machine.get("/api/v1/agents/").status_code == 403
    user.is_active = True
    user.save(update_fields=["is_active"])
    assert client.delete(f"/api/v1/tokens/{token.pk}/").status_code == 204
    assert machine.get("/api/v1/agents/").status_code == 403


def test_schedule_edit_recomputes_next_occurrence_with_session_csrf(environment, monkeypatch):
    from datetime import UTC, datetime

    from apps.actions.models import Schedule

    _, user, *_ = environment
    client = APIClient(enforce_csrf_checks=True, HTTP_HOST="acme.example.test")
    client.force_login(user)
    client.get("/api/v1/session/")
    csrf = client.cookies["csrftoken"].value
    now = datetime(2026, 10, 19, 12, 30, tzinfo=UTC)
    monkeypatch.setattr("apps.actions.serializers.timezone.now", lambda: now)
    response = client.post(
        "/api/v1/schedules/",
        {"action": str(environment[6].action_id), "cron": "0 9 * * *", "inputs": {"a": 1}},
        format="json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert response.status_code == 201
    schedule = Schedule.objects.get(pk=response.data["id"])
    assert schedule.next_run_at == datetime(2026, 10, 20, 9, tzinfo=UTC)
    path = f"/api/v1/schedules/{schedule.pk}/"
    updated = client.patch(path, {"cron": "0 18 * * *"}, format="json", HTTP_X_CSRFTOKEN=csrf)
    assert updated.status_code == 200
    schedule.refresh_from_db()
    assert schedule.next_run_at == datetime(2026, 10, 19, 18, tzinfo=UTC)
    client.patch(path, {"inputs": {"a": 2}}, format="json", HTTP_X_CSRFTOKEN=csrf)
    schedule.refresh_from_db()
    assert schedule.next_run_at == datetime(2026, 10, 19, 18, tzinfo=UTC)
    Schedule.objects.filter(pk=schedule.pk).update(
        enabled=False, next_run_at=now - timedelta(days=2)
    )
    resumed = client.patch(path, {"enabled": True}, format="json", HTTP_X_CSRFTOKEN=csrf)
    assert resumed.status_code == 200
    schedule.refresh_from_db()
    assert schedule.next_run_at == datetime(2026, 10, 19, 18, tzinfo=UTC)


@pytest.fixture(autouse=True)
def external_catalog_fixture(request, settings, tmp_path):
    if "bundled_" not in request.node.name:
        return
    import json

    entries = []
    for slug, provider in [("serper", "serper"), ("google-sheets", "google-oauth"), ("data", None)]:
        entries.append(
            {
                "slug": slug,
                "version": "1",
                "digest": "a" * 64,
                "distribution": "external",
                "package_url": "https://example.test/plugins/" + slug + ".js",
                "contract_version": 1,
                "display_name": slug,
                "description": slug,
                "category": "tools",
                "auth": {
                    "type": "oauth2" if provider == "google-oauth" else "api-key",
                    "provider": provider,
                },
                "marketplace": {},
                "documentation": "",
                "configuration_schema": {"type": "object"},
                "tools": [],
            }
        )
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(entries))
    settings.PLUGIN_CATALOG_PATH = str(path)


def test_bundled_catalog_install_and_snapshot(environment):
    from apps.actions.catalog import catalog_entries
    from apps.actions.models import Plugin
    from apps.actions.services import plugin_snapshot

    client, _, workspace, other, _, _, _ = environment
    catalog = client.get("/api/v1/plugins/catalog/")
    assert catalog.status_code == 200
    assert len(catalog.data) == 3
    release = next(row for row in catalog_entries() if row["slug"] == "serper")
    credential = Credential.objects.create(
        workspace=workspace,
        name="Search",
        provider="serper",
        encrypted_secret=encrypt({"secret_apiKey": "search-secret"}),
    )
    foreign = Credential.objects.create(
        workspace=other, name="Foreign", provider="serper", encrypted_secret="unused"
    )
    payload = {
        "agent": str(environment[4].pk),
        "slug": "serper",
        "version": release["version"],
        "distribution": "external",
        "credential": str(credential.pk),
        "configuration": {"defaultCountry": "au"},
    }
    assert (
        client.post(
            "/api/v1/plugins/", payload | {"credential": str(foreign.pk)}, format="json"
        ).status_code
        == 400
    )
    assert (
        client.post("/api/v1/plugins/", payload | {"version": "missing"}, format="json").status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/plugins/", payload | {"source": "untrusted"}, format="json"
        ).status_code
        == 400
    )
    response = client.post("/api/v1/plugins/", payload, format="json")
    assert response.status_code == 201, response.data
    plugin = Plugin.objects.get(pk=response.data["id"])
    assert plugin.digest == release["digest"]
    assert plugin.source == ""
    snapshot = plugin_snapshot(plugin)
    assert snapshot["credential_provider"] == "serper"
    assert snapshot["configuration"] == {"defaultCountry": "au"}
    path = f"/api/v1/plugins/{plugin.pk}/"
    assert client.patch(path, {"source": "tampered"}, format="json").status_code == 400
    assert client.patch(path, {"distribution": "inline"}, format="json").status_code == 400
    assert client.patch(path, {"enabled": False}, format="json").status_code == 200
    assert client.patch(path, {"configuration": []}, format="json").status_code == 400
    assert client.post("/api/v1/plugins/", payload, format="json").status_code == 400
    assert client.delete(path).status_code == 204


def test_bundled_oauth_connection_is_single_use_and_refresh_stays_in_django(
    environment, monkeypatch
):
    import time
    from urllib.parse import parse_qs, urlparse

    from apps.actions.catalog import catalog_release
    from apps.actions.models import Plugin
    from apps.credentials import oauth
    from apps.credentials.models import OAuthAttempt
    from apps.credentials.secrets import decrypt

    client, user, workspace, _, _, _, _ = environment
    # Real session binding accompanies this test fixture's API authentication.
    session = client.session
    session.save()
    release = catalog_release("google-sheets")
    plugin = Plugin.objects.create(
        workspace=workspace,
        agent=environment[4],
        slug=release["slug"],
        version=release["version"],
        source="",
        digest=release["digest"],
        distribution="external",
    )
    payload = {
        "plugin": str(plugin.pk),
        "name": "Sheets",
        "client_id": "client-id",
        "client_secret": "client-secret",
    }
    response = client.post("/api/v1/credentials/oauth-connect/", payload, format="json")
    assert response.status_code == 200, response.data
    query = parse_qs(urlparse(response.data["authorization_url"]).query)
    assert query["code_challenge_method"] == ["S256"]
    state = query["state"][0]
    attempt = OAuthAttempt.objects.get(user=user)
    assert "client-secret" not in attempt.encrypted_payload
    assert attempt.state_digest != state
    calls = []

    def exchange(provider, secret, data):
        calls.append(data)
        return {
            "access_token": "first-access" if len(calls) == 1 else "fresh-access",
            "refresh_token": "rotated-refresh",
            "expires_in": 3600,
        }

    monkeypatch.setattr(oauth, "exchange", exchange)
    callback = "/api/v1/credentials/oauth-callback/"
    assert client.get(callback, {"state": "wrong", "code": "code"}).status_code == 400
    assert client.get(callback, {"state": state, "code": "code"}).status_code == 302
    assert client.get(callback, {"state": state, "code": "code"}).status_code == 400
    plugin.refresh_from_db()
    assert plugin.credential.provider == "google-oauth"
    saved = decrypt(plugin.credential.encrypted_secret)
    assert saved["source"] == "byo"
    assert saved["secret_refreshToken"] == "rotated-refresh"
    assert oauth.execution_secret(plugin.credential) == {
        "source": "byo",
        "secret_accessToken": "first-access",
    }
    assert len(calls) == 1
    saved["expires_at"] = time.time() - 60
    plugin.credential.encrypted_secret = encrypt(saved)
    plugin.credential.save()
    assert oauth.execution_secret(plugin.credential) == {
        "source": "byo",
        "secret_accessToken": "fresh-access",
    }
    assert calls[-1]["grant_type"] == "refresh_token"
    assert not OAuthAttempt.objects.exists()


def test_bundled_writes_require_manager_and_upgrade_is_explicit(environment):
    from apps.actions.catalog import catalog_release
    from apps.actions.models import Plugin

    client, user, workspace, _, _, _, _ = environment
    release = catalog_release("data")
    plugin = Plugin.objects.create(
        workspace=workspace,
        agent=environment[4],
        slug="data",
        version=release["version"],
        distribution="external",
        source="",
        digest="previous-build",
    )
    path = f"/api/v1/plugins/{plugin.pk}/"
    assert client.patch(path, {"enabled": False}, format="json").status_code == 200
    plugin.refresh_from_db()
    assert plugin.digest == "previous-build"
    assert client.patch(path, {"refresh_bundle": True}, format="json").status_code == 200
    plugin.refresh_from_db()
    assert plugin.digest == release["digest"]
    Membership.objects.filter(workspace=workspace, user=user).update(role="member")
    assert client.get("/api/v1/plugins/catalog/").status_code == 200
    assert client.patch(path, {"enabled": True}, format="json").status_code == 403
    assert client.delete(path).status_code == 403
    assert client.post("/api/v1/credentials/oauth-connect/", {}, format="json").status_code == 403


def test_agent_creation_has_no_workspace_quota(environment):
    from apps.agents.services import create_agent

    client, _, workspace, *_ = environment
    for index in range(5):
        create_agent(workspace=workspace, name=f"Agent {index}")
    response = client.post("/api/v1/agents/", {"name": "Another agent"}, format="json")
    assert response.status_code == 201
    assert Agent.objects.filter(workspace=workspace).count() == 7


def test_agent_plugin_ownership_is_enforced(environment):
    from apps.actions.models import Plugin

    client, _, workspace, *_ = environment
    second = Agent.objects.create(workspace=workspace, name="Second")
    payload = {
        "agent": str(environment[4].pk),
        "slug": "custom",
        "version": "1",
        "source": "return 1",
    }
    first = client.post("/api/v1/plugins/", payload, format="json")
    assert first.status_code == 201
    assert (
        client.post(
            "/api/v1/plugins/", payload | {"agent": str(second.pk)}, format="json"
        ).status_code
        == 201
    )
    assert (
        client.patch(
            f"/api/v1/plugins/{first.data['id']}/", {"agent": str(second.pk)}, format="json"
        ).status_code
        == 400
    )
    assert Plugin.objects.filter(agent=second).count() == 1
    assert (
        client.post(
            "/api/v1/plugins/", payload | {"agent": str(environment[5].pk)}, format="json"
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"/api/v1/agents/{second.pk}/", {"plugins": [first.data["id"]]}, format="json"
        ).status_code
        == 200
    )
    assert Plugin.objects.get(pk=first.data["id"]).agent_id == environment[4].pk


def test_executor_bound_to_agent_serial_and_revocation(environment):
    _, user, workspace, *_ = environment
    target = Agent.objects.create(workspace=workspace, name="Target")
    target_run = create_run(
        workspace=workspace,
        actor=user,
        agent=target,
        operation="code",
        source="return 1;",
        inputs={},
        key="target",
    )
    _, empty, _ = claim(environment)
    assert empty.status_code == 204
    root = new_run(environment)
    worker, response, executor = claim(environment)
    assert response.data["run_id"] == str(root.pk)
    new_run(environment, "queued-second")
    client = APIClient(HTTP_AUTHORIZATION="Bearer serial-token")
    executor.token_hash = digest("serial-token")
    executor.save(update_fields=["token_hash"])
    assert client.post("/internal/execution/v1/claim/").status_code == 204
    target_run.refresh_from_db()
    assert target_run.status == "queued"
    assert environment[0].delete(f"/api/v1/agents/{environment[4].pk}/executor/").status_code == 204
    assert worker.post(f"/internal/execution/v1/runs/{root.pk}/heartbeat/").status_code == 401
    assert client.post("/internal/execution/v1/claim/").status_code == 401


def test_local_bootstrap_reuses_tokens_and_never_undoes_revoke(environment, settings):
    settings.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN = "local-bootstrap-test-token"
    bootstrap = APIClient(HTTP_AUTHORIZATION="Bearer local-bootstrap-test-token")
    url = "/internal/execution/v1/bootstrap/"
    first = bootstrap.post(url)
    assert first.status_code == 200
    assert len(first.data["registrations"]) == 2
    assert bootstrap.post(url).data == first.data
    assert APIClient().post(url).status_code == 403
    agent = environment[4]
    assert environment[0].delete(f"/api/v1/agents/{agent.pk}/executor/").status_code == 204
    assert str(agent.pk) not in {r["agent_id"] for r in bootstrap.post(url).data["registrations"]}


def test_delegation_is_retired_and_target_credentials_remain_private(environment):
    from apps.actions.models import Plugin

    _, _, workspace, *_ = environment
    target_secret = Credential.objects.create(
        workspace=workspace,
        name="Target",
        provider="plugin",
        encrypted_secret=encrypt({"api_key": "target-secret"}),
    )
    target = Agent.objects.create(workspace=workspace, name="Target")
    Plugin.objects.create(
        workspace=workspace,
        agent=target,
        slug="target",
        version="1",
        source="source",
        digest="digest",
        credential=target_secret,
    )
    parent = new_run(environment)
    worker, _, _ = claim(environment)
    assert worker.get(f"/internal/execution/v1/credentials/{target_secret.pk}/").status_code == 403
    response = worker.post(
        f"/internal/execution/v1/runs/{parent.pk}/delegate/",
        {"agent_id": str(target.pk), "message": "Work", "idempotency_key": "child"},
        format="json",
    )
    assert response.status_code == 400
    assert "unsupported" in str(response.data)
    assert not Run.objects.filter(parent=parent).exists()


def test_queued_historical_chat_is_never_dispatched(environment):
    _, user, workspace, _, agent, *_ = environment
    historical = Run.objects.create(
        workspace=workspace,
        actor=user,
        agent=agent,
        operation="chat",
        inputs={"message": "old"},
        idempotency_key="historical-chat",
    )
    _, response, _ = claim(environment)
    assert response.status_code == 204
    historical.refresh_from_db()
    assert historical.status == "queued"
    action = new_run(environment)
    _, response, _ = claim(environment)
    assert response.status_code == 200
    assert response.data["run_id"] == str(action.pk)


def test_revocation_interrupts_approvals_and_local_restore(environment, settings):
    settings.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN = "bootstrap-token"
    client = environment[0]
    parent = new_run(environment)
    claim(environment)
    approval = Approval.objects.create(workspace=parent.workspace, run=parent, prompt="Approve")
    url = f"/api/v1/agents/{parent.agent_id}/executor/"
    assert client.delete(url).status_code == 204
    approval.refresh_from_db()
    assert approval.status == "interrupted"
    restored = client.post(url, {"locally_managed": True}, format="json")
    assert restored.status_code == 200
    executor = Executor.objects.get(agent=parent.agent)
    assert executor.enabled and executor.locally_managed
    assert executor.token_hash == digest(restored.data["token"])


@pytest.mark.django_db(transaction=True)
def test_concurrent_agent_creation_has_no_quota(environment):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from apps.agents.services import create_agent

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent agent creation requires PostgreSQL")
    workspace = environment[2]
    Agent.objects.create(workspace=workspace, name="Second")
    barrier = Barrier(2)

    def contender(index):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            create_agent(workspace=workspace, name=f"Agent {index}")
            return "created"
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(contender, range(2))) == ["created", "created"]
    assert Agent.objects.filter(workspace=workspace).count() == 4


def test_restoring_local_executor_rotates_old_token(environment, settings):
    settings.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN = "rotation-bootstrap-token"
    bootstrap = APIClient(HTTP_AUTHORIZATION="Bearer rotation-bootstrap-token")
    first = bootstrap.post("/internal/execution/v1/bootstrap/").data
    registration = next(
        r for r in first["registrations"] if r["agent_id"] == str(environment[4].pk)
    )
    old_worker = APIClient(HTTP_AUTHORIZATION=f"Bearer {registration['token']}")
    assert old_worker.get("/internal/execution/v1/configuration/").status_code == 200
    path = f"/api/v1/agents/{environment[4].pk}/executor/"
    assert environment[0].delete(path).status_code == 204
    restored = environment[0].post(path, {"locally_managed": True}, format="json")
    assert restored.status_code == 200
    assert restored.data["token"] != registration["token"]
    assert old_worker.get("/internal/execution/v1/configuration/").status_code == 401
    current = APIClient(HTTP_AUTHORIZATION=f"Bearer {restored.data['token']}")
    assert current.get("/internal/execution/v1/configuration/").status_code == 200
    latest = bootstrap.post("/internal/execution/v1/bootstrap/").data
    assert latest == bootstrap.post("/internal/execution/v1/bootstrap/").data
    assert (
        next(r for r in latest["registrations"] if r["agent_id"] == str(environment[4].pk))["token"]
        == restored.data["token"]
    )


def test_disabled_agent_revokes_running_capability(environment):
    run = new_run(environment)
    worker, _, _ = claim(environment)
    Agent.objects.filter(pk=run.agent_id).update(enabled=False)
    assert worker.post(f"/internal/execution/v1/runs/{run.pk}/heartbeat/").status_code == 401


@pytest.mark.parametrize(
    "contents,expected",
    [
        ("{", "Cannot read"),
        ("{}", "JSON list"),
        ("[null]", "must be an object"),
    ],
)
def test_invalid_catalog_reports_operator_error(settings, tmp_path, contents, expected):
    from rest_framework.exceptions import ValidationError

    from apps.actions.catalog import catalog_entries

    path = tmp_path / "catalog.json"
    path.write_text(contents)
    settings.PLUGIN_CATALOG_PATH = str(path)
    with pytest.raises(ValidationError, match=expected):
        catalog_entries()


def test_missing_catalog_reports_operator_error(settings, tmp_path):
    from rest_framework.exceptions import ValidationError

    from apps.actions.catalog import catalog_entries

    settings.PLUGIN_CATALOG_PATH = str(tmp_path / "missing.json")
    with pytest.raises(ValidationError, match="PLUGIN_CATALOG_PATH"):
        catalog_entries()


@pytest.mark.parametrize(
    "change,expected",
    [
        ({"package_url": "http://example.test/package.js"}, "HTTPS"),
        ({"digest": "invalid"}, "SHA256"),
        ({"configuration_schema": {"type": "invalid"}}, "JSON Schema"),
        ({"tools": ["bad"]}, "list of objects"),
        ({"auth": []}, "auth must be an object"),
        ({"version": 1}, "version must be a string"),
    ],
)
def test_bundled_catalog_validates_external_release(settings, change, expected):
    import json
    from pathlib import Path

    from rest_framework.exceptions import ValidationError

    from apps.actions.catalog import catalog_entries

    path = Path(settings.PLUGIN_CATALOG_PATH)
    entries = json.loads(path.read_text())
    entries[0].update(change)
    path.write_text(json.dumps(entries))
    with pytest.raises(ValidationError, match=expected):
        catalog_entries()


def test_bundled_catalog_rejects_duplicate_release(settings):
    import json
    from pathlib import Path

    from rest_framework.exceptions import ValidationError

    from apps.actions.catalog import catalog_entries

    path = Path(settings.PLUGIN_CATALOG_PATH)
    entries = json.loads(path.read_text())
    entries.append(entries[0])
    path.write_text(json.dumps(entries))
    with pytest.raises(ValidationError, match="duplicate release"):
        catalog_entries()


def test_bundled_catalog_local_bundle_can_be_configured_per_agent(environment, settings):
    import json
    from pathlib import Path

    from apps.actions.catalog import catalog_entries
    from apps.actions.models import Plugin
    from apps.actions.services import plugin_snapshot

    path = Path(settings.PLUGIN_CATALOG_PATH)
    entries = json.loads(path.read_text())
    release = next(entry for entry in entries if entry["slug"] == "data")
    release["package_url"] = ""
    path.write_text(json.dumps(entries))
    assert (
        next(entry for entry in catalog_entries() if entry["slug"] == "data")["package_url"] == ""
    )
    client, _, workspace, *_ = environment
    agent = environment[4]
    second = Agent.objects.create(workspace=workspace, name="Second local bundle agent")
    for owner in (agent, second):
        payload = {
            "agent": str(owner.pk),
            "slug": "data",
            "version": release["version"],
            "distribution": "external",
            "configuration": {"local": True},
        }
        response = client.post("/api/v1/plugins/", payload, format="json")
        assert response.status_code == 201, response.data
        plugin = Plugin.objects.get(pk=response.data["id"])
        snapshot = plugin_snapshot(plugin)
        assert plugin.agent_id == owner.pk
        assert snapshot["distribution"] == "external"
        assert snapshot["package_url"] == ""
        assert snapshot["digest"] == release["digest"]
        assert snapshot["configuration"] == {"local": True}
    catalog_response = client.get("/api/v1/plugins/catalog/")
    assert catalog_response.status_code == 200
    assert (
        next(entry for entry in catalog_response.data if entry["slug"] == "data")["package_url"]
        == ""
    )


def test_project_basic_edits_work_but_legacy_reasoning_mutations_are_retired(environment):
    client, _, _, _, agent, *_ = environment
    path = f"/api/v1/agents/{agent.pk}/"
    assert client.patch(path, {"name": "Project"}, format="json").status_code == 200
    for fields in [
        {"model": ""},
        {"model": "provider/model"},
        {"instructions": "Help"},
        {"credential": None},
    ]:
        assert client.patch(path, fields, format="json").status_code == 400
    agent.refresh_from_db()
    assert agent.name == "Project"
    run = new_run(environment)
    selected = run.snapshot["agents"][0]
    assert selected["model"] == "" and selected["credential_id"] is None


def test_installed_external_tools_remain_pinned_when_catalog_removed(environment, settings):
    from apps.actions.models import Plugin

    client = environment[0]
    tools = [
        {
            "name": "double",
            "description": "Double a number",
            "parameters": [{"name": "value", "type": "number"}],
        }
    ]
    plugin = Plugin.objects.create(
        workspace=environment[2],
        agent=environment[4],
        slug="pinned-tools",
        version="1",
        distribution="external",
        digest="a" * 64,
        release_metadata={
            "display_name": "Pinned tools",
            "tools": tools,
            "auth": {},
            "configuration_schema": {},
            "digest": "a" * 64,
            "description": "Tools",
            "version": "1",
            "package_url": "",
        },
    )
    settings.PLUGIN_CATALOG_PATH = "/missing/catalog.json"
    response = client.get(f"/api/v1/plugins/{plugin.pk}/")
    assert response.status_code == 200
    assert response.data["tools"] == tools
    assert response.data["display_name"] == "Pinned tools"
    # Display metadata cannot be changed through the installation API.
    settings.PLUGIN_CATALOG_PATH = ""
    changed = client.patch(
        f"/api/v1/plugins/{plugin.pk}/",
        {"tools": [{"name": "tampered"}], "display_name": "Tampered"},
        format="json",
    )
    # Existing pinned installations can retain their metadata without a live catalog.
    assert changed.status_code == 200, changed.data
    plugin.refresh_from_db()
    assert plugin.release_metadata["tools"] == tools
    assert plugin.release_metadata["display_name"] == "Pinned tools"


def test_external_plugin_missing_tools_does_not_claim_empty_tool_list(environment):
    from apps.actions.models import Plugin

    plugin = Plugin.objects.create(
        workspace=environment[2],
        agent=environment[4],
        slug="legacy-no-tools",
        version="1",
        distribution="external",
        digest="a" * 64,
    )
    response = environment[0].get(f"/api/v1/plugins/{plugin.pk}/")
    assert response.status_code == 200
    assert response.data["tools"] is None
    plugin.release_metadata = {"tools": []}
    plugin.save()
    assert environment[0].get(f"/api/v1/plugins/{plugin.pk}/").data["tools"] == []


def test_archived_conversation_order_scope_and_retry_denial(environment):
    from apps.runs.models import Conversation

    client, user, workspace, other, agent, outsider, _ = environment
    conversation = Conversation.objects.create(workspace=workspace, agent=agent, title="Remember")
    for index in range(2):
        Run.objects.create(
            workspace=workspace,
            agent=agent,
            actor=user,
            operation="chat",
            inputs={"message": str(index)},
            output=str(index),
            status="failed",
            conversation=conversation,
            idempotency_key=f"history-{index}",
        )
    rows = client.get(f"/api/v1/conversations/{conversation.pk}/turns/")
    assert [row["inputs"]["message"] for row in rows.data] == ["0", "1"]
    assert (
        client.post(
            f"/api/v1/runs/{rows.data[0]['id']}/retry/",
            {"idempotency_key": "denied"},
            format="json",
        ).status_code
        == 400
    )
    foreign = Conversation.objects.create(workspace=other, agent=outsider)
    assert client.get(f"/api/v1/conversations/{foreign.pk}/").status_code == 404
    assert client.get(f"/api/v1/conversations/{foreign.pk}/turns/").status_code == 404
    Membership.objects.filter(workspace=workspace, user=user).delete()
    assert client.get(f"/api/v1/conversations/{conversation.pk}/").status_code == 403


def test_conversation_context_is_bounded_and_immutable(environment):
    from apps.runs.models import Conversation
    from apps.runs.services import conversation_context

    _, user, workspace, _, agent, _, _ = environment
    conversation = Conversation.objects.create(workspace=workspace, agent=agent)
    for index in range(22):
        Run.objects.create(
            workspace=workspace,
            actor=user,
            agent=agent,
            operation="chat",
            conversation=conversation,
            inputs={"message": str(index)},
            output=f"answer-{index}",
            status="succeeded",
            idempotency_key=f"history-{index}",
        )
    messages = conversation_context(conversation)
    assert len(messages) == 40
    assert messages[0]["content"] == "2"
    historical = conversation.turns.first()
    historical.snapshot = {"conversation_messages": messages}
    historical.save(update_fields=["snapshot"])
    conversation.turns.filter(status="succeeded").update(output="changed")
    historical.refresh_from_db()
    assert historical.snapshot["conversation_messages"] == messages
    latest = conversation.turns.filter(status="succeeded").latest("created_at")
    Run.objects.filter(pk=latest.pk).update(output="x" * 60_001)
    assert conversation_context(conversation) == []


@pytest.mark.django_db(transaction=True)
def test_concurrent_retired_conversation_turns_accept_no_submission(environment):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from apps.runs.models import Conversation

    if connection.vendor != "postgresql":
        pytest.skip("Conversation submission locking requires PostgreSQL")
    conversation = Conversation.objects.create(workspace=environment[2], agent=environment[4])
    barrier = Barrier(2)

    def submit(index):
        close_old_connections()
        try:
            client = APIClient(HTTP_HOST="acme.example.test")
            client.force_authenticate(environment[1])
            barrier.wait(timeout=10)
            return client.post(
                "/api/v1/runs/",
                {
                    "agent": str(environment[4].pk),
                    "conversation": str(conversation.pk),
                    "operation": "chat",
                    "inputs": {"message": f"turn-{index}"},
                    "idempotency_key": f"concurrent-turn-{index}",
                },
                format="json",
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(submit, range(2)))
    assert statuses == [400, 400]
    assert conversation.turns.count() == 0


def test_archived_conversation_session_writes_stay_csrf_protected_and_disabled(environment):
    from apps.runs.models import Conversation

    client = APIClient(enforce_csrf_checks=True, HTTP_HOST="acme.example.test")
    client.force_login(environment[1])
    payload = {"agent": str(environment[4].pk), "title": "Session with CSRF"}
    assert client.post("/api/v1/conversations/", payload, format="json").status_code == 403
    csrf = client.get("/api/v1/session/").cookies["csrftoken"].value
    assert (
        client.post(
            "/api/v1/conversations/", payload, format="json", HTTP_X_CSRFTOKEN=csrf
        ).status_code
        == 405
    )
    conversation = Conversation.objects.create(workspace=environment[2], agent=environment[4])
    assert (
        client.patch(
            f"/api/v1/conversations/{conversation.pk}/",
            payload,
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        ).status_code
        == 405
    )


@pytest.mark.parametrize(
    "secret", ["provider-secret-123", 'quote"slash\\snow雪😀', "line\nfeed\tsecret"]
)
def test_cumulative_chat_snapshots_withhold_split_secrets_and_redact_final(environment, secret):
    import json

    from apps.credentials.services import redact, secret_variants
    from apps.runs.services import append_event, complete_run

    _, _, workspace, _, agent, _, _ = environment
    credential = Credential.objects.create(
        workspace=workspace,
        name="Stream model",
        encrypted_secret=encrypt({"api_key": "model-secret"}),
    )
    plugin_credential = Credential.objects.create(
        workspace=workspace, name="Stream plugin", encrypted_secret=encrypt({"token": secret})
    )
    agent.credential = credential
    agent.save()
    run = new_run(environment)
    run.snapshot["agents"][0]["plugins"] = [{"credential_id": str(plugin_credential.pk)}]
    run.save()
    sequence = 0
    for variant in secret_variants(run):
        # Every possible split, including a one-character-at-a-time provider stream.
        for length in range(1, len(variant) + 1):
            sequence += 1
            append_event(
                run,
                {
                    "sequence": sequence,
                    "kind": "chat.snapshot",
                    "data": {
                        "agent_id": str(agent.pk),
                        "round": 0,
                        "content": "Answer: " + variant[:length],
                    },
                },
            )
            visible = run.events.get(sequence=sequence).data["content"]
            assert visible == ("Answer: " if length < len(variant) else "Answer: [redacted]")
        # The next chunk releases ordinary suffix text while secrets remain masked.
        sequence += 1
        append_event(
            run,
            {
                "sequence": sequence,
                "kind": "chat.snapshot",
                "data": {
                    "agent_id": str(agent.pk),
                    "round": 1,
                    "content": "Answer: " + variant + " done!",
                },
            },
        )
        assert run.events.get(sequence=sequence).data["content"] == "Answer: [redacted] done!"
    variants = [secret, json.dumps(secret)[1:-1], json.dumps(secret, ensure_ascii=False)[1:-1]]
    append_event(
        run, {"sequence": sequence + 1, "kind": "chat.message", "data": {"content": variants}}
    )
    assert run.events.get(sequence=sequence + 1).data == {"content": ["[redacted]"] * 3}
    complete_run(run, {"status": "succeeded", "output": variants, "error": ""})
    run.refresh_from_db()
    assert run.output == ["[redacted]"] * 3
    assert redact(run, {"nested": variants}) == {"nested": ["[redacted]"] * 3}


def test_chat_snapshot_validation_and_duplicate_sequence(environment):
    from rest_framework.exceptions import ValidationError

    from apps.runs.services import append_event

    run = new_run(environment)
    valid = {
        "sequence": 1,
        "kind": "chat.snapshot",
        "data": {
            "agent_id": str(run.agent_id),
            "round": 0,
            "content": "Hello",
        },
    }
    append_event(run, valid)
    append_event(run, valid)
    assert run.events.count() == 1
    for bad in [
        {"round": 20},
        {"content": "x" * 60_001},
        {"agent_id": str(uuid4())},
        {"round": True},
    ]:
        with pytest.raises(ValidationError):
            append_event(run, {**valid, "sequence": 2, "data": {**valid["data"], **bad}})
    for sequence in range(2, 241):
        append_event(run, {**valid, "sequence": sequence})
    with pytest.raises(ValidationError, match="limit"):
        append_event(run, {**valid, "sequence": 241})


def completed_chat(env, key="feedback"):
    _, user, workspace, _, agent, _, _ = env
    run = Run.objects.create(
        workspace=workspace,
        actor=user,
        agent=agent,
        operation="chat",
        inputs={"message": "Hi"},
        idempotency_key=key,
    )
    run.status, run.output = "succeeded", "Hello"
    run.save()
    return run


def test_archived_chat_feedback_is_private_read_only_and_workspace_scoped(
    environment, django_user_model
):
    from apps.runs.models import ChatFeedback

    client, _, workspace, other_workspace, _, _, _ = environment
    run = completed_chat(environment)
    path = f"/api/v1/runs/{run.pk}/feedback/"
    assert client.get(path).data == {"feedback": None}
    ChatFeedback.objects.create(run=run, user=environment[1], rating="negative", note="Changed")
    assert client.put(path, {"rating": "positive"}, format="json").status_code == 405
    assert client.get(path).data["feedback"]["note"] == "Changed"
    colleague = django_user_model.objects.create_user(username="feedback-reader")
    membership = Membership.objects.create(workspace=workspace, user=colleague, role="member")
    other = APIClient(HTTP_HOST="acme.example.test")
    other.force_authenticate(colleague)
    assert other.get(path).data == {"feedback": None}
    ChatFeedback.objects.create(run=run, user=colleague, rating="positive", note="Own note")
    assert client.get(path).data["feedback"]["note"] == "Changed"
    assert client.delete(path).status_code == 405
    assert other.get(path).data["feedback"]["note"] == "Own note"
    assert other.get(path, HTTP_HOST="other.example.test").status_code == 403
    Membership.objects.create(workspace=other_workspace, user=colleague, role="member")
    assert other.get(path, HTTP_HOST="other.example.test").status_code == 404
    membership.delete()
    assert other.get(path).status_code == 403


def test_archived_feedback_writes_are_disabled_and_session_csrf_protected(environment):
    import json

    client, user, _, _, _, _, _ = environment
    run = completed_chat(environment)
    path = f"/api/v1/runs/{run.pk}/feedback/"
    for payload in [
        {"rating": "unknown"},
        {"rating": "positive", "note": "x" * 2001},
        {"rating": "positive", "note": "nul\0"},
        {"rating": "positive", "note": "\ud800"},
    ]:
        assert (
            client.put(path, json.dumps(payload), content_type="application/json").status_code
            == 405
        )
    session = APIClient(enforce_csrf_checks=True, HTTP_HOST="acme.example.test")
    session.force_login(user)
    bootstrap = session.get("/api/v1/session/")
    assert session.put(path, {"rating": "positive"}, format="json").status_code == 403
    token = bootstrap.cookies["csrftoken"].value
    assert (
        session.put(path, {"rating": "positive"}, format="json", HTTP_X_CSRFTOKEN=token).status_code
        == 405
    )
    assert session.delete(path).status_code == 403
    assert session.delete(path, HTTP_X_CSRFTOKEN=token).status_code == 405
    for status in ["running", "failed", "cancelled", "interrupted"]:
        Run.objects.filter(pk=run.pk).update(status=status)
        assert client.put(path, {"rating": "positive"}, format="json").status_code == 405
    action = new_run(environment, key="action-feedback")
    Run.objects.filter(pk=action.pk).update(status="succeeded")
    assert (
        client.put(
            f"/api/v1/runs/{action.pk}/feedback/", {"rating": "positive"}, format="json"
        ).status_code
        == 405
    )


def test_feedback_scope_and_executor_denial(environment):
    client, user, workspace, _, _, _, _ = environment
    run = completed_chat(environment)
    path = f"/api/v1/runs/{run.pk}/feedback/"
    token = client.post(
        "/api/v1/tokens/", {"name": "Read feedback", "scopes": ["read"]}, format="json"
    ).data["token"]
    machine = APIClient(HTTP_HOST="acme.example.test", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert machine.get(path).status_code == 200
    assert machine.put(path, {"rating": "positive"}, format="json").status_code == 403
    new_run(environment, key="feedback-capability")
    worker, _, _ = claim(environment)
    assert worker.get(f"/internal/execution/v1/product/runs/{run.pk}/feedback/").status_code == 403


@pytest.mark.django_db(transaction=True)
def test_archived_feedback_concurrent_writes_create_no_records(environment):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from apps.runs.models import ChatFeedback

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent feedback writes require PostgreSQL row locks.")
    _, user, _, _, _, _, _ = environment
    run = completed_chat(environment)
    barrier = Barrier(2)

    def save(index):
        close_old_connections()
        try:
            client = APIClient(HTTP_HOST="acme.example.test")
            client.force_authenticate(user)
            barrier.wait(timeout=10)
            return client.put(
                f"/api/v1/runs/{run.pk}/feedback/",
                {"rating": "positive", "note": str(index)},
                format="json",
            ).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(save, range(2))) == [405, 405]
    assert ChatFeedback.objects.filter(run=run, user=user).count() == 0
