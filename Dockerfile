FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY LICENSE /LICENSE
COPY runtime/src/ /runtime/src/
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.13.1 AS uv
FROM python:3.14-slim-trixie
COPY --from=uv /uv /uvx /bin/
RUN apt-get update && apt-get install -y --no-install-recommends nginx tini gettext-base \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system django && useradd --system --gid django django
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 \
    PATH="/app/.venv/bin:$PATH" \
    DJANGO_SETTINGS_MODULE=config.settings.deployment ORGSDK_DATA_DIR=/var/lib/orgsdk PUBLIC_SCHEME=http
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
    && mkdir -p /var/lib/orgsdk
VOLUME ["/var/lib/orgsdk"]
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s CMD ["python", "scripts/healthcheck.py"]
ENTRYPOINT ["/usr/bin/tini", "--", "python", "scripts/server.py"]
CMD ["server"]
