import pytest
from django.test import Client

from apps.agents.models import Agent
from apps.core.models import InstallationSetup
from apps.workspaces.models import Domain, Membership, Workspace

pytestmark = pytest.mark.django_db


@pytest.fixture
def local_workspace(settings, user):
    settings.ALLOWED_HOSTS = ["*"]
    settings.WORKSPACE_DOMAIN_ROUTING = True
    settings.WORKSPACE_SINGLE_HOST_FALLBACK = True
    settings.CSRF_TRUSTED_ORIGINS = []
    workspace = Membership.objects.get(user=user).workspace
    Domain.objects.create(hostname="localhost", workspace=workspace)
    Agent.objects.create(workspace=workspace, name="Local agent")
    return workspace


@pytest.mark.parametrize(
    "host",
    [
        "192.168.1.40:8080",
        "100.91.2.3:8080",
        "desktop.tailnet.example:8080",
        "my-machine:8080",
        "[fd7a:115c:a1e0::1234]:8080",
    ],
)
def test_local_alias_keeps_membership_and_same_origin_csrf(local_workspace, user, host):
    client = Client(enforce_csrf_checks=True, HTTP_HOST=host)
    assert client.get("/api/v1/agents/").status_code == 403
    client.force_login(user)
    session = client.get("/api/v1/session/")
    assert session.status_code == 200
    token = session.cookies["csrftoken"].value
    assert client.get("/api/v1/agents/").json()["count"] == 1
    assert (
        client.post(
            "/api/v1/agents/", {"name": "Missing token"}, HTTP_ORIGIN=f"http://{host}"
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/agents/",
            {"name": "Wrong origin"},
            HTTP_ORIGIN="http://attacker.example",
            HTTP_X_CSRFTOKEN=token,
        ).status_code
        == 403
    )
    created = client.post(
        "/api/v1/agents/",
        {"name": "Same origin"},
        HTTP_ORIGIN=f"http://{host}",
        HTTP_X_CSRFTOKEN=token,
    )
    assert created.status_code == 201, created.content
    Membership.objects.filter(workspace=local_workspace, user=user).delete()
    assert client.get("/api/v1/agents/").status_code == 403


def test_local_unknown_hostname_fails_closed_for_multiple_workspaces(local_workspace, user):
    other = Workspace.objects.create(name="Other workspace")
    Domain.objects.create(hostname="other.local", workspace=other)
    client = Client(HTTP_HOST="unknown.local")
    client.force_login(user)
    assert client.get("/api/v1/agents/").status_code == 404
    # Explicit registered domains remain unambiguous and retain membership checks.
    assert client.get("/api/v1/agents/", HTTP_HOST="localhost").status_code == 200
    assert client.get("/api/v1/agents/", HTTP_HOST="other.local").status_code == 403


def test_strict_mode_rejects_alias_and_ipv6_registered_domain_routes(
    local_workspace, user, settings
):
    settings.WORKSPACE_SINGLE_HOST_FALLBACK = False
    client = Client(HTTP_HOST="unknown.local")
    client.force_login(user)
    assert client.get("/api/v1/agents/").status_code == 404
    Domain.objects.create(hostname="[fd7a:115c:a1e0::1234]", workspace=local_workspace)
    assert client.get("/api/v1/agents/", HTTP_HOST="[fd7a:115c:a1e0::1234]:8080").status_code == 200


def test_local_fallback_preserves_first_run_setup(settings):
    settings.ALLOWED_HOSTS = ["*"]
    settings.WORKSPACE_DOMAIN_ROUTING = True
    settings.WORKSPACE_SINGLE_HOST_FALLBACK = True
    client = Client(HTTP_HOST="100.91.2.3:8080")
    # An existing workspace record alone must never bypass unfinished setup.
    Workspace.objects.create(name="Incomplete")
    assert client.get("/api/v1/session/").status_code == 503
    assert client.get("/accounts/login/").url == "/setup/"
    assert client.get("/api/v1/setup/").status_code == 200
    assert not InstallationSetup.objects.exists()


def test_ipv6_setup_accepts_bracketed_host_without_port(settings):
    settings.ALLOWED_HOSTS = ["*"]
    settings.WORKSPACE_DOMAIN_ROUTING = True
    client = Client(HTTP_HOST="[fd7a:115c:a1e0::1234]:8080")
    page = client.get("/api/v1/setup/")
    assert page.status_code == 200
    assert page.json()["hostname"] == "[fd7a:115c:a1e0::1234]"
    response = client.post(
        "/api/v1/setup/",
        {
            "domain": "[fd7a:115c:a1e0::1234]",
            "workspace_name": "IPv6 workspace",
            "username": "ipv6-owner",
            "email": "ipv6@example.test",
            "password1": "A-long-setup-password-4829!",
            "password2": "A-long-setup-password-4829!",
        },
    )
    assert response.status_code == 201, response.content
    assert Domain.objects.filter(hostname="[fd7a:115c:a1e0::1234]").exists()


def test_wildcard_hosts_still_rejects_malformed_host(local_workspace):
    assert Client(HTTP_HOST="invalid.example/path").get("/api/v1/session/").status_code == 400


def test_explicit_allowed_hosts_override_restricts_local_alias(local_workspace, settings):
    settings.ALLOWED_HOSTS = ["localhost"]
    assert Client(HTTP_HOST="192.168.1.40").get("/api/v1/session/").status_code == 400
