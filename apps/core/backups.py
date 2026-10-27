"""Consistent SQLite snapshots; never copy a live WAL database as a lone file."""

import sqlite3
from contextlib import closing
from pathlib import Path


def verify_database(path):
    with closing(sqlite3.connect(f"file:{Path(path).resolve()}?mode=ro", uri=True)) as database:
        if database.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("SQLite integrity check failed")
        if database.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("SQLite foreign key check failed")
        if not database.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='django_migrations'"
        ).fetchone():
            raise ValueError("Not an OrgSDK database backup")


def snapshot_database(source, destination):
    with (
        closing(
            sqlite3.connect(f"file:{Path(source).resolve()}?mode=ro", uri=True)
        ) as source_database,
        closing(sqlite3.connect(destination)) as destination_database,
    ):
        source_database.backup(destination_database)
    verify_database(destination)
