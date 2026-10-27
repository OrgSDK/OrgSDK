"""Action webhook policy shared by HTTP ingress and other integrations."""

import hashlib
import hmac
import json
import re

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from apps.core.tokens import digest, issue_token
from apps.execution.models import WorkspaceSettings
from apps.runs.services import create_run
from apps.workspaces.models import Membership, Workspace

from .models import Webhook, WebhookDelivery

MAX_BODY_BYTES = 64 * 1024


def validate_json_structure(value):
    pending = [(value, 0)]
    while pending:
        current, depth = pending.pop()
        if depth > 32:
            raise ValueError("JSON nesting exceeds 32 levels")
        if isinstance(current, dict):
            pending.extend((child, depth + 1) for child in current.values())
            pending.extend((key, depth + 1) for key in current)
        elif isinstance(current, list):
            pending.extend((child, depth + 1) for child in current)
        elif isinstance(current, str):
            # PostgreSQL JSON cannot represent null characters or unpaired surrogates.
            if "\x00" in current:
                raise ValueError("Invalid JSON string")
            current.encode("utf-8")


def invalid_constant(value):
    raise ValueError("Invalid JSON number")


def rotate_secret(hook):
    secret = issue_token()
    hook.secret_hash = digest(secret)
    hook.rotated_at = timezone.now()
    hook.save(update_fields=["secret_hash", "rotated_at"])
    return secret


def reject(hook, code, status):
    hook.last_rejection = code
    hook.last_rejected_at = timezone.now()
    hook.save(update_fields=["last_received_at", "last_rejection", "last_rejected_at"])
    return {"detail": code}, status


@transaction.atomic
def receive_webhook(*, hook_id, workspace, secret, delivery_id, body, content_type):
    # All mutations share the membership/run lock order, including secret rotation.
    query = Webhook.objects.filter(pk=hook_id)
    if workspace is not None:
        query = query.filter(workspace=workspace)
    selected = query.first()
    if selected is None:
        return {"detail": "Webhook not found."}, 404
    Workspace.objects.get(pk=selected.workspace_id)
    hook = Webhook.objects.select_related(
        "action_version__action__agent", "workspace", "actor"
    ).get(pk=selected.pk)
    hook.last_received_at = timezone.now()
    if len(secret) > 256 or not hmac.compare_digest(digest(secret), hook.secret_hash):
        return reject(hook, "authentication_failed", 403)
    version = hook.action_version
    action = version.action
    if (
        not hook.enabled
        or not hook.actor.is_active
        or WorkspaceSettings.objects.filter(workspace=hook.workspace, enabled=False).exists()
        or not action.enabled
        or not action.agent.enabled
        or action.workspace_id != hook.workspace_id
        or action.agent.workspace_id != hook.workspace_id
        or not Membership.objects.filter(workspace=hook.workspace, user=hook.actor).exists()
    ):
        return reject(hook, "trigger_unavailable", 403)
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", delivery_id):
        return reject(hook, "invalid_delivery_id", 400)
    if len(body) > MAX_BODY_BYTES:
        return reject(hook, "payload_too_large", 413)
    if content_type != "application/json":
        return reject(hook, "json_required", 415)
    try:
        payload = json.loads(body.decode("utf-8"), parse_constant=invalid_constant)
        validate_json_structure(payload)
        if not isinstance(payload, dict) or set(payload) != {"inputs"}:
            raise ValueError
        if not isinstance(payload["inputs"], dict):
            raise ValueError
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except ValueError, UnicodeError, RecursionError:
        return reject(hook, "invalid_payload", 400)
    payload_hash = hashlib.sha256(canonical.encode()).hexdigest()
    existing = hook.deliveries.filter(delivery_id=delivery_id).first()
    if existing:
        if existing.payload_hash != payload_hash:
            return reject(hook, "delivery_conflict", 409)
        hook.save(update_fields=["last_received_at"])
        return {
            "run": str(existing.run_id) if existing.run_id else None,
            "outcome": existing.outcome,
            "duplicate": True,
        }, (200 if existing.run_id else 400)
    try:
        # Nested savepoint prevents failed run creation from rolling back its receipt.
        with transaction.atomic():
            run = create_run(
                workspace=hook.workspace,
                actor=hook.actor,
                agent=action.agent,
                operation="action",
                inputs=payload["inputs"],
                version=version,
                origin="webhook",
                origin_reference=str(hook.pk),
                key=f"webhook:{hook.pk}:{delivery_id}",
            )
    except (PermissionDenied, ValidationError) as error:
        outcome = (
            "execution_unavailable" if isinstance(error, PermissionDenied) else "inputs_rejected"
        )
        WebhookDelivery.objects.create(
            webhook=hook, delivery_id=delivery_id, payload_hash=payload_hash, outcome=outcome
        )
        return reject(hook, outcome, 400)
    except APIException:
        return reject(hook, "execution_unavailable", 400)
    WebhookDelivery.objects.create(
        webhook=hook,
        delivery_id=delivery_id,
        payload_hash=payload_hash,
        outcome="accepted",
        run=run,
    )
    hook.last_accepted_at = timezone.now()
    hook.save(update_fields=["last_received_at", "last_accepted_at"])
    return {"run": str(run.pk), "outcome": "accepted", "duplicate": False}, 202
