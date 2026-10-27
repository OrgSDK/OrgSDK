"""The ownership migration preserves shared and unassigned legacy installations."""

from uuid import uuid4

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_plugin_ownership_migration_preserves_legacy_records():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    before = [
        ("actions", "0003_plugin_configuration_plugin_distribution"),
        ("agents", "0001_initial"),
    ]
    executor.migrate(before)
    try:
        state = executor.loader.project_state(before).apps
        Workspace = state.get_model("workspaces", "Workspace")
        Agent = state.get_model("agents", "Agent")
        Plugin = state.get_model("actions", "Plugin")
        Credential = state.get_model("credentials", "Credential")
        workspace = Workspace.objects.create(name="Migration")
        first = Agent.objects.create(workspace=workspace, name="First")
        second = Agent.objects.create(workspace=workspace, name="Second")
        credential = Credential.objects.create(
            workspace=workspace,
            name="Preserved credential",
            provider="custom",
            encrypted_secret="retained ciphertext",
        )
        shared = Plugin.objects.create(
            workspace=workspace,
            slug="shared",
            version="1",
            source="source",
            digest="a" * 64,
            configuration={"keep": "value"},
            description="Keep description",
            credential=credential,
        )
        first.plugins.add(shared)
        second.plugins.add(shared)
        legacy_bundle = Plugin.objects.create(
            workspace=workspace,
            slug="legacy-bundle",
            version="old-release",
            distribution="bundled",
            source="old-bundle-source",
            digest="c" * 64,
            configuration={"keep": "bundle settings"},
            enabled=True,
        )
        first.plugins.add(legacy_bundle)
        second.plugins.add(legacy_bundle)
        unassigned_id = uuid4()
        Plugin.objects.create(
            pk=unassigned_id,
            workspace=workspace,
            slug="unassigned",
            version="1",
            source="old",
            digest="b" * 64,
        )
        executor = MigrationExecutor(connection)
        executor.migrate(latest)
        state = executor.loader.project_state(latest).apps
        Plugin = state.get_model("actions", "Plugin")
        copies = Plugin.objects.filter(slug="shared")
        assert copies.count() == 2
        assert set(copies.values_list("agent_id", flat=True)) == {first.pk, second.pk}
        assert all(p.configuration == {"keep": "value"} and p.source == "source" for p in copies)
        assert all(
            p.digest == "a" * 64
            and p.description == "Keep description"
            and p.version == "1"
            and p.enabled
            for p in copies
        )
        bundles = Plugin.objects.filter(slug="legacy-bundle")
        assert bundles.count() == 2
        assert set(bundles.values_list("agent_id", flat=True)) == {first.pk, second.pk}
        assert all(
            not p.enabled
            and p.distribution == "bundled"
            and p.source == "old-bundle-source"
            and p.digest == "c" * 64
            and p.version == "old-release"
            and p.configuration == {"keep": "bundle settings"}
            for p in bundles
        )
        unassigned = Plugin.objects.get(pk=unassigned_id)
        assert unassigned.agent_id is None
        assert not unassigned.enabled
        assert unassigned.source == "old"
    finally:
        MigrationExecutor(connection).migrate(latest)


@pytest.mark.django_db(transaction=True)
def test_conversation_migration_preserves_independent_chat_history():
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    before = [("runs", "0002_run_parent")]
    executor.migrate(before)
    try:
        state = executor.loader.project_state(before).apps
        Workspace = state.get_model("workspaces", "Workspace")
        Agent = state.get_model("agents", "Agent")
        User = state.get_model("accounts", "User")
        Run = state.get_model("runs", "Run")
        workspace = Workspace.objects.create(name="Conversation migration")
        agent = Agent.objects.create(workspace=workspace, name="Helper")
        user = User.objects.create(username="legacy-chat")
        values = dict(
            workspace=workspace,
            agent=agent,
            actor=user,
            operation="chat",
            inputs={"message": "Preserved prompt"},
            snapshot={"keep": "snapshot"},
        )
        original = Run.objects.create(
            **values, idempotency_key="original", status="succeeded", output="Preserved answer"
        )
        delegated = Run.objects.create(**values, idempotency_key="child", parent=original)
        executor = MigrationExecutor(connection)
        executor.migrate(latest)
        state = executor.loader.project_state(latest).apps
        Run = state.get_model("runs", "Run")
        original_after = Run.objects.get(pk=original.pk)
        conversation = original_after.conversation
        assert conversation.agent_id == agent.pk
        assert conversation.workspace_id == workspace.pk
        assert conversation.title == "Preserved prompt"
        assert conversation.created_at == original.created_at
        assert conversation.updated_at == original.updated_at
        assert original_after.snapshot == original.snapshot
        assert original_after.output == "Preserved answer"
        assert Run.objects.get(pk=delegated.pk).conversation_id is None
    finally:
        MigrationExecutor(connection).migrate(latest)
