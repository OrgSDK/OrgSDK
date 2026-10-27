"""File-backed SQLite concurrency and real API-process job delivery."""

import os
import socket
import subprocess
import sys
import time
from datetime import timedelta

import pytest
from django.contrib.sessions.models import Session
from django.core.cache import cache
from django.db import connection, transaction
from django.test import override_settings
from django.utils import timezone

from apps.core.jobs import enqueue, run_next_job, schedule_periodic_jobs
from apps.core.models import BackgroundJob

DATABASE_CACHE = {
    "default": {
        "BACKEND": "apps.core.cache.SharedDatabaseCache",
        "LOCATION": "orgsdk_cache",
        "OPTIONS": {"MAX_ENTRIES": 2},
    }
}


def retry_probe():
    if cache.add("retry-probe", True):
        raise OSError("intentional integration failure")


def crash_probe():
    if cache.add("crash-probe", True):
        time.sleep(120)


def wait_until(predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.1)
    raise AssertionError("API maintenance did not reach the expected state")


def start_api(log):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    script = """
import django
from django.conf import settings
settings.CACHES = {"default": {
    "BACKEND": "apps.core.cache.SharedDatabaseCache", "LOCATION": "orgsdk_cache"
}}
django.setup()
from apps.core import jobs
from tests.test_sqlite_jobs import retry_probe, crash_probe
original = jobs.task_functions
jobs.task_functions = lambda: original() | {"retry_probe": retry_probe, "crash_probe": crash_probe}
import uvicorn
uvicorn.run("config.asgi:application", host="127.0.0.1", port=PORT, lifespan="on")
""".replace("PORT", str(port))
    return subprocess.Popen(
        [sys.executable, "-c", script],
        env={
            **os.environ,
            "DJANGO_SETTINGS_MODULE": "config.settings.test",
            "TEST_SQLITE_PATH": str(connection.settings_dict["NAME"]),
        },
        stdout=log,
        stderr=log,
    )


@pytest.mark.django_db(transaction=True)
def test_api_delivers_jobs_retries_and_recovers_after_process_death(tmp_path):
    processes = []
    with override_settings(CACHES=DATABASE_CACHE), (tmp_path / "api.log").open("w+") as log:
        try:
            Session.objects.create(
                session_key="expired-api-session",
                session_data="",
                expire_date=timezone.now() - timedelta(days=1),
            )
            cleanup = enqueue("clear_expired_sessions")
            retry = BackgroundJob.objects.create(task="retry_probe")
            processes.append(start_api(log))
            wait_until(lambda: BackgroundJob.objects.get(pk=cleanup.pk).status == "succeeded")
            wait_until(lambda: BackgroundJob.objects.get(pk=retry.pk).status == "succeeded")
            retry.refresh_from_db()
            assert retry.attempts == 2
            assert not Session.objects.filter(session_key="expired-api-session").exists()
            # A second API cannot own this installation or recover a live worker's jobs.
            duplicate = start_api(log)
            processes.append(duplicate)
            assert duplicate.wait(timeout=10) != 0
            crash = BackgroundJob.objects.create(task="crash_probe")
            wait_until(lambda: cache.get("crash-probe"))
            processes[0].kill()
            processes[0].wait(timeout=10)
            exhausted = BackgroundJob.objects.create(
                task="crash_probe", status="running", attempts=5
            )
            processes.append(start_api(log))
            wait_until(lambda: BackgroundJob.objects.get(pk=crash.pk).status == "succeeded")
            exhausted.refresh_from_db()
            assert exhausted.status == "failed"
            crash.refresh_from_db()
            assert crash.attempts == 2
        except BaseException:
            log.flush()
            log.seek(0)
            print(log.read())
            raise
        finally:
            for process in processes:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=10)


@pytest.mark.django_db(transaction=True)
def test_invitation_and_delivery_job_commit_or_rollback_together(user, api_client):
    from apps.workspaces.models import Invitation

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
        query = BackgroundJob.objects.filter(
            task="send_invitation", arguments={"invitation_id": invitation_id}
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
    assert BackgroundJob.objects.filter(
        task="send_invitation", arguments={"invitation_id": response.json()["id"]}
    ).exists()


@pytest.mark.django_db
def test_periodic_occurrences_are_deduplicated_and_skip_missed_history():
    now = timezone.now()
    schedule_periodic_jobs(now)
    schedule_periodic_jobs(now)
    assert BackgroundJob.objects.count() == 4
    schedule_periodic_jobs(now + timedelta(days=3))
    assert BackgroundJob.objects.count() == 8


@pytest.mark.django_db
def test_retries_are_bounded_and_failure_records_are_retained(monkeypatch):
    from apps.core import jobs

    def fail():
        raise OSError("transient failure")

    monkeypatch.setattr(jobs, "task_functions", lambda: {"probe": fail})
    job = enqueue("probe")
    for _ in range(5):
        BackgroundJob.objects.filter(pk=job.pk).update(available_at=timezone.now())
        assert run_next_job()
    job.refresh_from_db()
    assert job.status == "failed" and job.attempts == 5
    assert job.finished_at is not None
    assert not run_next_job()


@pytest.mark.django_db(transaction=True)
def test_shared_cache_expired_add_and_allauth_limits_are_exclusive():
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
