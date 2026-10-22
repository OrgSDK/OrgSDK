import pytest
from allauth.account.models import EmailAddress
from django.contrib.auth import get_user_model
from django.test import Client

from apps.core.models import InstallationSetup
from apps.execution.models import WorkspaceSettings
from apps.workspaces.models import Domain, Membership, Workspace

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def domain_routing(settings):
    settings.WORKSPACE_DOMAIN_ROUTING = True


def setup_data():
    return {
        "domain": "testserver",
        "workspace_name": "First workspace",
        "username": "owner",
        "email": "owner@example.test",
        "password1": "A-long-setup-password-4829!",
        "password2": "A-long-setup-password-4829!",
    }


def test_empty_installation_prompts_setup(client):
    response = client.get("/api/v1/session/")
    assert response.status_code == 503
    assert response.json()["code"] == "setup_required"
    assert response.headers["Cache-Control"] == "no-store"
    response = client.get("/accounts/login/")
    assert response.status_code == 302
    assert response.url == "/setup/"
    response = client.get("/api/v1/setup/")
    assert response.status_code == 200
    assert response.json() == {"setup_required": True, "hostname": "testserver"}
    assert "csrftoken" in response.cookies
    assert "no-store" in response.headers["Cache-Control"]
    assert client.get("/api/health/").status_code == 200


def test_setup_creates_owner_and_closes_permanently(client):
    response = client.post("/api/v1/setup/", setup_data())
    assert response.status_code == 201
    assert response.json() == {"setup_required": False, "login_url": "/accounts/login/"}
    owner = get_user_model().objects.get(email="owner@example.test")
    assert owner.check_password(setup_data()["password1"])
    assert owner.is_superuser
    assert owner.is_staff
    membership = Membership.objects.get(user=owner)
    assert membership.role == "owner"
    assert membership.workspace.name == "First workspace"
    assert Domain.objects.get(hostname="testserver").workspace_id == membership.workspace_id
    assert WorkspaceSettings.objects.filter(workspace=membership.workspace).exists()
    assert EmailAddress.objects.get(user=owner).verified is False
    assert InstallationSetup.objects.get().completed_at is not None
    assert client.get("/api/v1/session/").status_code == 200
    assert client.get("/api/v1/setup/").json()["setup_required"] is False
    assert client.post("/api/v1/setup/", setup_data()).status_code == 404
    Domain.objects.all().delete()
    assert client.get("/api/v1/setup/").json()["setup_required"] is False
    assert client.get("/api/v1/session/").status_code == 404
    assert get_user_model().objects.count() == 1


def test_existing_domain_disables_setup(client):
    workspace = Workspace.objects.create(name="Existing")
    Domain.objects.create(workspace=workspace, hostname="testserver")
    assert client.get("/api/v1/setup/").json()["setup_required"] is False
    assert client.post("/api/v1/setup/", setup_data()).status_code == 404
    assert get_user_model().objects.count() == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"domain": "https://testserver/"},
        {"domain": "other.example.test"},
        {"email": "invalid"},
        {"password2": "different"},
        {"password1": "123", "password2": "123"},
    ],
)
def test_invalid_setup_has_no_side_effects(client, changes):
    response = client.post("/api/v1/setup/", {**setup_data(), **changes})
    assert response.status_code == 400
    assert response.json()
    assert not Domain.objects.exists()
    assert not get_user_model().objects.exists()
    assert not InstallationSetup.objects.exists()


def test_setup_requires_csrf():
    client = Client(enforce_csrf_checks=True)
    assert client.post("/api/v1/setup/", setup_data()).status_code == 403
    client.get("/api/v1/setup/")
    response = client.post(
        "/api/v1/setup/", setup_data(), HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value
    )
    assert response.status_code == 201


