import pytest
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APIClient

from apps.actions.authoring import (
    get_tests,
    promote_run,
    save_action,
    save_tests,
    validate_contract,
    validate_schema,
)
from apps.actions.models import Action, ActionVersion
from apps.actions.services import save_version
from apps.agents.models import Agent
from apps.api_access.models import AccessToken
from apps.core.tokens import digest
from apps.runs.authoring import run_tests, validate_code
from apps.runs.services import complete_run, create_run
from apps.workspaces.models import Domain, Membership, Workspace

pytestmark = pytest.mark.django_db


@pytest.fixture
def author(user, settings):
    settings.WORKSPACE_DOMAIN_ROUTING = True
    workspace = Workspace.objects.create(name="Authoring")
    Domain.objects.create(workspace=workspace, hostname="testserver")
    Membership.objects.create(workspace=workspace, user=user, role="owner")
    agent = Agent.objects.create(workspace=workspace, name="Project")
    token = AccessToken.objects.create(
        workspace=workspace,
        actor=user,
        name="Author",
        digest=digest("author"),
        scopes=[
            "catalog:read",
            "actions:write",
            "actions:test",
            "actions:run",
            "code:execute",
            "runs:read",
        ],
    )
    token.projects.add(agent)
    return workspace, user, agent, token


def draft(author, **kwargs):
    workspace, user, agent, token = author
    return save_action(
        workspace=workspace,
        actor=user,
        token=token,
        agent=agent,
        name="Draft",
        source="return actionParams.value",
        input_schema={
            "type": "object",
            "properties": {"value": {"type": "integer"}},
            "required": ["value"],
        },
        output_schema={"type": "integer"},
        **kwargs,
    )


def suite(author, action, version, expected=2):
    workspace, user, _, token = author
    return save_tests(
        workspace=workspace,
        actor=user,
        token=token,
        action_id=action.pk,
        number=version.number,
        cases=[{"name": "double", "inputs": {"value": 2}, "expected": expected, "mocks": []}],
    )


def test_draft_versions_are_immutable_and_historical_versions_remain_legacy(author):
    workspace, _, agent, _ = author
    historical = Action.objects.create(workspace=workspace, agent=agent, name="Existing")
    old = ActionVersion.objects.create(action=historical, number=1, source="return 1")
    new = save_version(historical, "return 1", {}, {"type": "integer"})
    assert new.number == 2 and new.validation_mode == "semantic"
    old.refresh_from_db()
    assert old.output_schema == {} and old.validation_mode == "legacy"
    assert save_version(historical, "return 1", {}, {"type": "integer"}).pk == new.pk
    next_version = save_version(historical, "return 2", {}, {"type": "integer"})
    assert next_version.number == 3
    new.refresh_from_db()
    assert new.source == "return 1"


@pytest.mark.parametrize(
    "schema",
    [
        {"$ref": "https://example.test/schema"},
        {"$dynamicRef": "file:///etc/passwd"},
        {"type": "not-a-type"},
    ],
)
def test_schemas_reject_remote_resolution_and_invalid_contracts(schema):
    with pytest.raises(ValidationError):
        validate_schema(schema)


def test_checks_reject_historical_references_before_resolving_them():
    with pytest.raises(ValidationError, match="reference keywords"):
        validate_contract({"$ref": "https://example.test/private-schema"}, {}, "inputs")


def test_local_schema_reference_is_rejected():
    with pytest.raises(ValidationError, match="inline JSON Schemas"):
        validate_schema({"$defs": {"number": {"type": "integer"}}, "$ref": "#/$defs/number"})


def test_test_suites_are_revisioned_pinned_and_expected_is_checked(author):
    workspace, user, _, token = author
    action, version = draft(author)
    first = suite(author, action, version)
    assert suite(author, action, version).pk == first.pk
    second = suite(author, action, version, expected=3)
    assert second.number == 2 and first.number == 1
    assert (
        get_tests(
            workspace=workspace, token=token, action_id=action.pk, number=version.number, revision=1
        ).cases[0]["expected"]
        == 2
    )
    with pytest.raises(ValidationError):
        suite(author, action, version, expected="bad")
    run = run_tests(
        workspace=workspace,
        actor=user,
        token=token,
        action_id=action.pk,
        number=version.number,
        suite_revision=1,
        key="tests",
    )
    assert run.snapshot["test_suite"]["id"] == str(first.pk)
    assert run.snapshot["source"] == version.source
    with pytest.raises(ValidationError):
        run_tests(
            workspace=workspace,
            actor=user,
            token=token,
            action_id=action.pk,
            number=version.number,
            suite_revision=2,
            key="tests",
        )


def test_validation_and_test_jobs_have_no_live_authority(author):
    workspace, user, agent, token = author
    validation = validate_code(
        workspace=workspace,
        actor=user,
        token=token,
        project_id=agent.pk,
        source="return 1",
        key="validate",
    )
    assert validation.operation == "validate" and validation.snapshot["protocol_version"] == 3
    selected = validation.snapshot["agents"][0]
    assert (
        selected["model"] == "" and selected["credential_id"] is None and selected["plugins"] == []
    )
    assert selected["resources"] == {
        "tables": {"read": [], "write": []},
        "documents": {"read": [], "write": []},
    }
    assert validation.snapshot["sdk"]["sdk_revision"]


