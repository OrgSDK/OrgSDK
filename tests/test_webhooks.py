import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.db import close_old_connections, connection
from rest_framework.test import APIClient

from apps.actions.models import ActionVersion, Webhook, WebhookDelivery
from apps.actions.webhooks import receive_webhook
from apps.runs.models import Run
from apps.workspaces.models import Membership
from tests.test_product import environment  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.fixture
def registered(request):
    env = request.getfixturevalue("environment")
    client = env[0]
    response = client.post(
        "/api/v1/webhooks/",
        {"name": "Build", "action": str(env[6].action_id)},
        format="json",
    )
    assert response.status_code == 201, response.data
    return env, response.data["webhook"], response.data["secret"]


def deliver(registered, *, secret=None, delivery="event-1", payload=None, host="acme.example.test"):
    _, hook, token = registered
    return APIClient(enforce_csrf_checks=True, HTTP_HOST=host).post(
        hook["endpoint"],
        {"inputs": {"a": 2}} if payload is None else payload,
        format="json",
        HTTP_X_WEBHOOK_SECRET=token if secret is None else secret,
        HTTP_X_WEBHOOK_DELIVERY=delivery,
    )


def test_acceptance_deduplication_and_pinned_version(registered):
    env, hook, secret = registered
    assert str(hook["action_id"]) == str(env[6].action_id)
    ActionVersion.objects.create(action=env[6].action, number=2, source="return 99")
    accepted = deliver(registered)
    assert accepted.status_code == 202, accepted.data
    run = Run.objects.get(pk=accepted.data["run"])
    assert run.origin == "webhook" and run.origin_reference == str(hook["id"])
    assert run.action_version_id == env[6].pk
    assert run.status == "queued"
    assert run.actor_id == env[1].pk
    assert deliver(registered).data["duplicate"] is True
    assert Run.objects.count() == 1
    assert deliver(registered, payload={"inputs": {"a": 3}}).status_code == 409
    assert secret not in json.dumps(env[0].get("/api/v1/webhooks/").data, default=str)
    assert Webhook.objects.get().secret_hash != secret
    assert not hasattr(WebhookDelivery.objects.get(), "payload")
    run.status = "failed"
    run.save()
    detail = env[0].get(f"/api/v1/webhooks/{hook['id']}/").data
    assert str(detail["action_id"]) == str(env[6].action_id)
    assert detail["deliveries"][0]["run_status"] == "failed"
    assert detail["last_accepted_at"]


def test_rotation_and_authentication_are_separate_from_execution(registered):
    env, hook, secret = registered
    assert deliver(registered, secret="wrong").status_code == 403
    assert not Run.objects.exists()
    assert not WebhookDelivery.objects.exists()
    rotated = env[0].post(f"/api/v1/webhooks/{hook['id']}/rotate/").data["secret"]
    assert deliver(registered, secret=secret).status_code == 403
    assert deliver(registered, secret=rotated).status_code == 202
    hook = Webhook.objects.get()
    assert hook.last_rejection == "authentication_failed"
    assert hook.last_accepted_at


@pytest.mark.parametrize("change", ["member", "actor", "action", "agent", "hook", "workspace"])
def test_revocation_prevents_new_and_duplicate_runs(registered, change):
    env, _, _ = registered
    assert deliver(registered).status_code == 202
    hook = Webhook.objects.get()
    if change == "member":
        Membership.objects.filter(workspace=env[2], user=env[1]).delete()
    else:
        target = {
            "actor": env[1],
            "action": env[6].action,
            "agent": env[4],
            "hook": hook,
            "workspace": env[2].workspacesettings,
        }[change]
        field = "is_active" if change == "actor" else "enabled"
        setattr(target, field, False)
        target.save()
    assert deliver(registered).status_code == 403
    assert deliver(registered, delivery="new").status_code == 403
    assert Run.objects.count() == 1


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"inputs": []},
        {"inputs": {"a": "secret-input"}},
        {"inputs": {"a": 2}, "actor": "override"},
    ],
)
def test_invalid_payloads_have_safe_diagnostics(registered, payload):
    response = deliver(registered, payload=payload)
    assert response.status_code == 400
    hook = Webhook.objects.get()
    assert "secret-input" not in hook.last_rejection
    assert not Run.objects.exists()


