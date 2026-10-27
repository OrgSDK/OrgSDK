"""Durable server maintenance, executed only inside the API process."""

import logging
from datetime import UTC, datetime, timedelta

from django.db import close_old_connections, transaction
from django.utils import timezone

from .models import BackgroundJob

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 5
PERIODIC_TASKS = {
    "dispatch_schedules": 15,
    "expire_leases": 15,
    "clear_expired_sessions": 24 * 60 * 60,
    "prune_completed_jobs": 24 * 60 * 60,
}


def task_functions():
    from apps.actions.tasks import dispatch_schedules
    from apps.execution.tasks import expire_leases
    from apps.workspaces.tasks import send_invitation

    from .tasks import clear_expired_sessions, prune_completed_jobs

    return {
        "send_invitation": send_invitation,
        "dispatch_schedules": dispatch_schedules,
        "expire_leases": expire_leases,
        "clear_expired_sessions": clear_expired_sessions,
        "prune_completed_jobs": prune_completed_jobs,
    }


def enqueue(task, **arguments):
    if task not in task_functions():
        raise ValueError(f"Unknown background task: {task}")
    return BackgroundJob.objects.create(task=task, arguments=arguments)


def schedule_periodic_jobs(now):
    timestamp = int(now.timestamp())
    for task, interval in PERIODIC_TASKS.items():
        offset = {"clear_expired_sessions": 3 * 3600, "prune_completed_jobs": 3 * 3600 + 1800}.get(
            task, 0
        )
        occurrence = (timestamp - offset) // interval * interval + offset
        BackgroundJob.objects.get_or_create(
            occurrence=f"{task}:{occurrence}",
            defaults={"task": task, "available_at": datetime.fromtimestamp(occurrence, UTC)},
        )


def recover_interrupted_jobs():
    # The API holds the installation lock; no old worker can still be alive.
    running = BackgroundJob.objects.filter(status=BackgroundJob.Status.RUNNING)
    running.filter(attempts__gte=MAX_ATTEMPTS).update(
        status=BackgroundJob.Status.FAILED,
        finished_at=timezone.now(),
        last_error="Interrupted; retry limit reached",
    )
    running.update(status=BackgroundJob.Status.QUEUED, available_at=timezone.now())


@transaction.atomic
def claim_job(now):
    job = (
        BackgroundJob.objects.filter(status=BackgroundJob.Status.QUEUED, available_at__lte=now)
        .order_by("available_at", "pk")
        .first()
    )
    if job is None:
        return None
    job.status = BackgroundJob.Status.RUNNING
    job.attempts += 1
    job.save(update_fields=["status", "attempts"])
    return job


def run_next_job():
    job = claim_job(timezone.now())
    if job is None:
        return False
    try:
        # Network work, such as mail delivery, must never hold SQLite's write lock.
        task_functions()[job.task](**job.arguments)
    except Exception as error:
        failed = job.attempts >= MAX_ATTEMPTS
        BackgroundJob.objects.filter(pk=job.pk).update(
            status=BackgroundJob.Status.FAILED if failed else BackgroundJob.Status.QUEUED,
            available_at=timezone.now() + timedelta(seconds=min(300, 2**job.attempts)),
            finished_at=timezone.now() if failed else None,
            last_error=type(error).__name__,
        )
        logger.exception("Background job %s (%s) failed", job.pk, job.task)
    else:
        BackgroundJob.objects.filter(pk=job.pk).update(
            status=BackgroundJob.Status.SUCCEEDED, finished_at=timezone.now(), last_error=""
        )
    return True


def maintenance_tick():
    close_old_connections()
    try:
        schedule_periodic_jobs(timezone.now())
        return run_next_job()
    finally:
        close_old_connections()
