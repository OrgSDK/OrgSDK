import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_origin_migration_preserves_historical_chat_and_snapshot_without_attribution():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    before = [("runs", "0007_alter_run_operation")]
    executor.migrate(before)
    try:
        state = executor.loader.project_state(before).apps
        workspace = state.get_model("workspaces", "Workspace").objects.create(name="Historical")
        actor = state.get_model("accounts", "User").objects.create(username="origin-history")
        project = state.get_model("agents", "Agent").objects.create(
            workspace=workspace, name="Preserved project", model="historical-model"
        )
        snapshot = {"agents": [{"id": str(project.pk), "model": "historical-model"}]}
        original = state.get_model("runs", "Run").objects.create(
            workspace=workspace,
            actor=actor,
            agent=project,
            operation="chat",
            status="running",
            idempotency_key="historic",
            inputs={"message": "Preserved input"},
            snapshot=snapshot,
        )
        executor = MigrationExecutor(connection)
        executor.migrate(latest)
        state = executor.loader.project_state(latest).apps
        retained = state.get_model("runs", "Run").objects.get(pk=original.pk)
        assert retained.origin == "legacy" and retained.origin_reference == ""
        assert retained.status == "running"
        assert retained.agent_id == project.pk
        assert retained.snapshot == snapshot
        assert retained.inputs == original.inputs
        assert retained.client_token_id is None
    finally:
        MigrationExecutor(connection).migrate(latest)
