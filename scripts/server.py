"""Local server: private SQLite storage, one API process and a static gateway."""

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
from contextlib import contextmanager
from pathlib import Path

CHILDREN = []
STOPPING = False


def stop(signum=None, frame=None):
    global STOPPING
    STOPPING = True


def shutdown():
    for child in CHILDREN:
        if child.poll() is None:
            child.terminate()
    deadline = time.monotonic() + 30
    for child in CHILDREN:
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
            }
            atomic_json(
                path, {key: os.environ.get(key) or value for key, value in defaults.items()}
            )
        values = json.loads(path.read_text())
        if set(values) != {"DJANGO_SECRET_KEY", "CREDENTIAL_ENCRYPTION_KEY"} or not all(
            isinstance(value, str) and value for value in values.values()
        ):
            raise RuntimeError("Invalid secrets. SQLite requires a fresh installation volume.")
        for key, value in values.items():
            supplied = os.environ.get(key)
            if supplied and supplied != value:
                raise RuntimeError(f"{key} differs from persisted configuration")
            os.environ[key] = value


def persistent_storage(directory):
    account = pwd.getpwnam("django")
    for name in ("database", "media"):
        path = directory / name
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(0o700)
        os.chown(path, account.pw_uid, account.pw_gid)


def migrate():
    process = start(["python", "manage.py", "migrate", "--noinput"], "django")
    while process.poll() is None:
        if STOPPING:
            return
        time.sleep(0.1)
    CHILDREN.remove(process)
    if process.returncode:
        raise subprocess.CalledProcessError(process.returncode, process.args)


def gateway():
    os.environ["DJANGO_UPSTREAM"] = "127.0.0.1:8000"
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
    account = pwd.getpwnam("django")
    os.setgroups([])
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
    os.execvp("python", ["python", "manage.py", *arguments])


@contextmanager
def installation_lock(directory):
    with (directory / "server.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            shutdown()


def main():
    role = sys.argv[1] if len(sys.argv) > 1 else "server"
    if role not in {"server", "migrate", "manage"}:
        raise SystemExit("Expected server, migrate or manage")
    if os.environ.get("DATABASE_URL"):
        raise RuntimeError("DATABASE_URL is unsupported. Create a fresh SQLite installation.")
    if os.environ.get("WEB_CONCURRENCY", "1") != "1":
        raise RuntimeError("A local installation uses exactly one API process.")
    os.umask(0o077)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    directory = Path(os.environ.get("ORGSDK_DATA_DIR", "/var/lib/orgsdk")).resolve()
    os.environ["ORGSDK_DATA_DIR"] = str(directory)
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o711)
    if role == "manage":
        persistent_storage(directory)
        manage(directory, sys.argv[2:])
        return 0
    with installation_lock(directory):
        private_settings(directory)
        persistent_storage(directory)
        migrate()
        if role == "migrate" or STOPPING:
            return 0
        start(
            [
                "uvicorn",
                "config.asgi:application",
                "--host",
                "0.0.0.0",
                "--port",
                "8000",
                "--workers",
                "1",
                "--lifespan",
                "on",
                "--timeout-graceful-shutdown",
                "25",
            ],
            "django",
        )
        gateway()
        atomic_json(Path("/tmp/orgsdk-health.json"), {"pids": [child.pid for child in CHILDREN]})
        while not STOPPING:
            for child in CHILDREN:
                if child.poll() is not None:
                    return child.returncode or 1
            time.sleep(0.25)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        shutdown()
