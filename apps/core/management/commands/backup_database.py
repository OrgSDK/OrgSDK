import shutil
import sys
import tempfile
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import connection

from apps.core.backups import snapshot_database


class Command(BaseCommand):
    requires_system_checks = []
    help = "Stream a verified SQLite snapshot to standard output."

    def handle(self, *args, **options):
        with tempfile.TemporaryDirectory(prefix="orgsdk-backup-") as directory:
            snapshot = Path(directory) / "backup.sqlite3"
            snapshot_database(connection.settings_dict["NAME"], snapshot)
            with snapshot.open("rb") as stream:
                shutil.copyfileobj(stream, sys.stdout.buffer)
