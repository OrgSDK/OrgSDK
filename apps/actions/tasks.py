from datetime import UTC, datetime

from croniter import croniter
from django.db import transaction
from django.utils import timezone
from procrastinate import RetryStrategy
from procrastinate.contrib.django import app
from rest_framework.exceptions import APIException

from apps.runs.services import create_run

from .models import Schedule


@app.periodic(cron="* * * * * */15")
@app.task(
    lock="dispatch_schedules",
    queueing_lock="dispatch_schedules",
    retry=RetryStrategy(max_attempts=5, wait=5),
)
def dispatch_schedules(timestamp=None):
    now = timezone.now()
    for pk in Schedule.objects.filter(enabled=True, next_run_at__lte=now).values_list(
        "pk", flat=True
    )[:100]:
        with transaction.atomic():
            schedule = (
                Schedule.objects.select_for_update().select_related("action__agent").get(pk=pk)
            )
            if not schedule.enabled or schedule.next_run_at > now:
                continue
            occurrence = schedule.next_run_at
            version = schedule.action.versions.order_by("-number").first()
            try:
                create_run(
                    workspace=schedule.workspace,
                    actor=schedule.actor,
                    agent=schedule.action.agent,
                    operation="action",
                    version=version,
                    inputs=schedule.inputs,
                    origin="schedule",
                    origin_reference=str(pk),
                    key=f"schedule:{pk}:{occurrence.isoformat()}",
                )
            except APIException:
                # Invalid/unauthorised schedules require an explicit operator correction.
                schedule.enabled = False
            schedule.next_run_at = datetime.fromtimestamp(
                croniter(schedule.cron, now).get_next(float), UTC
            )
            schedule.save(update_fields=["next_run_at", "enabled"])
