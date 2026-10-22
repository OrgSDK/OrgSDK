"""Real PostgreSQL worker checks; SQLite only covers ordinary domain task logic."""

import os
import subprocess
import sys
import time
from datetime import timedelta
from urllib.parse import quote

import pytest
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.db import connection, transaction
from django.test import override_settings
from django.utils import timezone
from procrastinate import RetryStrategy
from procrastinate.contrib.django import app
from procrastinate.contrib.django.models import ProcrastinateJob

from apps.core.tasks import clear_expired_sessions, recover_stalled_jobs, worker_ping

DATABASE_CACHE = {
    "default": {
        "BACKEND": "apps.core.cache.SharedDatabaseCache",
        "LOCATION": "orgsdk_cache",
        "OPTIONS": {"MAX_ENTRIES": 2},
    }
}


@app.task(name="tests.retry_probe", retry=RetryStrategy(max_attempts=3, wait=1))
def retry_probe():
    attempts = cache.get("retry-probe", 0) + 1
    cache.set("retry-probe", attempts)
    raise OSError("intentional integration failure")


@app.task(name="tests.crash_probe", retry=3)
def crash_probe():
    if cache.add("crash-probe", True):
        time.sleep(120)


def wait_until(predicate, timeout=35):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.1)
    raise AssertionError("PostgreSQL worker did not reach the expected state")


def start_worker(log):
    config = connection.settings_dict
    user = quote(str(config["USER"]), safe="")
    password = quote(str(config["PASSWORD"]), safe="")
    database = quote(str(config["NAME"]), safe="")
    database_url = f"postgres://{user}:{password}@{config['HOST']}:{config['PORT']}/{database}"
    script = """
import django
from django.conf import settings
settings.CACHES = {"default": {
    "BACKEND": "apps.core.cache.SharedDatabaseCache", "LOCATION": "orgsdk_cache"
}}
django.setup()
import tests.test_postgres_jobs
from django.core.management import call_command
call_command("run_worker", concurrency=2)
"""
    return subprocess.Popen(
        [sys.executable, "-c", script],
        env={
            **os.environ,
            "DJANGO_SETTINGS_MODULE": "config.settings.test",
            "TEST_DATABASE_URL": database_url,
        },
        stdout=log,
        stderr=log,
    )


@pytest.mark.django_db(transaction=True)
def test_postgres_worker_transactions_retries_schedules_and_crash_recovery(tmp_path):
    if connection.vendor != "postgresql":
        pytest.skip("requires isolated PostgreSQL test database")
    workers = []
    with override_settings(CACHES=DATABASE_CACHE), (tmp_path / "workers.log").open("w+") as log:
        with connection.cursor() as cursor:
            cursor.execute("TRUNCATE procrastinate_jobs, procrastinate_workers CASCADE")
        cache.clear()
        try:
            # A queued job rolls back with its domain transaction.
            with pytest.raises(RuntimeError), transaction.atomic():
                rolled_back = worker_ping.defer()
                raise RuntimeError("rollback")
            assert not ProcrastinateJob.objects.filter(pk=rolled_back).exists()
            Session.objects.create(
                session_key="expired-worker-session",
                session_data="",
                expire_date=timezone.now() - timedelta(days=1),
            )
            cleanup_id = clear_expired_sessions.defer()
            ping_id = worker_ping.defer()
            retry_id = retry_probe.defer()
            workers.append(start_worker(log))
            workers.append(start_worker(log))
            wait_until(lambda: ProcrastinateJob.objects.get(pk=ping_id).status == "succeeded")
            wait_until(lambda: ProcrastinateJob.objects.get(pk=retry_id).status == "failed")
            assert cache.get("retry-probe") == 4
            wait_until(lambda: ProcrastinateJob.objects.get(pk=cleanup_id).status == "succeeded")
            assert not Session.objects.filter(session_key="expired-worker-session").exists()
            # Both independent worker processes see the shared cache and one periodic occurrence.
            wait_until(
                lambda: ProcrastinateJob.objects.filter(
                    task_name="apps.execution.tasks.expire_leases", status="succeeded"
                ).exists()
            )
            occurrences = list(
                ProcrastinateJob.objects.filter(
                    task_name="apps.execution.tasks.expire_leases"
                ).values_list("args", flat=True)
            )
            assert len({row["timestamp"] for row in occurrences}) == len(occurrences)
            # Kill both to ensure the crash probe cannot be recovered by a live owner.
            for worker in workers:
                worker.terminate()
                worker.wait(timeout=10)
            workers.clear()
            crash_id = crash_probe.defer()
            workers.append(start_worker(log))
            wait_until(lambda: cache.get("crash-probe"))
            workers[0].kill()
            workers[0].wait(timeout=10)
            workers.clear()
            # Advance the killed worker's heartbeat instead of waiting 30 real seconds.
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE procrastinate_workers SET last_heartbeat = %s",
                    [timezone.now() - timedelta(seconds=60)],
                )
            orphaned_recovery_id = recover_stalled_jobs.defer()
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE procrastinate_jobs SET status = 'doing', "
                    "attempts = 1, queueing_lock = NULL WHERE id = %s",
                    [orphaned_recovery_id],
                )
            exhausted_id = crash_probe.defer()
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE procrastinate_jobs SET status = 'doing', attempts = 5 WHERE id = %s",
                    [exhausted_id],
                )
            workers.append(start_worker(log))
            wait_until(lambda: ProcrastinateJob.objects.get(pk=crash_id).status == "succeeded")
            wait_until(lambda: ProcrastinateJob.objects.get(pk=exhausted_id).status == "failed")
            wait_until(
                lambda: ProcrastinateJob.objects.get(pk=orphaned_recovery_id).status == "succeeded"
            )
            assert ProcrastinateJob.objects.get(pk=crash_id).attempts == 2
        except BaseException:
            log.flush()
            log.seek(0)
            print(log.read())
            raise
        finally:
            for worker in workers:
                worker.terminate()
                try:
                    worker.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    worker.kill()
                    worker.wait(timeout=10)


