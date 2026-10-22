from datetime import timedelta

from django.utils import timezone


def lease_deadline():
    return timezone.now() + timedelta(seconds=60)


def local_executor_token(executor):
    import hashlib
    import hmac

    from django.conf import settings

    return hmac.new(
        settings.LOCAL_EXECUTOR_BOOTSTRAP_TOKEN.encode(),
        f"{executor.pk}:{executor.registration_nonce}".encode(),
        hashlib.sha256,
    ).hexdigest()


def ensure_local_executor(agent):
    from django.conf import settings

    from apps.core.tokens import digest

    from .models import Executor

    if not getattr(settings, "LOCAL_EXECUTOR_BOOTSTRAP_TOKEN", ""):
        return None
    executor, created = Executor.objects.get_or_create(
        agent=agent,
        defaults={
            "name": f"agent-{agent.pk}",
            "locally_managed": True,
            "token_hash": f"pending-{agent.pk}",
        },
    )
    if created or (executor.locally_managed and executor.enabled):
        token_hash = digest(local_executor_token(executor))
        if executor.token_hash != token_hash:
            executor.token_hash = token_hash
            executor.save(update_fields=["token_hash"])
    return executor


def revoke_executor(executor):
    from django.db import transaction

    from apps.runs.models import Run
    from apps.runs.services import cancel_descendants
    from apps.workspaces.models import Workspace

    from .models import Executor

    with transaction.atomic():
        if executor.agent_id:
            Workspace.objects.select_for_update().get(pk=executor.agent.workspace_id)
        executor = Executor.objects.select_for_update().get(pk=executor.pk)
        executor.enabled = False
        executor.locally_managed = False
        executor.save(update_fields=["enabled", "locally_managed"])
        for run in Run.objects.select_for_update().filter(
            executor=executor, status__in=["running", "waiting_approval"]
        ):
            cancel_descendants(run)
            run.approvals.filter(status="pending").update(status="interrupted")
            run.cancel_requested = True
            run.capability_hash = ""
            run.status = "cancelled"
            run.save(update_fields=["cancel_requested", "capability_hash", "status"])
