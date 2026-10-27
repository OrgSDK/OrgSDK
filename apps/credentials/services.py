"""Run snapshot credential scope and exact secret redaction."""

import json

from .models import Credential
from .secrets import decrypt


def allowed_credentials(run):
    ids = set()
    for agent in run.snapshot.get("agents", []):
        if agent.get("id") != str(run.agent_id):
            continue
        if agent.get("credential_id"):
            ids.add(agent["credential_id"])
        for plugin in agent.get("plugins", []):
            if plugin.get("credential_id"):
                ids.add(plugin["credential_id"])
    return ids


def secret_variants(run):
    """Known run-scoped secrets in literal and JSON-escaped text representations."""
    secrets = set()
    for credential in Credential.objects.filter(
        workspace=run.workspace, pk__in=allowed_credentials(run)
    ):
        for secret in decrypt(credential.encrypted_secret).values():
            if isinstance(secret, str) and len(secret) >= 4:
                secrets.update(
                    [secret, json.dumps(secret)[1:-1], json.dumps(secret, ensure_ascii=False)[1:-1]]
                )
    return sorted(secrets, key=len, reverse=True)


def redact_text(content, secrets):
    for secret in secrets:
        content = content.replace(secret, "[redacted]")
    return content


def redact(run, value):
    secrets = secret_variants(run)

    def visit(item):
        if isinstance(item, str):
            return redact_text(item, secrets)
        if isinstance(item, list):
            return [visit(child) for child in item]
        if isinstance(item, dict):
            return {redact_text(key, secrets): visit(child) for key, child in item.items()}
        return item

    return visit(value)


def redact_stream_snapshot(run, content):
    """Withhold suffixes that could grow into known secrets on the next chunk.

    Snapshots replace previous text; raw partial deltas are never persisted.
    The credential scope is identical to final-output redaction, including plugins.
    """
    secrets = secret_variants(run)
    content = redact_text(content, secrets)
    withheld = 0
    for secret in secrets:
        for size in range(min(len(secret) - 1, len(content)), withheld, -1):
            if content.endswith(secret[:size]):
                withheld = size
                break
    return content[:-withheld] if withheld else content
