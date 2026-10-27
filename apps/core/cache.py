from django.core.cache.backends.base import DEFAULT_TIMEOUT
from django.core.cache.backends.db import DatabaseCache
from django.db import connections, router, transaction


class SharedDatabaseCache(DatabaseCache):
    """Keep expired-key add atomic for consumers such as allauth's cache locks."""

    def add(self, key, value, timeout=DEFAULT_TIMEOUT, version=None):
        database = router.db_for_write(self.cache_model_class)
        # BEGIN IMMEDIATE covers absent and expired keys before DatabaseCache reads them.
        with transaction.atomic(using=database):
            return super().add(key, value, timeout=timeout, version=version)

    def _cull(self, database, cursor, now, num):
        # Authentication throttle history and live lock keys must survive pressure.
        # The cache may exceed MAX_ENTRIES until entries expire.
        connection = connections[database]
        quote = connection.ops.quote_name
        cursor.execute(
            f"DELETE FROM {quote(self._table)} WHERE {quote('expires')} < %s",
            [connection.ops.adapt_datetimefield_value(now)],
        )

    def delete_expired(self):
        from django.utils import timezone

        database = router.db_for_write(self.cache_model_class)
        with connections[database].cursor() as cursor:
            self._cull(database, cursor, timezone.now(), 0)