def test_legacy_keys_cannot_create_new_jobs_or_promote(author):
    workspace, user, agent, token = author
    action, version = draft(author)
    suite(author, action, version)
    token.scopes = ["read", "write"]
    token.save()
    with pytest.raises(PermissionDenied):
        validate_code(
            workspace=workspace,
            actor=user,
            token=token,
            project_id=agent.pk,
            source="return 1",
            key="blocked-validate",
        )
    with pytest.raises(PermissionDenied):
        run_tests(
            workspace=workspace,
            actor=user,
            token=token,
            action_id=action.pk,
            number=version.number,
            suite_revision=1,
            key="blocked-test",
        )


def test_promotion_preserves_source_not_input_defaults_and_requires_own_read(author):
    workspace, user, agent, token = author
    source = "\nreturn actionParams.value;\n"
    run = create_run(
        workspace=workspace,
        actor=user,
        agent=agent,
        operation="code",
        inputs={"value": 9},
        key="one-off",
        source=source,
        client_token=token,
    )
    action, version = promote_run(
        workspace=workspace,
        actor=user,
        token=token,
        run=run,
        name="Promoted",
        input_schema={"type": "object"},
        output_schema={"type": "integer"},
    )
    assert version.source == source and version.promoted_from_id == run.pk
    assert "default" not in version.input_schema
    assert version.sdk_contract["configuration_revision"] == run.snapshot["configuration_revision"]
    token.scopes.remove("runs:read")
    token.save()
    with pytest.raises(PermissionDenied):
        promote_run(
            workspace=workspace,
            actor=user,
            token=token,
            run=run,
            name="Denied",
            input_schema={},
            output_schema={},
        )


def test_action_output_contract_rejects_bad_success_but_not_test_reports(author):
    workspace, user, agent, token = author
    action, version = draft(author)
    run = create_run(
        workspace=workspace,
        actor=user,
        agent=agent,
        operation="action",
        inputs={"value": 1},
        key="production",
        version=version,
        client_token=token,
    )
    with pytest.raises(ValidationError):
        complete_run(run, {"status": "succeeded", "output": {"result": "invalid"}, "error": ""})
    run.refresh_from_db()
    assert run.status == "queued"
    complete_run(run, {"status": "succeeded", "output": {"result": 1}, "error": ""})
    suite(author, action, version)
    test = run_tests(
        workspace=workspace,
        actor=user,
        token=token,
        action_id=action.pk,
        number=version.number,
        suite_revision=1,
        key="test-report",
    )
    complete_run(test, {"status": "succeeded", "output": {"result": {"passed": True}}, "error": ""})
    assert test.status == "succeeded"


def test_action_authoring_rest_endpoints(author):
    _, _, agent, _ = author
    client = APIClient(HTTP_AUTHORIZATION="Bearer author")
    saved = client.post(
        "/api/v1/actions/save-action/",
        {
            "agent": str(agent.pk),
            "name": "REST draft",
            "source": "return 1",
            "input_schema": {},
            "output_schema": {"type": "integer"},
        },
        format="json",
    )
    assert saved.status_code == 201, saved.data
    action_id = saved.data["action"]
    assert client.get(f"/api/v1/actions/{action_id}/version/?version=1").status_code == 200
    tests = client.post(
        f"/api/v1/actions/{action_id}/tests/",
        {"version": 1, "cases": [{"name": "one", "inputs": {}, "expected": 1}]},
        format="json",
    )
    assert tests.status_code == 200, tests.data
    queued = client.post(
        f"/api/v1/actions/{action_id}/run-tests/",
        {"version": 1, "suite_revision": 1, "idempotency_key": "rest-test"},
        format="json",
    )
    assert queued.status_code == 201, queued.data


def test_version_only_grant_can_test_only_the_selected_version(author):
    workspace, user, agent, token = author
    action, first = draft(author)
    second = save_version(action, "return 3", {}, {"type": "integer"})
    suite(author, action, first)
    token.projects.clear()
    token.action_versions.add(first)
    run = run_tests(
        workspace=workspace,
        actor=user,
        token=token,
        action_id=action.pk,
        number=1,
        suite_revision=1,
        key="exact-version",
    )
    assert run.action_version_id == first.pk
    from django.http import Http404

    with pytest.raises(Http404):
        run_tests(
            workspace=workspace,
            actor=user,
            token=token,
            action_id=action.pk,
            number=second.number,
            suite_revision=1,
            key="excluded-version",
        )
    with pytest.raises((Http404, PermissionDenied)):
        save_tests(
            workspace=workspace,
            actor=user,
            token=token,
            action_id=action.pk,
            number=first.number,
            cases=[{"name": "blocked", "inputs": {"value": 1}, "expected": 1}],
        )
    with pytest.raises(PermissionDenied):
        validate_code(
            workspace=workspace,
            actor=user,
            token=token,
            project_id=agent.pk,
            source="return 1",
            key="outside-project",
        )


