"""Entrypoint invariants without Docker or deployment credentials."""

import importlib.util
import json
import os
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "server_entrypoint", Path(__file__).resolve().parents[1] / "scripts/server.py"
)
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


@pytest.fixture
def clean_secrets(monkeypatch):
    for key in ("DJANGO_SECRET_KEY", "CREDENTIAL_ENCRYPTION_KEY", "POSTGRES_PASSWORD"):
        monkeypatch.delenv(key, raising=False)


def test_secrets_survive_restart(tmp_path, clean_secrets):
    server.private_settings(tmp_path)
    original = (tmp_path / "secrets.json").read_bytes()
    server.private_settings(tmp_path)
    assert (tmp_path / "secrets.json").read_bytes() == original
    assert (tmp_path / "secrets.json").stat().st_mode & 0o777 == 0o600


def test_supplied_encryption_key_persisted(tmp_path, clean_secrets, monkeypatch):
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", "existing-private-key")
    server.private_settings(tmp_path)
    assert json.loads((tmp_path / "secrets.json").read_text())["CREDENTIAL_ENCRYPTION_KEY"] == (
        "existing-private-key"
    )


def test_conflicting_keys_refused(tmp_path, clean_secrets, monkeypatch):
    server.private_settings(tmp_path)
    original = os.environ["CREDENTIAL_ENCRYPTION_KEY"]
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", "replacement")
    with pytest.raises(RuntimeError, match="differs from persisted"):
        server.private_settings(tmp_path)
    assert (
        json.loads((tmp_path / "secrets.json").read_text())["CREDENTIAL_ENCRYPTION_KEY"] == original
    )


def _create_settings(directory):
    server.private_settings(Path(directory))


def test_concurrent_first_boot_is_atomic(tmp_path, clean_secrets):
    import multiprocessing

    context = multiprocessing.get_context("fork")
    processes = [context.Process(target=_create_settings, args=(str(tmp_path),)) for _ in range(8)]
    for process in processes:
        process.start()
    for process in processes:
        process.join(10)
        assert process.exitcode == 0
    values = json.loads((tmp_path / "secrets.json").read_text())
    assert len(values) == 3
    assert not list(tmp_path.glob(".orgsdk-*"))


def test_corrupt_existing_secrets_are_never_replaced(tmp_path, clean_secrets):
    path = tmp_path / "secrets.json"
    path.write_text("{interrupted old configuration")
    with pytest.raises(json.JSONDecodeError):
        server.private_settings(tmp_path)
    assert path.read_text() == "{interrupted old configuration"


def test_shutdown_drains_writers_before_database(monkeypatch):
    calls = []

    class Child:
        def __init__(self, name):
            self.name = name

        def poll(self):
            return None

        def terminate(self):
            calls.append((self.name, "terminate"))

        def wait(self, timeout):
            calls.append((self.name, "wait"))

    database = Child("postgres")
    worker = Child("worker")
    api = Child("api")
    monkeypatch.setattr(server, "CHILDREN", [database, worker, api])
    monkeypatch.setattr(server, "DATABASE_PROCESS", database)
    server.shutdown()
    assert calls.index(("postgres", "terminate")) > calls.index(("worker", "wait"))
    assert calls.index(("postgres", "terminate")) > calls.index(("api", "wait"))


def test_signal_only_requests_shutdown(monkeypatch):
    monkeypatch.setattr(server, "STOPPING", False)
    server.stop()
    assert server.STOPPING


def test_unexpected_clean_child_exit_fails_container(tmp_path, clean_secrets, monkeypatch):
    class ExitedChild:
        returncode = 0
        pid = 123

        def poll(self):
            return 0

    monkeypatch.setattr(server.sys, "argv", ["server.py", "worker"])
    monkeypatch.setenv("ORGSDK_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DATABASE_URL", "postgres://unused")
    monkeypatch.setattr(server, "STOPPING", False)
    monkeypatch.setattr(server, "persistent_media", lambda directory: None)
    monkeypatch.setattr(server, "wait_database", lambda: None)
    monkeypatch.setattr(server, "write_health_state", lambda role: None)
    monkeypatch.setattr(server.signal, "signal", lambda *args: None)
    monkeypatch.setattr(server, "start", lambda *args: None)
    monkeypatch.setattr(server, "CHILDREN", [ExitedChild()])
    assert server.main() == 1


def test_management_loads_running_database_and_drops_privileges(
    tmp_path, clean_secrets, monkeypatch
):
    from types import SimpleNamespace

    monkeypatch.delenv("DATABASE_URL", raising=False)
    server.private_settings(tmp_path)
    state_path = tmp_path / "health.json"
    state_path.write_text(json.dumps({"database_url": "postgres://persisted-db"}))
    monkeypatch.setattr(server, "Path", lambda value: state_path)
    monkeypatch.setattr(
        server.pwd, "getpwnam", lambda user: SimpleNamespace(pw_uid=101, pw_gid=102)
    )
    calls = []
    monkeypatch.setattr(server.os, "setgroups", lambda value: calls.append(("groups", value)))
    monkeypatch.setattr(server.os, "setgid", lambda value: calls.append(("gid", value)))
    monkeypatch.setattr(server.os, "setuid", lambda value: calls.append(("uid", value)))
    monkeypatch.setattr(server.os, "execvp", lambda *args: calls.append(("exec", args)))
    monkeypatch.setattr(server, "private_settings", lambda directory: None)
    server.manage(tmp_path, ["changepassword", "admin"])
    assert os.environ["DATABASE_URL"] == "postgres://persisted-db"
    assert calls == [
        ("groups", []),
        ("gid", 102),
        ("uid", 101),
        ("exec", ("python", ["python", "manage.py", "changepassword", "admin"])),
    ]


def test_worker_health_refuses_database_outage(monkeypatch):
    import runpy

    import psycopg

    monkeypatch.setattr(
        Path,
        "read_text",
        lambda *args: json.dumps(
            {
                "role": "worker",
                "database_url": "postgres://unavailable",
                "pids": [],
            }
        ),
    )

    def unavailable(*args, **kwargs):
        raise psycopg.OperationalError("database unavailable")

    monkeypatch.setattr(psycopg, "connect", unavailable)
    with pytest.raises(psycopg.OperationalError, match="database unavailable"):
        runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/healthcheck.py"))
