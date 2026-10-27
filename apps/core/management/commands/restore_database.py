import fcntl
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from apps.core.backups import verify_database


class Command(BaseCommand):
    requires_system_checks = []
    help = "Restore a SQLite backup from stdin into an empty, stopped installation."

    def handle(self, *args, **options):
        database = Path(connection.settings_dict["NAME"])
        with (database.parent / "api.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise CommandError("Stop the API before restoring.") from error
            if database.exists() and database.stat().st_size:
                raise CommandError("Refusing to overwrite a nonempty database.")
            descriptor, temporary = tempfile.mkstemp(dir=database.parent, prefix=".restore-")
            snapshot = Path(temporary)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    shutil.copyfileobj(sys.stdin.buffer, stream)
                    stream.flush()
                    os.fsync(stream.fileno())
                try:
                    verify_database(snapshot)
                except (sqlite3.DatabaseError, ValueError) as error:
                    raise CommandError("Invalid SQLite backup.") from error
                connection.close()
                os.replace(snapshot, database)
                directory_fd = os.open(database.parent, os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            finally:
                snapshot.unlink(missing_ok=True)
        self.stdout.write("SQLite database restored. Start the server to apply migrations.")
