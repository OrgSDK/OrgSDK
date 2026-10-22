from django.db import connections


class QueueMigrationRouter:
    """PostgreSQL queue SQL is deliberately excluded from SQLite unit databases."""

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if app_label == "procrastinate":
            return connections[db].vendor == "postgresql"
        return None
