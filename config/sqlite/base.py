from contextlib import closing

from django.db.backends.sqlite3.base import DatabaseWrapper as SQLiteDatabaseWrapper
from django.db.backends.sqlite3.features import DatabaseFeatures as SQLiteDatabaseFeatures
from django.db.backends.sqlite3.operations import DatabaseOperations as SQLiteDatabaseOperations
from django.utils.functional import cached_property


class DatabaseFeatures(SQLiteDatabaseFeatures):
    @cached_property
    def compile_options(self):
        # The bundled driver has no getlimit()/setlimit(); its limits stay at build defaults.
        with self.connection.cursor() as cursor:
            return dict(
                row[0].split("=", 1)
                for row in cursor.execute("PRAGMA compile_options")
                if "=" in row[0]
            )

    @cached_property
    def max_query_params(self):
        return int(self.compile_options.get("MAX_VARIABLE_NUMBER", 32766))


class DatabaseOperations(SQLiteDatabaseOperations):
    def _quote_params_for_last_executed_query(self, params):
        column_limit = int(self.connection.features.compile_options.get("MAX_COLUMN", 2000))
        batch_size = min(self.connection.features.max_query_params, column_limit)
        if len(params) > batch_size:
            return tuple(
                value
                for start in range(0, len(params), batch_size)
                for value in self._quote_params_for_last_executed_query(
                    params[start : start + batch_size]
                )
            )
        # A raw cursor avoids recursively recording the debug formatting query.
        with closing(self.connection.connection.cursor()) as cursor:
            sql = "SELECT " + ", ".join(["QUOTE(?)"] * len(params))
            return cursor.execute(sql, params).fetchone()


class DatabaseWrapper(SQLiteDatabaseWrapper):
    features_class = DatabaseFeatures
    ops_class = DatabaseOperations
