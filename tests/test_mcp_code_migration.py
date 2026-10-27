"""Forward migration preserves historical authority and accepted execution records."""

import pytest
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_scoped_client_migrations_preserve_legacy_tokens_and_runs():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    before = [
        ("api_access", "0002_accesstoken_error_count_accesstoken_first_used_at_and_more"),
        ("runs", "0004_chatfeedback"),
    ]
    executor.migrate(before)
    try:
        state = executor.loader.project_state(before).apps
        Workspace = state.get_model("workspaces", "Workspace")
        Agent = state.get_model("agents", "Agent")
        User = state.get_model("accounts", "User")
        Token = state.get_model("api_access", "AccessToken")
        Action = state.get_model("actions", "Action")
        Version = state.get_model("actions", "ActionVersion")
        Run = state.get_model("runs", "Run")
        workspace = Workspace.objects.create(name="Historical")
        agent = Agent.objects.create(workspace=workspace, name="Project")
        actor = User.objects.create(username="historical-mcp")
        token = Token.objects.create(
            workspace=workspace,
            actor=actor,
            name="Legacy",
            digest="a" * 64,
            scopes=["read", "write"],
            request_count=7,
        )
        action = Action.objects.create(workspace=workspace, agent=agent, name="Saved")
        version = Version.objects.create(action=action, number=1, source="return 42;")
        snapshot = {
            "source": "return 42;",
            "version": 1,
            "agents": [
                {
                    "id": str(agent.pk),
                    "plugins": [{"version": "old", "configuration": {"pinned": True}}],
                }
            ],
        }
        original = Run.objects.create(
            workspace=workspace,
            actor=actor,
            agent=agent,
            operation="action",
            action_version=version,
            snapshot=snapshot,
            inputs={"keep": True},
            status="succeeded",
            output=42,
            idempotency_key="existing",
        )
        executor = MigrationExecutor(connection)
        executor.migrate(latest)
        state = executor.loader.project_state(latest).apps
        Token = state.get_model("api_access", "AccessToken")
        Run = state.get_model("runs", "Run")
        preserved = Token.objects.get(pk=token.pk)
        assert preserved.digest == token.digest
        assert preserved.scopes == ["read", "write"]
        assert preserved.request_count == 7
        assert not preserved.projects.exists()
        assert not preserved.action_versions.exists()
        retained = Run.objects.get(pk=original.pk)
        assert retained.snapshot == snapshot
        assert retained.output == 42
        assert retained.inputs == {"keep": True}
        assert retained.action_version_id == version.pk
        assert retained.client_token_id is None
        assert retained.idempotency_namespace == ""
        values = {
            "workspace_id": workspace.pk,
            "actor_id": actor.pk,
            "agent_id": agent.pk,
            "operation": "action",
            "action_version_id": version.pk,
            "idempotency_key": "existing",
        }
        with pytest.raises(IntegrityError), transaction.atomic():
            Run.objects.create(**values)
        scoped = Run.objects.create(
            **values, client_token_id=token.pk, idempotency_namespace=str(token.pk)
        )
        assert scoped.pk != retained.pk
        with pytest.raises(IntegrityError), transaction.atomic():
            Run.objects.create(
                **values, client_token_id=token.pk, idempotency_namespace=str(token.pk)
            )
    finally:
        MigrationExecutor(connection).migrate(latest)