def test_http_bounds_and_invalid_encodings(registered):
    _, hook, secret = registered
    client = APIClient(HTTP_HOST="acme.example.test")
    for body, status in [
        (b"x" * 65537, 413),
        (b"\xff", 400),
        (b"[" * 2000, 400),
        (b'{"inputs":{"a":NaN}}', 400),
        (b'{"inputs":{"a":1e999}}', 400),
        (b'{"inputs":{"a":"\\u0000"}}', 400),
        (b'{"inputs":{"a":"\\ud800"}}', 400),
        (b'{"inputs":{"a":' + b"[" * 40 + b"0" + b"]" * 40 + b"}}", 400),
    ]:
        response = client.post(
            hook["endpoint"],
            body,
            content_type="application/json",
            HTTP_X_WEBHOOK_SECRET=secret,
            HTTP_X_WEBHOOK_DELIVERY="test",
        )
        assert response.status_code == status, response.data
    response = client.post(
        hook["endpoint"],
        "{}",
        content_type="text/plain",
        HTTP_X_WEBHOOK_SECRET=secret,
        HTTP_X_WEBHOOK_DELIVERY="test",
    )
    assert response.status_code == 415
    assert deliver(registered, delivery="bad id").status_code == 400


def test_workspace_isolation_and_immutable_binding(registered):
    env, hook, _ = registered
    assert deliver(registered, host="other.example.test").status_code == 404
    assert (
        env[0].get(f"/api/v1/webhooks/{hook['id']}/", HTTP_HOST="other.example.test").status_code
        == 403
    )
    assert (
        env[0]
        .patch(f"/api/v1/webhooks/{hook['id']}/", {"action": str(env[6].action_id)}, format="json")
        .status_code
        == 400
    )
    Membership.objects.create(workspace=env[3], user=env[1], role="admin")
    assert (
        env[0].get(f"/api/v1/webhooks/{hook['id']}/", HTTP_HOST="other.example.test").status_code
        == 404
    )
    foreign_action = env[5].actions.create(workspace=env[3], name="Other")
    assert (
        env[0]
        .post("/api/v1/webhooks/", {"name": "Bad", "action": str(foreign_action.pk)}, format="json")
        .status_code
        == 400
    )


def test_manager_permissions_and_csrf(registered):
    env, hook, _ = registered
    client = APIClient(enforce_csrf_checks=True, HTTP_HOST="acme.example.test")
    assert client.get("/api/v1/webhooks/").status_code == 403
    client.force_login(env[1])
    assert client.post(f"/api/v1/webhooks/{hook['id']}/rotate/").status_code == 403
    csrf = client.get("/api/v1/session/").cookies["csrftoken"].value
    assert (
        client.post(f"/api/v1/webhooks/{hook['id']}/rotate/", HTTP_X_CSRFTOKEN=csrf).status_code
        == 200
    )
    Membership.objects.filter(user=env[1], workspace=env[2]).update(role="member")
    assert client.get("/api/v1/webhooks/").status_code == 200
    assert (
        client.post(f"/api/v1/webhooks/{hook['id']}/rotate/", HTTP_X_CSRFTOKEN=csrf).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/v1/webhooks/{hook['id']}/",
            {"enabled": False},
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/webhooks/",
            {"name": "No", "action": str(env[6].action_id)},
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        ).status_code
        == 403
    )


@pytest.mark.django_db(transaction=True)
def test_concurrent_deliveries_queue_once(registered):
    if connection.vendor != "postgresql":
        pytest.skip("Requires PostgreSQL row locks")
    env, hook, secret = registered

    def send(_):
        close_old_connections()
        try:
            return receive_webhook(
                hook_id=hook["id"],
                workspace=env[2],
                secret=secret,
                delivery_id="concurrent",
                body=b'{"inputs":{"a":2}}',
                content_type="application/json",
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(send, range(2)))
    assert sorted(code for _, code in results) == [200, 202]
    assert Run.objects.count() == WebhookDelivery.objects.count() == 1
