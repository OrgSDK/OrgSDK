import os
import subprocess
import sys
from textwrap import dedent

import pytest
from django.apps import apps
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.db import connection


@pytest.mark.django_db
def test_current_schema_uses_domain_tables_and_permissions():
    tables = set(connection.introspection.table_names())
    assert not any(table.startswith(("product_", "billing_", "waffle_")) for table in tables)
    assert "product" not in apps.app_configs
    assert not ContentType.objects.filter(app_label="product").exists()
    for config in apps.get_app_configs():
        if not config.name.startswith("apps."):
            continue
        for model in config.get_models():
            assert model._meta.db_table in tables
            content_type = ContentType.objects.get_for_model(model)
            assert content_type.app_label == config.label
            for action in model._meta.default_permissions:
                assert Permission.objects.filter(
                    content_type=content_type, codename=f"{action}_{model._meta.model_name}"
                ).exists()
    with connection.cursor() as cursor:
        columns = connection.introspection.get_table_description(cursor, "documents_document")
        constraints = connection.introspection.get_constraints(cursor, "runs_run")
    assert "agent_id" not in {column.name for column in columns}
    assert constraints["run_idempotency"]["unique"]
    assert set(constraints["run_idempotency"]["columns"]) == {
        "workspace_id",
        "idempotency_namespace",
        "idempotency_key",
    }


def test_empty_sqlite_install_and_repeat_migrate_preserve_current_records(tmp_path):
    script = dedent("""
        import sys
        import django
        from django.conf import settings
        from config.database import sqlite_database
        settings.DATABASES = {"default": sqlite_database(sys.argv[1])}
        django.setup()
        from django.core.management import call_command
        from django.contrib.auth import get_user_model
        from django.db import connection
        from django.db.migrations.executor import MigrationExecutor
        call_command("migrate", interactive=False, verbosity=0)
        from apps.workspaces.models import Workspace, Membership, Domain
        from apps.documents.models import Document
        workspace = Workspace.objects.create(name="Fresh installation")
        user = get_user_model().objects.create_user(
            username="owner", email="owner@example.test"
        )
        Membership.objects.create(workspace=workspace, user=user, role="owner")
        Domain.objects.create(workspace=workspace, hostname="fresh.example.test")
        document = Document.objects.create(
            workspace=workspace, kind="memory", title="Independent", content="Keep this"
        )
        call_command("migrate", interactive=False, verbosity=0)
        assert Document.objects.get(pk=document.pk).content == "Keep this"
        assert workspace.memberships.get().user_id == user.pk
        assert "core_backgroundjob" in connection.introspection.table_names()
        assert not any("procrastinate" in table for table in connection.introspection.table_names())
        assert connection.vendor == "sqlite"
        executor = MigrationExecutor(connection)
        assert not executor.migration_plan(executor.loader.graph.leaf_nodes())
        assert not any(node[0] == "product" for node in executor.loader.graph.nodes)
    """)
    subprocess.run(
        [sys.executable, "-c", script, str(tmp_path / "fresh.sqlite3")],
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings.test"},
    )
