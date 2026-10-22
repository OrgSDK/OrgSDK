import pytest
from django.urls import reverse


def test_health_is_public_and_does_not_need_database(client):
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
