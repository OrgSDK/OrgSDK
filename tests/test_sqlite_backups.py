import fcntl
import os
import sqlite3
import subprocess
import sys

from apps.core.backups import snapshot_database, verify_database


def run_command(name, database, data=None):
    return subprocess.run(
        [sys.executable, "manage.py", name, "--settings=config.settings.test"],
        env={**os.environ, "TEST_SQLITE_PATH": str(database)},
        input=data,
        capture_output=True,
        check=False,
    )


def source_database(path):
    database = sqlite3.connect(path)
    database.execute("PRAGMA journal_mode=WAL")
    database.execute("CREATE TABLE django_migrations (id INTEGER PRIMARY KEY)")
    database.execute("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT)")
    database.execute("INSERT INTO records VALUES (1, 'uncheckpointed data')")
    database.commit()
    return database


def test_snapshot_and_streamed_backup_include_committed_wal_data(tmp_path):
    source = tmp_path / "source.sqlite3"
    with source_database(source) as database:
        snapshot = tmp_path / "snapshot.sqlite3"
        snapshot_database(source, snapshot)
        result = run_command("backup_database", source)
        assert result.returncode == 0, result.stderr.decode()
        assert result.stdout.startswith(b"SQLite format 3")
        streamed = tmp_path / "streamed.sqlite3"
        streamed.write_bytes(result.stdout)
        for path in (snapshot, streamed):
            verify_database(path)
            with sqlite3.connect(path) as restored:
                assert restored.execute("SELECT value FROM records").fetchone() == (
                    "uncheckpointed data",
                )
        assert database.execute("SELECT value FROM records").fetchone()[0] == "uncheckpointed data"


def test_restore_verifies_before_installing_and_refuses_overwrite(tmp_path):
    source = tmp_path / "source.sqlite3"
    source_database(source).close()
    snapshot = tmp_path / "snapshot.sqlite3"
    snapshot_database(source, snapshot)
    target = tmp_path / "target.sqlite3"
    result = run_command("restore_database", target, snapshot.read_bytes())
    assert result.returncode == 0, result.stderr.decode()
    verify_database(target)
    assert target.stat().st_mode & 0o777 == 0o600
    original = target.read_bytes()
    result = run_command("restore_database", target, snapshot.read_bytes())
    assert result.returncode != 0 and b"nonempty" in result.stderr
    assert target.read_bytes() == original


def test_restore_refuses_invalid_input_and_live_api(tmp_path):
    target = tmp_path / "target.sqlite3"
    result = run_command("restore_database", target, b"invalid backup")
    assert result.returncode != 0 and b"Invalid SQLite backup" in result.stderr
    assert not target.exists()
    assert not list(tmp_path.glob(".restore-*"))
    with (tmp_path / "api.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = run_command("restore_database", target, b"invalid backup")
        assert result.returncode != 0 and b"Stop the API" in result.stderr
    assert not target.exists()
