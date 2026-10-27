import pytest
from django.urls import reverse


@pytest.mark.django_db
def test_health_is_public_and_checks_database_readiness(client):
    response = client.get(reverse("health"))
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize(
    "path", ["/accounts/login/", "/accounts/signup/", "/accounts/email/", "/setup/"]
)
def test_account_and_setup_pages_belong_to_react(client, path):
    response = client.get(path)
    assert response.status_code == 404
    assert b"css/accounts.css" not in response.content
    assert b"Playground" not in response.content


@pytest.mark.parametrize("path", ["/", "/playground/", "/api/not-found/"])
def test_django_does_not_serve_spa_routes(client, path):
    assert client.get(path).status_code == 404


def test_health_reports_database_failure(client, monkeypatch):
    from django.db import OperationalError

    from apps.core import views

    def unavailable():
        raise OperationalError("database unavailable")

    monkeypatch.setattr(views.connection, "cursor", unavailable)
    response = client.get(reverse("health"))
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