def test_test_retry_preserves_suite_snapshot_and_checks_current_scope(author):
    workspace, user, _, token = author
    action, version = draft(author)
    suite(author, action, version)
    original = run_tests(
        workspace=workspace,
        actor=user,
        token=token,
        action_id=action.pk,
        number=1,
        suite_revision=1,
        key="retry-original",
    )
    original.status = "failed"
    original.save()
    suite(author, action, version, expected=4)
    retry = create_run(
        workspace=workspace,
        actor=user,
        agent=original.agent,
        operation="test",
        inputs=original.inputs,
        key="retry-1",
        version=original.action_version,
        retry_of=original,
        client_token=token,
    )
    assert retry.snapshot == original.snapshot
    token.scopes.remove("actions:test")
    token.save()
    with pytest.raises(PermissionDenied):
        create_run(
            workspace=workspace,
            actor=user,
            agent=original.agent,
            operation="test",
            inputs={},
            key="retry-denied",
            version=version,
            retry_of=original,
            client_token=token,
        )


def test_foreign_project_and_other_client_run_are_private(author):
    from django.http import Http404

    workspace, user, agent, token = author
    other_project = Agent.objects.create(workspace=workspace, name="Private project")
    other_action = Action.objects.create(
        workspace=workspace, agent=other_project, name="Private action"
    )
    other_version = save_version(other_action, "return 1", {})
    with pytest.raises((Http404, PermissionDenied)):
        save_tests(
            workspace=workspace,
            actor=user,
            token=token,
            action_id=other_action.pk,
            number=other_version.number,
            cases=[{"name": "private", "inputs": {}, "expected": 1}],
        )
    run = create_run(
        workspace=workspace,
        actor=user,
        agent=agent,
        operation="code",
        inputs={},
        key="private-code",
        source="return 1",
    )
    with pytest.raises(Http404):
        promote_run(
            workspace=workspace,
            actor=user,
            token=token,
            run=run,
            name="No",
            input_schema={},
            output_schema={},
        )


def test_validation_rest_session_needs_csrf(author):
    _, user, agent, _ = author
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)
    body = {"project": str(agent.pk), "source": "return 1", "idempotency_key": "session-validation"}
    assert client.post("/api/v1/actions/validate-code/", body, format="json").status_code == 403
    csrf = client.get("/api/v1/session/").cookies["csrftoken"].value
    response = client.post(
        "/api/v1/actions/validate-code/", body, format="json", HTTP_X_CSRFTOKEN=csrf
    )
    assert response.status_code == 201, response.data


def test_version_only_test_scope_works_through_rest(author):
    _, _, _, token = author
    action, version = draft(author)
    suite(author, action, version)
    token.projects.clear()
    token.action_versions.add(version)
    token.scopes = ["actions:test", "runs:read"]
    token.save()
    client = APIClient(HTTP_AUTHORIZATION="Bearer author")
    response = client.post(
        f"/api/v1/actions/{action.pk}/run-tests/",
        {"version": 1, "suite_revision": 1, "idempotency_key": "version-rest"},
        format="json",
    )
    assert response.status_code == 201, response.data


@pytest.mark.parametrize("value", [{"key": "nul\x00value"}, {"nul\x00key": "value"}])
def test_authoring_json_rejects_nul_for_postgres(value):
    from apps.actions.authoring import bounded_json

    with pytest.raises(ValidationError, match="NUL"):
        bounded_json(value)


@pytest.mark.django_db(transaction=True)
def test_action_contract_migration_preserves_saved_versions():
    from django.db import connection
    from django.db.migrations.executor import MigrationExecutor

    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    before = [("actions", "0006_webhook_webhookdelivery"), ("runs", "0006_alter_run_operation")]
    executor.migrate(before)
    try:
        state = executor.loader.project_state(before).apps
        workspace = state.get_model("workspaces", "Workspace").objects.create(name="Old contracts")
        agent = state.get_model("agents", "Agent").objects.create(
            workspace=workspace, name="Original"
        )
        action = state.get_model("actions", "Action").objects.create(
            workspace=workspace, agent=agent, name="Retained"
        )
        source = "\nreturn actionParams.old;\n"
        old_schema = {"$ref": "https://example.test/historical-schema"}
        original = state.get_model("actions", "ActionVersion").objects.create(
            action=action, number=8, source=source, input_schema=old_schema
        )
        original_id = original.pk
        original_created = original.created_at
        executor = MigrationExecutor(connection)
        executor.migrate(latest)
        current = (
            executor.loader.project_state(latest)
            .apps.get_model("actions", "ActionVersion")
            .objects.get(pk=original_id)
        )
        assert current.source == source and current.input_schema == old_schema
        assert current.number == 8 and current.created_at == original_created
        assert current.validation_mode == "legacy" and current.output_schema == {}
        assert current.promoted_from_id is None and current.sdk_contract == {}
    finally:
        MigrationExecutor(connection).migrate(latest)
