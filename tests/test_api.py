import pytest
from django.urls import reverse

from apps.accounts.models import User

pytestmark = pytest.mark.django_db


def test_profile_requires_authentication(api_client):
    assert api_client.get(reverse("api-me")).status_code == 403


def test_profile_only_returns_current_user(api_client, user):
    User.objects.create_user(username="other", email="other@example.com", password="different")
    api_client.force_login(user)
    response = api_client.get(reverse("api-me"))
    assert response.status_code == 200
    assert response.json() == {
        "id": user.pk,
        "username": user.username,
        "email": user.email,
        "first_name": "",
        "last_name": "",
    }


def test_profile_update_requires_csrf(api_client, user):
    api_client.force_login(user)
    response = api_client.patch(reverse("api-me"), {"first_name": "Changed"}, format="json")
    assert response.status_code == 403
    user.refresh_from_db()
    assert user.first_name == ""


def test_profile_update_cannot_change_identity_or_privileges(api_client, user):
    api_client.force_login(user)
    api_client.get(reverse("api-session"))
    token = api_client.cookies["csrftoken"].value
    response = api_client.patch(
        reverse("api-me"),
        {
            "first_name": "Alex",
            "email": "replacement@example.com",
            "username": "replacement",
            "is_staff": True,
            "is_superuser": True,
            "password": "replaced",
        },
        format="json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200
    user.refresh_from_db()
    assert user.first_name == "Alex"
    assert user.email == "alex@example.com"
    assert user.username == "alex"
    assert not user.is_staff
    assert not user.is_superuser
    assert user.check_password("a-long-test-password-9284")


@pytest.mark.parametrize("name", ["api-schema", "api-docs", "api-redoc"])
def test_api_documentation_requires_staff(api_client, user, name):
    assert api_client.get(reverse(name)).status_code == 403
    api_client.force_login(user)
    assert api_client.get(reverse(name)).status_code == 403
    user.is_staff = True
    user.save()
    assert api_client.get(reverse(name)).status_code == 200


def test_schema_describes_profile(api_client, user):
    user.is_staff = True
    user.save()
    api_client.force_login(user)
    response = api_client.get(reverse("api-schema"), HTTP_ACCEPT="application/vnd.oai.openapi+json")
    schema = response.json()
    assert set(schema["paths"]["/api/v1/me/"]) == {"get", "patch"}
    assert "cookieAuth" in schema["components"]["securitySchemes"]


def test_cors_does_not_allow_arbitrary_origins(api_client):
    response = api_client.get(reverse("api-me"), HTTP_ORIGIN="https://untrusted.example")
    assert "Access-Control-Allow-Origin" not in response


def test_anonymous_session_bootstraps_csrf_without_login(api_client):
    response = api_client.get(reverse("api-session"))
    assert response.status_code == 200
    assert response.json() == {"is_authenticated": False, "user": None}
    assert response.cookies["csrftoken"]
    assert "no-store" in response["Cache-Control"]
    assert "Cookie" in response["Vary"]


def test_session_only_exposes_current_user_and_supports_csrf_write(api_client, user):
    api_client.force_login(user)
    response = api_client.get(reverse("api-session"))
    assert response.json()["is_authenticated"] is True
    assert response.json()["user"]["id"] == user.pk
    assert "password" not in response.json()["user"]
    token = response.cookies["csrftoken"].value
    assert (
        api_client.patch(
            reverse("api-me"), {"first_name": "Through SPA"}, format="json", HTTP_X_CSRFTOKEN=token
        ).status_code
        == 200
    )
    assert (
        api_client.patch(
            reverse("api-me"),
            {"first_name": "Cross-site"},
            format="json",
            HTTP_X_CSRFTOKEN=token,
            HTTP_ORIGIN="https://untrusted.example",
        ).status_code
        == 403
    )


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/features/",
        "/api/v1/billing/",
        "/accounts/billing/",
        "/accounts/billing/checkout/",
        "/accounts/billing/portal/",
        "/api/stripe/webhook/",
    ],
)
def test_removed_hosted_product_routes_are_not_registered(path):
    from django.urls import Resolver404, resolve

    with pytest.raises(Resolver404):
        resolve(path)
