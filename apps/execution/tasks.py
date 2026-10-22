from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from procrastinate import RetryStrategy
from procrastinate.contrib.django import app

from apps.runs.models import Run
from apps.runs.services import interrupt_run
from apps.workspaces.models import Workspace


@app.periodic(cron="* * * * * */15")
@app.task(
    lock="expire_leases", queueing_lock="expire_leases", retry=RetryStrategy(max_attempts=5, wait=5)
)
def expire_leases(timestamp=None):
    now = timezone.now()
    expired = Run.objects.filter(status__in=["running", "waiting_approval"]).filter(
        Q(lease_expires_at__lte=now) | Q(deadline__lte=now)
    )
    for pk in list(expired.values_list("pk", flat=True)[:100]):
        with transaction.atomic():
            workspace_id = Run.objects.values_list("workspace_id", flat=True).get(pk=pk)
            Workspace.objects.select_for_update().get(pk=workspace_id)
            run = Run.objects.select_for_update().get(pk=pk)
            if run.status not in {"running", "waiting_approval"}:
                continue
            if run.lease_expires_at > now and run.deadline > now:
                continue
            interrupt_run(run)
