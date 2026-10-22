"""Register the local Docker executor without printing or sharing its credential."""

import os
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
credential_file = ROOT / ".runtime" / "executor.env"
credential_file.parent.mkdir(mode=0o700, exist_ok=True)

if not credential_file.exists():
    with open(
        credential_file, "x", opener=lambda path, flags: os.open(path, flags, 0o600)
    ) as stream:
        stream.write(f"LOCAL_EXECUTOR_BOOTSTRAP_TOKEN={secrets.token_urlsafe(48)}\n")

credential_file.chmod(0o600)
key, separator, token = credential_file.read_text().strip().partition("=")
if key != "LOCAL_EXECUTOR_BOOTSTRAP_TOKEN" or not separator or len(token) < 32:
    raise SystemExit("Invalid .runtime/executor.env; expected a local executor credential.")

print(
    "Local development executor credential prepared. Agents register independently during creation."
)
