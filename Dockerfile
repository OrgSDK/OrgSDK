FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY LICENSE /LICENSE
COPY runtime/src/ /runtime/src/
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.13.1 AS uv
FROM postgres:18-trixie AS postgres
FROM python:3.14-slim-trixie
COPY --from=uv /uv /uvx /bin/
# Use the same PostgreSQL major for embedded and separate database installations.
COPY --from=postgres /usr/lib/postgresql/18 /usr/lib/postgresql/18
COPY --from=postgres /usr/share/postgresql /usr/share/postgresql
COPY --from=postgres /usr/lib/*-linux-gnu/libpq.so.5* /usr/local/lib/
RUN apt-get update && apt-get install -y --no-install-recommends nginx tini gettext-base libpq5 libicu76 libldap2 liblz4-1 libzstd1 libxml2 libssl3t64 libpam0g libreadline8t64 libxslt1.1 libgssapi-krb5-2 libnuma1 liburing2 locales tzdata libllvm19 \
    && rm -rf /var/lib/apt/lists/* \
    && ldconfig \
    && groupadd --system django && useradd --system --gid django django \
    && groupadd --system postgres && useradd --system --gid postgres postgres
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 \
    PATH="/app/.venv/bin:/usr/lib/postgresql/18/bin:$PATH" \
    DJANGO_SETTINGS_MODULE=config.settings.deployment ORGSDK_DATA_DIR=/var/lib/orgsdk PUBLIC_SCHEME=http
# Exercise a private cluster and backup/restore with the shipped client libraries.
RUN python - <<'PY'
from pathlib import Path
import pwd
import shutil
import subprocess

root = Path("/usr/lib/postgresql/18")
paths = [root / "bin" / name for name in ("postgres", "initdb", "pg_dump", "pg_restore")]
paths.extend(root.glob("lib/*.so"))
missing = [str(path) for path in paths if "not found" in subprocess.run(
    ["ldd", str(path)], capture_output=True, text=True
).stdout]
assert not missing, f"Missing PostgreSQL runtime libraries: {missing}"
account = pwd.getpwnam("postgres")
cluster = "/tmp/orgsdk-build-cluster"
subprocess.run(
    ["initdb", "-D", cluster, "--auth=trust", "--encoding=UTF8", "--locale=C.UTF-8"],
    user=account.pw_uid, group=account.pw_gid, extra_groups=[], check=True,
)
connection = ["-h", "/tmp", "-p", "55432", "-U", "postgres"]
owner = {"user": account.pw_uid, "group": account.pw_gid, "extra_groups": []}
subprocess.run(
    ["pg_ctl", "-D", cluster, "-o", "-c listen_addresses='' -k /tmp -p 55432", "-w", "start"],
    **owner, check=True,
)
try:
    subprocess.run(["psql", *connection, "-d", "postgres", "-c", "SELECT 1"], check=True)
    subprocess.run(["pg_dump", *connection, "-Fc", "-f", "/tmp/orgsdk-build.dump", "postgres"], check=True)
    subprocess.run(["psql", *connection, "-d", "postgres", "-c", "CREATE DATABASE orgsdk_build_restore"], check=True)
    subprocess.run(["pg_restore", *connection, "-d", "orgsdk_build_restore", "--exit-on-error", "/tmp/orgsdk-build.dump"], check=True)
finally:
    subprocess.run(["pg_ctl", "-D", cluster, "-m", "fast", "-w", "stop"], **owner, check=True)
Path("/tmp/orgsdk-build.dump").unlink()
shutil.rmtree(cluster)
PY
WORKDIR /app
COPY LICENSE ./
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev
COPY apps/ apps/
COPY config/ config/
COPY static/ static/
COPY manage.py ./
COPY scripts/server.py scripts/healthcheck.py scripts/
COPY deploy/nginx.conf.template /etc/orgsdk/nginx.conf.template
COPY --from=frontend /frontend/out /usr/share/nginx/html
RUN DJANGO_SETTINGS_MODULE=config.settings.base python manage.py collectstatic --noinput \
    && mkdir -p /app/media /var/lib/orgsdk && chown django:django /app/media
VOLUME ["/var/lib/orgsdk"]
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s CMD ["python", "scripts/healthcheck.py"]
ENTRYPOINT ["/usr/bin/tini", "--", "python", "scripts/server.py"]
CMD ["server"]
