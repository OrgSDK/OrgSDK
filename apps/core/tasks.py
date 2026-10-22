import logging
from datetime import timedelta

from asgiref.sync import async_to_sync, sync_to_async
from django.core.cache import cache
from django.core.management import call_command
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from procrastinate import App, RetryStrategy
from procrastinate.contrib.django import app
from procrastinate.contrib.django.django_connector import DjangoConnector
from procrastinate.contrib.django.models import ProcrastinateJob
from procrastinate.jobs import Status

logger = logging.getLogger(__name__)
MAX_CRASH_RETRIES = 5


@app.task
def worker_ping():
    """A harmless task for verifying durable queue execution."""
    return {"status": "ok"}


@app.periodic(cron="0 3 * * *")
@app.task(lock="clear_expired_sessions", queueing_lock="clear_expired_sessions", retry=3)
def clear_expired_sessions(timestamp=None):
    call_command("clearsessions")


@app.periodic(cron="* * * * * */15")
@app.task(queueing_lock="recover_stalled_jobs", retry=3)
def recover_stalled_jobs(timestamp=None):
    """Lock and recheck stalled rows so concurrent recovery cannot reclaim a live job."""
    manager = App(connector=DjangoConnector()).job_manager
    stale_before = timezone.now() - timedelta(seconds=30)
    # Recovery has no execution lock: a killed recovery task must not block its successor.
    with transaction.atomic():
        stalled = (
            ProcrastinateJob.objects.select_for_update(skip_locked=True, of=("self",))
            .filter(status="doing")
            .filter(Q(worker__isnull=True) | Q(worker__last_heartbeat__lt=stale_before))
        )
        for record in stalled[:100]:
            if record.attempts >= MAX_CRASH_RETRIES:
                async_to_sync(manager.finish_job)(
                    record.procrastinate_job, status=Status.FAILED, delete_job=False
                )
                logger.error("Job %s exhausted crash recovery attempts", record.pk)
                continue
            manager.retry_job_by_id(record.pk, retry_at=timezone.now())


@app.periodic(cron="30 3 * * *")
@app.task(
    lock="prune_completed_jobs",
    queueing_lock="prune_completed_jobs",
    retry=RetryStrategy(max_attempts=3, wait=5),
)
async def prune_completed_jobs(timestamp=None):
    # Failed jobs stay visible for operator inspection and explicit retry.
    await app.job_manager.delete_old_jobs(nb_hours=24 * 7)
    await sync_to_async(cache.delete_expired)()
