from datetime import timedelta

import pytest
from django.contrib.sessions.models import Session
from django.utils import timezone
from procrastinate.contrib.django import app

from apps.core.tasks import clear_expired_sessions, worker_ping


def test_worker_ping():
    assert worker_ping() == {"status": "ok"}


@pytest.mark.django_db
def test_cleanup_removes_only_expired_sessions():
    Session.objects.create(
        session_key="expired", session_data="", expire_date=timezone.now() - timedelta(days=1)
    )
    Session.objects.create(
        session_key="active", session_data="", expire_date=timezone.now() + timedelta(days=1)
    )
    clear_expired_sessions()
    assert list(Session.objects.values_list("session_key", flat=True)) == ["active"]


def test_worker_registers_periodic_maintenance():
    schedules = {
        task.task.name: task.cron for task in app.periodic_registry.periodic_tasks.values()
    }
    assert schedules["apps.actions.tasks.dispatch_schedules"] == "* * * * * */15"
    assert schedules["apps.execution.tasks.expire_leases"] == "* * * * * */15"
    assert schedules["apps.core.tasks.recover_stalled_jobs"] == "* * * * * */15"
    assert schedules["apps.core.tasks.clear_expired_sessions"] == "0 3 * * *"
