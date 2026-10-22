"""Container entrypoint: persistent secrets, optional PostgreSQL, supervised roles."""

import base64
import fcntl
import json
import os
import pwd
import secrets
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

CHILDREN = []
STOPPING = False
DATABASE_PROCESS = None


def stop(signum=None, frame=None):
    global STOPPING
    STOPPING = True


def shutdown():
    # Drain application writers before asking PostgreSQL for a clean shutdown.
    application = [child for child in CHILDREN if child is not DATABASE_PROCESS]
    groups = [application, [DATABASE_PROCESS] if DATABASE_PROCESS else []]
    for group in groups:
        for child in group:
            if child.poll() is None:
                child.terminate()
        deadline = time.monotonic() + 25
        for child in group:
            try:
                child.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


def identity(user):
    account = pwd.getpwnam(user)
    return {"user": account.pw_uid, "group": account.pw_gid, "extra_groups": []}


def start(command, user=None):
    child = subprocess.Popen(command, **(identity(user) if user else {}))
    CHILDREN.append(child)
    return child


def atomic_json(path, values):
    descriptor, temporary = tempfile.mkstemp(prefix=".orgsdk-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(values, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        Path(temporary).unlink(missing_ok=True)


def private_settings(directory):
    path = directory / "secrets.json"
    with open(directory / "secrets.lock", "a") as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        if not path.exists():
            defaults = {
                "DJANGO_SECRET_KEY": secrets.token_urlsafe(64),
                "CREDENTIAL_ENCRYPTION_KEY": base64.urlsafe_b64encode(
                    secrets.token_bytes(32)
                ).decode(),
                "POSTGRES_PASSWORD": secrets.token_urlsafe(32),
            }
            atomic_json(
                path, {key: os.environ.get(key) or value for key, value in defaults.items()}
            )
        values = json.loads(path.read_text())
        required = {"DJANGO_SECRET_KEY", "CREDENTIAL_ENCRYPTION_KEY", "POSTGRES_PASSWORD"}
        if set(values) != required or not all(
            isinstance(value, str) and value for value in values.values()
        ):
            raise RuntimeError("Persisted secrets are invalid; restore them from backup")
        for key, value in values.items():
            supplied = os.environ.get(key)
            if supplied and supplied != value:
                raise RuntimeError(
                    f"{key} differs from persisted configuration; rotate keys explicitly"
                )
            os.environ[key] = value


def persistent_media(directory):
    media = Path("/app/media")
    # Preserve existing Compose media mounts; standalone uses the single data volume.
    mounts = {line.split()[4] for line in Path("/proc/self/mountinfo").read_text().splitlines()}
    if str(media) not in mounts and not media.is_symlink():
        if media.exists():
            media.rmdir()
        (directory / "media").mkdir(parents=True, exist_ok=True)
        media.symlink_to(directory / "media", target_is_directory=True)
    media.mkdir(parents=True, exist_ok=True)
    account = pwd.getpwnam("django")
    os.chown(media, account.pw_uid, account.pw_gid)


def write_health_state(role):
    atomic_json(
        Path("/tmp/orgsdk-health.json"),
        {
            "role": role,
            "database_url": os.environ.get("DATABASE_URL"),
            "pids": [child.pid for child in CHILDREN],
        },
    )


def embedded_database(directory):
    global DATABASE_PROCESS
    database = directory / "postgres" / "18" / "docker"
    database.mkdir(parents=True, exist_ok=True)
    account = pwd.getpwnam("postgres")
    for path in [directory / "postgres", database.parent, database]:
        os.chown(path, account.pw_uid, account.pw_gid)
    database.chmod(0o700)
    if not (database / "PG_VERSION").exists():
        password_file = directory / "postgres-password"
        password_file.write_text(os.environ["POSTGRES_PASSWORD"])
        password_file.chmod(0o600)
        os.chown(password_file, account.pw_uid, account.pw_gid)
        try:
            subprocess.run(
                [
                    "initdb",
                    "-D",
                    str(database),
                    "-U",
                    "orgsdk",
                    "--auth-host=scram-sha-256",
                    "--auth-local=trust",
                    f"--pwfile={password_file}",
                    "--encoding=UTF8",
                    "--locale=C.UTF-8",
                ],
                check=True,
                **identity("postgres"),
            )
        finally:
            password_file.unlink(missing_ok=True)
    DATABASE_PROCESS = start(
        ["postgres", "-D", str(database), "-h", "127.0.0.1", "-k", "/tmp"], "postgres"
    )
    os.environ["DATABASE_URL"] = (
        f"postgres://orgsdk:{quote(os.environ['POSTGRES_PASSWORD'], safe='')}@127.0.0.1:5432/orgsdk"
    )
    wait_database("postgres")
    import psycopg
    from psycopg import sql

    with psycopg.connect(
        os.environ["DATABASE_URL"].rsplit("/", 1)[0] + "/postgres", autocommit=True
    ) as connection:
        if not connection.execute("SELECT 1 FROM pg_database WHERE datname = 'orgsdk'").fetchone():
            connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier("orgsdk")))


