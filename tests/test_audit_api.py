from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.api_access.models import AccessToken
from apps.audit.models import AuditEvent
from apps.core.tokens import digest
from apps.workspaces.models import Membership
from tests.test_product import environment  # noqa: F401

pytestmark = pytest.mark.django_db
URL = "/api/v1/audit/"


@pytest.fixture
def audit_env(request):
    env = request.getfixturevalue("environment")
    client, user, workspace, other, *_ = env
    client.force_authenticate(user=None)
    client.force_login(user)
    events = [
        AuditEvent.objects.create(workspace=workspace, actor=user, kind=kind, object_id="record")
        for kind in ["document.created", "document.updated", "table.deleted"]
    ]
    moment = timezone.now().replace(microsecond=0)
    for index, event in enumerate(events):
        AuditEvent.objects.filter(pk=event.pk).update(created_at=moment + timedelta(hours=index))
    AuditEvent.objects.create(workspace=other, actor=user, kind="private", object_id="secret")
    return env, events, moment


def test_read_scope_order_and_filters(audit_env):
    env, events, moment = audit_env
    client, user, *_ = env
    response = client.get(URL)
    assert response.status_code == 200
    assert [row["id"] for row in response.data["results"]] == [str(e.pk) for e in reversed(events)]
    assert response.data["count"] == 3
    row = response.data["results"][0]
    assert set(row) == {"id", "actor_id", "actor_label", "kind", "object_id", "created_at"}
    assert row["actor_label"] == user.username
    assert client.get(URL, {"kind": "document.updated"}).data["count"] == 1
    assert client.get(URL, {"actor": user.pk, "object_id": "record"}).data["count"] == 3
    assert client.get(URL, {"object_id": "secret"}).data["count"] == 0
    assert client.get(URL, {"actor": 987654}).data["count"] == 0
    interval = {"since": moment.isoformat(), "before": (moment + timedelta(hours=1)).isoformat()}
    filtered = client.get(URL, interval).data
    assert [row["id"] for row in filtered["results"]] == [str(events[0].pk)]
    assert client.get(URL, HTTP_HOST="other.example.test").status_code == 403


def test_pagination_ties_and_read_only(audit_env):
    env, events, moment = audit_env
    client = env[0]
    AuditEvent.objects.filter(pk__in=[e.pk for e in events]).update(created_at=moment)
    first = client.get(URL, {"page_size": 2}).data
    second = client.get(URL, {"page_size": 2, "page": 2}).data
    ids = [row["id"] for row in first["results"] + second["results"]]
    assert ids == sorted([str(e.pk) for e in events], reverse=True)
    assert first["next"] and second["previous"]
    assert client.get(URL, {"page": 99}).status_code == 404
    csrf = client.get("/api/v1/session/").cookies["csrftoken"].value
    for method in ["post", "put", "patch", "delete"]:
        assert getattr(client, method)(URL, {}, HTTP_X_CSRFTOKEN=csrf).status_code == 405
    assert client.get(f"{URL}{events[0].pk}/").status_code == 404
    assert AuditEvent.objects.count() == 4


@pytest.mark.parametrize("role", ["owner", "admin", "member"])
def test_roles_and_token_permissions(audit_env, role):
    env, *_ = audit_env
    client, user, workspace, *_ = env
    Membership.objects.filter(user=user, workspace=workspace).update(role=role)
    user.is_staff = True
    user.save()
    expected = 403 if role == "member" else 200
    assert client.get(URL).status_code == expected
    token = str(uuid4())
    AccessToken.objects.create(
        workspace=workspace, actor=user, name="Audit", digest=digest(token), scopes=["read"]
    )
    api_client = APIClient(HTTP_HOST="acme.example.test", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert api_client.get(URL).status_code == expected
    Membership.objects.filter(user=user, workspace=workspace).delete()
    assert api_client.get(URL).status_code == 403
    assert client.get(URL).status_code == 403


def test_anonymous_and_write_only_token(audit_env):
    env, *_ = audit_env
    _, user, workspace, *_ = env
    client = APIClient(HTTP_HOST="acme.example.test")
    assert client.get(URL).status_code in {401, 403}
    token = str(uuid4())
    AccessToken.objects.create(
        workspace=workspace, actor=user, name="Write", digest=digest(token), scopes=["write"]
    )
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    assert client.get(URL).status_code == 403


@pytest.mark.parametrize(
    "params",
    [
        {"since": "bad"},
        {"before": "2026-02-30T00:00:00Z"},
        {"since": "9999-12-31T23:59:59-23:59"},
        {"since": "2026-01-02T00:00:00Z", "before": "2026-01-01T00:00:00Z"},
        {"actor": str(uuid4())},
        {"actor": "1" * 100},
        {"actor": "-1"},
        {"kind": "x" * 101},
        {"object_id": "x" * 101},
        {"page": "bad"},
        {"page": "-1"},
        {"page_size": 101},
        {"page_size": 0},
    ],
)
def test_invalid_filters_return_400(audit_env, params):
    env, *_ = audit_env
    assert env[0].get(URL, params).status_code == 400


def test_actor_privacy_and_fallbacks(audit_env, django_user_model):
    env, events, _ = audit_env
    client, _, workspace, *_ = env
    outsider = django_user_model.objects.create_user(
        username="private-account", email="private@example.test"
    )
    AuditEvent.objects.filter(pk=events[0].pk).update(actor=outsider)
    AuditEvent.objects.filter(pk=events[1].pk).update(actor=None)
    rows = {row["id"]: row for row in client.get(URL).data["results"]}
    assert rows[str(events[0].pk)]["actor_label"] == "Former workspace member"
    assert rows[str(events[0].pk)]["actor_id"] is None
    assert rows[str(events[1].pk)]["actor_label"] == "System or deleted account"
    assert "private-account" not in str(rows)
    assert "private@example.test" not in str(rows)
    Membership.objects.create(workspace=workspace, user=outsider, role="member")
    outsider.first_name = "Known"
    outsider.last_name = "Member"
    outsider.save()
    assert "Known Member" in str(client.get(URL).data)
