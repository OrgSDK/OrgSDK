from datetime import timedelta

import pytest
from django.contrib.sessions.models import Session
from django.utils import timezone

from apps.core.tasks import clear_expired_sessions


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