def wait_database(database=None):
    import psycopg

    url = os.environ["DATABASE_URL"]
    if database:
        url = url.rsplit("/", 1)[0] + "/" + database
    for _ in range(120):
        if STOPPING:
            raise SystemExit(1)
        try:
            with psycopg.connect(url, connect_timeout=2):
                return
        except psycopg.OperationalError:
            time.sleep(1)
    raise RuntimeError("PostgreSQL did not become ready")


def migrate():
    import psycopg

    # Serialize migration processes across replicas; Django records applied migrations.
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as connection:
        while not connection.execute("SELECT pg_try_advisory_lock(784329105)").fetchone()[0]:
            if STOPPING:
                return
            time.sleep(0.25)
        process = start(["python", "manage.py", "migrate", "--noinput"], "django")
        try:
            while process.poll() is None:
                if STOPPING:
                    process.terminate()
                    try:
                        process.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    return
                time.sleep(0.25)
            if process.returncode:
                raise subprocess.CalledProcessError(process.returncode, process.args)
        finally:
            CHILDREN.remove(process)


def gateway():
    os.environ.setdefault("DJANGO_UPSTREAM", "127.0.0.1:8000")
    nameservers = [
        line.split()[1]
        for line in Path("/etc/resolv.conf").read_text().splitlines()
        if line.startswith("nameserver ")
    ]
    os.environ["NGINX_RESOLVER"] = nameservers[0] if nameservers else "127.0.0.11"
    scheme = os.environ.get("PUBLIC_SCHEME", "http")
    if scheme not in {"http", "https"}:
        raise ValueError("PUBLIC_SCHEME must be http or https")
    with (
        open("/tmp/orgsdk-nginx.conf", "w") as output,
        open("/etc/orgsdk/nginx.conf.template") as template,
    ):
        subprocess.run(
            ["envsubst", "${DJANGO_UPSTREAM} ${PUBLIC_SCHEME} ${NGINX_RESOLVER}"],
            stdin=template,
            stdout=output,
            check=True,
        )
    start(["nginx", "-c", "/tmp/orgsdk-nginx.conf", "-g", "daemon off;"])


def manage(directory, arguments):
    private_settings(directory)
    state = json.loads(Path("/tmp/orgsdk-health.json").read_text())
    if not state.get("database_url"):
        raise RuntimeError("Management commands require an initialized API or server container")
    configured = os.environ.get("DATABASE_URL")
    if configured and configured != state["database_url"]:
        raise RuntimeError("DATABASE_URL differs from the running server")
    os.environ["DATABASE_URL"] = state["database_url"]
    account = pwd.getpwnam("django")
    os.setgroups([])
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
    os.execvp("python", ["python", "manage.py", *arguments])


def main():
    role = sys.argv[1] if len(sys.argv) > 1 else "server"
    if role not in {"server", "api", "worker", "migrate", "gateway", "manage", "database"}:
        raise SystemExit("Expected server, api, worker, migrate, gateway, manage or database")
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    directory = Path(os.environ.get("ORGSDK_DATA_DIR", "/var/lib/orgsdk"))
    if role == "manage":
        manage(directory, sys.argv[2:])
        return 0
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o711)
    private_settings(directory)
    persistent_media(directory)
    if role == "gateway":
        gateway()
    else:
        if role == "database" and os.environ.get("DATABASE_URL"):
            raise RuntimeError("The database maintenance role requires embedded PostgreSQL")
        if not os.environ.get("DATABASE_URL"):
            embedded_database(directory)
        wait_database()
        if role in {"server", "migrate"}:
            migrate()
        if role == "migrate" or STOPPING:
            return 0
        if role in {"server", "api"}:
            start(
                [
                    "uvicorn",
                    "config.asgi:application",
                    "--host",
                    "0.0.0.0",
                    "--port",
                    "8000",
                    "--workers",
                    os.environ.get("WEB_CONCURRENCY", "2"),
                ],
                "django",
            )
        if role in {"server", "worker"}:
            start(["python", "manage.py", "run_worker"], "django")
        if role == "server":
            gateway()
    write_health_state(role)
    while not STOPPING:
        for child in CHILDREN:
            if child.poll() is not None:
                return child.returncode or 1
        time.sleep(0.25)
    return 0


if __name__ == "__main__":
    try:
        result = main()
    finally:
        shutdown()
    sys.exit(result)
