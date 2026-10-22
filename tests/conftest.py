import pytest
from allauth.account.models import EmailAddress
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import User


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def user(db):
    user = User.objects.create_user(
        username="alex", email="alex@example.com", password="a-long-test-password-9284"
    )
    EmailAddress.objects.create(user=user, email=user.email, primary=True, verified=True)
    return user


@pytest.fixture
def api_client():
    return APIClient(enforce_csrf_checks=True)