@pytest.mark.django_db(transaction=True)
def test_invitation_and_delivery_job_commit_or_rollback_together(user, api_client, settings):
    if connection.vendor != "postgresql":
        pytest.skip("requires isolated PostgreSQL test database")
    from apps.workspaces.models import Invitation

    settings.BACKGROUND_TASKS_EAGER = False
    api_client.force_login(user)
    bootstrap = api_client.get("/api/v1/session/")
    api_client.credentials(HTTP_X_CSRFTOKEN=bootstrap.cookies["csrftoken"].value)
    with pytest.raises(RuntimeError), transaction.atomic():
        response = api_client.post(
            "/api/v1/workspaces/invitations/",
            {"email": "queued@example.com", "role": "member"},
            format="json",
        )
        assert response.status_code == 201
        invitation_id = response.json()["id"]
        query = ProcrastinateJob.objects.filter(
            task_name="apps.workspaces.tasks.send_invitation", args={"invitation_id": invitation_id}
        )
        assert query.exists()
        raise RuntimeError("rollback invitation and delivery")
    assert not Invitation.objects.filter(pk=invitation_id).exists()
    assert not query.exists()
    response = api_client.post(
        "/api/v1/workspaces/invitations/",
        {"email": "queued@example.com", "role": "member"},
        format="json",
    )
    assert response.status_code == 201
    assert ProcrastinateJob.objects.filter(
        task_name="apps.workspaces.tasks.send_invitation",
        args={"invitation_id": response.json()["id"]},
    ).exists()


@pytest.mark.django_db(transaction=True)
def test_shared_cache_expired_add_and_allauth_limits_are_exclusive():
    if connection.vendor != "postgresql":
        pytest.skip("requires isolated PostgreSQL test database")
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from allauth.core.internal import ratelimit
    from django.db import connections
    from django.test import RequestFactory

    def concurrently(action):
        barrier = Barrier(8)

        def run(_):
            try:
                barrier.wait(timeout=10)
                return action()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=8) as pool:
            return list(pool.map(run, range(8)))

    with override_settings(CACHES=DATABASE_CACHE):
        for attempt in range(5):
            key = f"expired-exclusive-add-{attempt}"
            cache.set(key, True, timeout=-10)
            assert sum(concurrently(lambda key=key: cache.add(key, True, timeout=30))) == 1
        request = RequestFactory().post("/accounts/login/")
        rate = ratelimit.parse_rate("3/m/ip")
        key = ratelimit.get_cache_key(request, action="login_failed", rate=rate)
        cache.set(f"{key}:lock", True, timeout=-10)
        allowed = concurrently(
            lambda: (
                ratelimit.consume(request, action="login_failed", config={"login_failed": "3/m/ip"})
                is not None
            )
        )
        assert sum(allowed) == 3
        for number in range(50):
            cache.set(f"cache-pressure-{number}", True, timeout=60)
        assert len(cache.get(key)) == 3
        assert (
            ratelimit.consume(request, action="login_failed", config={"login_failed": "3/m/ip"})
            is None
        )
        cache.set("expired-prune-probe", True, timeout=-10)
        cache.delete_expired()
        assert cache.get("expired-prune-probe") is None
        assert cache.get("cache-pressure-0") is True
