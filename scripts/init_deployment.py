#!/usr/bin/env python3
"""Write a private local environment using only the Python standard library."""

import argparse
import base64
import os
import secrets
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--domain", default="localhost")
parser.add_argument("--port", type=int, default=8080)
parser.add_argument("--project", default="orgsdk")
args = parser.parse_args()
path = Path(os.environ.get("ORGSDK_ENV_FILE", ".env.deployment"))
if path.exists():
    raise SystemExit("Deployment environment already exists; edit it explicitly.")
values = {
    "COMPOSE_PROJECT_NAME": args.project,
    "HTTP_PORT": str(args.port),
    "BIND_ADDRESS": "0.0.0.0",
    "DJANGO_SECRET_KEY": secrets.token_urlsafe(64),
    "DJANGO_SETTINGS_MODULE": "config.settings.deployment",
    "DJANGO_ALLOWED_HOSTS": "*",
    "PUBLIC_SCHEME": "http",
    "CREDENTIAL_ENCRYPTION_KEY": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
    "LOCAL_EXECUTOR_BOOTSTRAP_TOKEN": secrets.token_urlsafe(48),
    "DEFAULT_FROM_EMAIL": f"OrgSDK <noreply@{args.domain}>",
}
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as stream:
    stream.write("".join(f"{key}={value}\n" for key, value in values.items()))
print(f"Created {path}. Local configuration is ready.")
