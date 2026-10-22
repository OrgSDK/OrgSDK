from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from django.db import close_old_connections, connection
from django.utils import timezone
from rest_framework.test import APIClient

from apps.api_access.activity import record_activity
from apps.api_access.models import AccessToken
from apps.api_access.serializers import TokenSerializer
from apps.audit.models import AuditEvent
from apps.core.tokens import digest
from apps.workspaces.models import Domain, Membership, Workspace

pytestmark = pytest.mark.django_db


@pytest.fixture
def clients(settings, django_user_model):
    settings.WORKSPACE_DOMAIN_ROUTING = True
    settings.ALLOWED_HOSTS = ["acme.example.test", "other.example.test"]
    user = django_user_model.objects.create_user(username="activity-owner")
    workspace = Workspace.objects.create(name="Activity")
    other = Workspace.objects.create(name="Other")
    Domain.objects.create(workspace=workspace, hostname="acme.example.test")
    Domain.objects.create(workspace=other, hostname="other.example.test")
    membership = Membership.objects.create(workspace=workspace, user=user, role="owner")
    browser = APIClient(enforce_csrf_checks=True, HTTP_HOST="acme.example.test")
    browser.force_login(user)
    browser.get("/api/v1/session/")
    browser.credentials(HTTP_X_CSRFTOKEN=browser.cookies["csrftoken"].value)
    token = AccessToken.objects.create(
        workspace=workspace,
        actor=user,
        name="Local client",
        digest=digest("activity-secret"),
        scopes=["read", "write"],
    )
    machine = APIClient(HTTP_HOST="acme.example.test", HTTP_AUTHORIZATION="Bearer activity-secret")
    return browser, machine, token, membership


def rpc(client, method, params=None):
    return client.post(
        "/mcp/",
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params or {},
        },
        format="json",
    )


def test_rest_observations_and_no_sensitive_metadata(clients):
    browser, machine, token, _ = clients
    assert TokenSerializer(token).data["activity_state"] == "never_used"
    baseline = AuditEvent.objects.count()
    assert machine.get("/api/v1/agents/?private=do-not-store").status_code == 200
    token.refresh_from_db()
    assert token.request_count == token.success_count == token.rest_request_count == 1
    assert token.error_count == token.mcp_request_count == 0
    assert token.first_used_at == token.last_used_at
    assert token.last_transport == "REST" and token.last_outcome == "success"
    assert token.last_status_code == 200
    metadata = browser.get(f"/api/v1/tokens/{token.pk}/").data
    assert metadata["activity_state"] == "recently_used"
    assert "digest" not in metadata and "token" not in metadata
    assert "activity-secret" not in str(metadata) and "do-not-store" not in str(metadata)
    assert AuditEvent.objects.count() == baseline
    token.refresh_from_db()
    assert token.request_count == 1  # Session reads are not token activity.
    token.last_used_at = timezone.now() - timedelta(days=8)
    token.save(update_fields=["last_used_at"])
    assert TokenSerializer(token).data["activity_state"] == "inactive"


def test_mcp_http_200_errors_and_scope_denial(clients):
    _, machine, token, _ = clients
    assert rpc(machine, "initialize").status_code == 200
    assert rpc(machine, "notifications/initialized").status_code == 202
    assert rpc(machine, "unknown").status_code == 200
    assert rpc(machine, "tools/call", {"name": "unknown"}).status_code == 200
    # Valid schema, missing workspace resource: a tool error rather than a protocol error.
    result = rpc(
        machine,
        "tools/call",
        {
            "name": "get_run",
            "arguments": {
                "id": "00000000-0000-0000-0000-000000000000",
            },
        },
    )
    assert result.status_code == 200 and result.data["result"]["isError"] is True
    token.scopes = ["read"]
    token.save(update_fields=["scopes"])
    assert machine.post("/api/v1/agents/", {"name": "Denied"}).status_code == 403
    token.refresh_from_db()
    assert (token.request_count, token.success_count, token.error_count) == (6, 2, 4)
    assert (token.mcp_request_count, token.rest_request_count) == (5, 1)
    assert token.last_outcome == "error" and token.last_status_code == 403


def test_revoke_retains_history_and_only_browser_managers_can_manage(clients):
    browser, machine, token, membership = clients
    assert machine.get("/api/v1/agents/").status_code == 200
    assert machine.delete(f"/api/v1/tokens/{token.pk}/").status_code == 403
    assert (
        machine.post(
            "/api/v1/tokens/", {"name": "Nested", "scopes": ["read"]}, format="json"
        ).status_code
        == 403
    )
    membership.role = "member"
    membership.save(update_fields=["role"])
    assert browser.delete(f"/api/v1/tokens/{token.pk}/").status_code == 403
    membership.role = "admin"
    membership.save(update_fields=["role"])
    assert browser.delete(f"/api/v1/tokens/{token.pk}/").status_code == 204
    assert browser.delete(f"/api/v1/tokens/{token.pk}/").status_code == 204
    assert machine.get("/api/v1/agents/").status_code == 403
    token.refresh_from_db()
    assert token.revoked and token.request_count == 3
    assert TokenSerializer(token).data["activity_state"] == "revoked"
    assert AuditEvent.objects.filter(kind="token.revoked").count() == 1


@pytest.mark.parametrize("rejection", ["inactive", "membership", "workspace", "invalid"])
def test_rejected_identity_is_not_observed(clients, rejection):
    browser, machine, token, membership = clients
    if rejection == "inactive":
        token.actor.is_active = False
        token.actor.save(update_fields=["is_active"])
    elif rejection == "membership":
        membership.delete()
    elif rejection == "workspace":
        machine.defaults["HTTP_HOST"] = "other.example.test"
        assert (
            browser.get(f"/api/v1/tokens/{token.pk}/", HTTP_HOST="other.example.test").status_code
            == 403
        )
    else:
        machine.credentials(HTTP_AUTHORIZATION="Bearer wrong-secret")
    assert machine.get("/api/v1/agents/").status_code == 403
    token.refresh_from_db()
    assert token.request_count == 0 and token.last_used_at is None


@pytest.mark.django_db(transaction=True)
def test_concurrent_observations_do_not_lose_counts(clients):
    if connection.vendor != "postgresql":
        pytest.skip("Concurrent aggregate updates require PostgreSQL")
    _, _, token, _ = clients

    def observe(index):
        close_old_connections()
        try:
            record_activity(token.pk, transport="MCP", status_code=200, failed=index % 2 == 0)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(observe, range(24)))
    token.refresh_from_db()
    assert token.request_count == token.mcp_request_count == 24
    assert token.success_count == token.error_count == 12
    assert token.first_used_at <= token.last_used_at
    assert token.last_transport == "MCP" and token.last_status_code == 200


def test_late_observation_cannot_replace_latest_outcome(clients, monkeypatch):
    _, _, token, _ = clients
    later = timezone.now()
    monkeypatch.setattr("apps.api_access.activity.timezone.now", lambda: later)
    record_activity(token.pk, transport="MCP", status_code=200, failed=True)
    earlier = later - timedelta(seconds=1)
    monkeypatch.setattr("apps.api_access.activity.timezone.now", lambda: earlier)
    record_activity(token.pk, transport="REST", status_code=204, failed=False)
    token.refresh_from_db()
    assert token.first_used_at == earlier and token.last_used_at == later
    assert token.last_outcome == "error" and token.last_transport == "MCP"
    assert token.last_status_code == 200 and token.request_count == 2