def test_setup_rolls_back_on_failure(client, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("storage unavailable")

    monkeypatch.setattr(WorkspaceSettings.objects, "create", fail)
    with pytest.raises(RuntimeError, match="storage unavailable"):
        client.post("/api/v1/setup/", setup_data())
    assert not get_user_model().objects.exists()
    assert not Workspace.objects.exists()
    assert not Domain.objects.exists()
    assert not InstallationSetup.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_setup_creates_only_one_owner():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("Concurrent setup locking requires PostgreSQL")
    barrier = Barrier(2)

    def submit(number):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            response = Client().post(
                "/api/v1/setup/",
                {
                    **setup_data(),
                    "username": f"owner{number}",
                    "email": f"owner{number}@example.test",
                },
            )
            return response.status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(submit, [1, 2]))
    assert sorted(statuses) == [201, 404]
    assert get_user_model().objects.count() == 1
    assert Domain.objects.count() == 1
    assert Workspace.objects.count() == 1


def test_setup_does_not_send_verification_email(client, mailoutbox):
    response = client.post("/api/v1/setup/", setup_data())
    assert response.status_code == 201
    assert not EmailAddress.objects.get().verified
    assert not mailoutbox


def test_setup_ignores_retired_model_fields(client, settings):
    from cryptography.fernet import Fernet

    from apps.agents.models import Agent
    from apps.credentials.models import Credential

    settings.CREDENTIAL_ENCRYPTION_KEY = Fernet.generate_key().decode()
    key = "private-setup-model-key"
    response = client.post(
        "/api/v1/setup/",
        {
            **setup_data(),
            "llm_service": "compatible",
            "model": "local-model",
            "api_key": key,
            "base_url": "http://localhost:11434/v1",
        },
    )
    assert response.status_code == 201
    agent = Agent.objects.get()
    assert agent.model == ""
    assert agent.credential is None
    assert not Credential.objects.exists()
    assert key.encode() not in response.content


def test_setup_does_not_render_submitted_model_key(client):
    key = "private-key-never-render"
    response = client.post("/api/v1/setup/", {**setup_data(), "password2": "wrong", "api_key": key})
    assert response.status_code == 400
    assert key.encode() not in response.content


def test_setup_rejects_cross_origin_submission():
    client = Client(enforce_csrf_checks=True)
    client.get("/api/v1/setup/")
    response = client.post(
        "/api/v1/setup/",
        setup_data(),
        HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        HTTP_ORIGIN="https://attacker.example",
    )
    assert response.status_code == 403
    assert not get_user_model().objects.exists()


def test_setup_accepts_json(client):
    response = client.post("/api/v1/setup/", setup_data(), content_type="application/json")
    assert response.status_code == 201
    assert get_user_model().objects.count() == 1


def test_setup_is_unavailable_when_domain_routing_is_disabled(client, settings):
    settings.WORKSPACE_DOMAIN_ROUTING = False
    assert client.get("/api/v1/setup/").json()["setup_required"] is False
    assert client.post("/api/v1/setup/", setup_data()).status_code == 404
    assert not get_user_model().objects.exists()


def test_setup_integrity_error_rolls_back_without_exposing_secrets(client, monkeypatch):
    from django.db import IntegrityError

    def fail(*args, **kwargs):
        raise IntegrityError("private-storage-error")

    monkeypatch.setattr(WorkspaceSettings.objects, "create", fail)
    response = client.post("/api/v1/setup/", setup_data())
    assert response.status_code == 400
    assert "private-storage-error" not in response.content.decode()
    assert response.json()["non_field_errors"]
    assert not get_user_model().objects.exists()
    assert not Workspace.objects.exists()
    assert not InstallationSetup.objects.exists()


@pytest.mark.parametrize(
    ("service_fields", "error_field"),
    [
        ({"username": "invalid/name"}, "username"),
        ({"project_name": "x" * 101}, "project_name"),
    ],
)
def test_setup_preserves_form_validation(client, service_fields, error_field):
    response = client.post("/api/v1/setup/", {**setup_data(), **service_fields})
    assert response.status_code == 400
    assert error_field in response.json()
    assert not get_user_model().objects.exists()


def test_setup_creates_named_project_without_model_encryption(client, settings):
    settings.CREDENTIAL_ENCRYPTION_KEY = ""
    response = client.post(
        "/api/v1/setup/",
        {
            **setup_data(),
            "project_name": "My execution project",
            "model": "test-model",
            "base_url": "http://localhost:11434/v1",
        },
    )
    assert response.status_code == 201
    from apps.agents.models import Agent

    project = Agent.objects.get()
    assert project.name == "My execution project"
    assert project.model == "" and project.credential is None
