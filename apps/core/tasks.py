from datetime import timedelta

from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone

from .models import BackgroundJob


def clear_expired_sessions():
    call_command("clearsessions")


def prune_completed_jobs():
    BackgroundJob.objects.filter(
        status=BackgroundJob.Status.SUCCEEDED,
        finished_at__lt=timezone.now() - timedelta(days=7),
    ).delete()
    cache.delete_expired()
