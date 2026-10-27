from unittest.mock import Mock

import pytest
from allauth.account.models import EmailAddress
from allauth.mfa.models import Authenticator
from allauth.mfa.totp.internal.auth import format_hotp_value, hotp_value
from django.db import IntegrityError, transaction
from django.urls import reverse

from apps.accounts.models import User

pytestmark = pytest.mark.django_db
PASSWORD = "a-long-test-password-9284"
BASE = "/api/auth/browser/v1/"


def csrf(client):
    client.get(reverse("api-session"))
    return {"HTTP_X_CSRFTOKEN": client.cookies["csrftoken"].value}


def login(client, email, password=PASSWORD):
    return client.post(
        BASE + "auth/login",
        {"email": email, "password": password},
        content_type="application/json",
        **csrf(client),
    )


def test_signup_and_login_without_email_delivery(api_client, mailoutbox):
    response = api_client.post(
        BASE + "auth/signup",
        {"username": "newuser", "email": "new@example.com", "password": PASSWORD},
        format="json",
        **csrf(api_client),
    )
    assert response.status_code == 200, response.content
    user = User.objects.get(email="new@example.com")
    assert user.check_password(PASSWORD)
    assert int(api_client.session["_auth_user_id"]) == user.pk
    assert EmailAddress.objects.get(user=user).verified is False
    assert not mailoutbox
    response = api_client.delete(BASE + "auth/session", **csrf(api_client))
    assert response.status_code == 401
    assert "_auth_user_id" not in api_client.session
    assert login(api_client, user.email).status_code == 200
    assert api_client.get(reverse("api-me")).json()["email"] == user.email


@pytest.mark.parametrize("endpoint", ["auth/login", "auth/signup"])
def test_anonymous_auth_posts_require_csrf(api_client, endpoint):
    response = api_client.post(
        BASE + endpoint, {"email": "new@example.com", "password": PASSWORD}, format="json"
    )
    assert response.status_code == 403
    assert "_auth_user_id" not in api_client.session


def test_unverified_email_can_log_in(api_client, user):
    EmailAddress.objects.filter(user=user).update(verified=False)
    assert login(api_client, user.email).status_code == 200


def test_login_rejects_wrong_password_and_inactive_user(api_client, user):
    assert login(api_client, user.email, "wrong").status_code == 400
    assert "_auth_user_id" not in api_client.session
    user.is_active = False
    user.save()
    assert login(api_client, user.email).status_code in (400, 401, 403)
    assert "_auth_user_id" not in api_client.session


def test_email_uniqueness_is_case_insensitive(user):
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create_user(username="another", email=user.email.upper(), password=PASSWORD)


def test_logout_requires_csrf_and_delete(api_client, user):
    api_client.force_login(user)
    assert api_client.get(BASE + "auth/session").status_code == 200
    assert api_client.delete(BASE + "auth/session").status_code == 403
    assert "_auth_user_id" in api_client.session
    assert api_client.delete(BASE + "auth/session", **csrf(api_client)).status_code == 401
    assert "_auth_user_id" not in api_client.session


def test_admin_login_uses_frontend_login(client):
    response = client.get(reverse("admin:login"))
    assert response.status_code == 302
    assert response.url.startswith(reverse("account_login"))


def test_regular_user_cannot_enter_admin(client, user):
    client.force_login(user)
    assert client.get(reverse("admin:login")).status_code == 403


def test_email_change_requires_reauthentication_and_preserves_unverified_status(
    api_client, user, mailoutbox
):
    api_client.force_login(user)
    url = BASE + "account/email"
    old_email = user.email
    data = {"email": "updated@example.com"}
    response = api_client.post(url, data, format="json", **csrf(api_client))
    assert response.status_code == 401
    assert (
        api_client.post(
            BASE + "auth/reauthenticate", {"password": PASSWORD}, format="json", **csrf(api_client)
        ).status_code
        == 200
    )
    response = api_client.post(url, data, format="json", **csrf(api_client))
    assert response.status_code == 200, response.content
    user.refresh_from_db()
    assert user.email == data["email"]
    assert EmailAddress.objects.get(user=user, primary=True).verified is False
    assert list(EmailAddress.objects.filter(user=user).values_list("email", flat=True)) == [
        data["email"]
    ]
    api_client.delete(BASE + "auth/session", **csrf(api_client))
    assert login(api_client, old_email).status_code == 400
    assert login(api_client, data["email"]).status_code == 200
    assert not mailoutbox


def test_password_change_validates_current_password(api_client, user):
    assert login(api_client, user.email).status_code == 200
    url = BASE + "account/password/change"
    data = {"current_password": "wrong", "new_password": "another-long-password-8824"}
    assert api_client.post(url, data, format="json", **csrf(api_client)).status_code == 400
    data["current_password"] = PASSWORD
    assert api_client.post(url, data, format="json", **csrf(api_client)).status_code == 200
    user.refresh_from_db()
    assert user.check_password(data["new_password"])


def test_email_delivery_and_nonbrowser_auth_routes_are_unavailable(client):
    for path in ["auth/password/request", "auth/email/verify", "auth/phone/verify"]:
        assert client.post(BASE + path).status_code == 404
    assert client.post("/api/auth/app/v1/auth/login").status_code == 404


def test_mfa_setup_login_and_recovery_codes(api_client, user):
    import time

    EmailAddress.objects.filter(user=user).update(verified=False)
    assert login(api_client, user.email).status_code == 200
    url = BASE + "account/authenticators/totp"
    response = api_client.get(url)
    assert response.status_code == 404, response.content
    secret = response.json()["meta"]["secret"]
    assert (
        api_client.post(
            BASE + "auth/reauthenticate", {"password": PASSWORD}, format="json", **csrf(api_client)
        ).status_code
        == 200
    )
    code = format_hotp_value(hotp_value(secret, int(time.time()) // 30))
    response = api_client.post(url, {"code": code}, format="json", **csrf(api_client))
    assert response.status_code == 200, response.content
    assert Authenticator.objects.filter(user=user, type="totp").exists()
    response = api_client.get(BASE + "account/authenticators/recovery-codes")
    assert response.status_code == 200, response.content
    assert "no-store" in response.headers["Cache-Control"]
    codes = response.json()["data"]["unused_codes"]
    assert codes
    api_client.delete(BASE + "auth/session", **csrf(api_client))
    response = login(api_client, user.email)
    assert response.status_code == 401
    assert "_auth_user_id" not in api_client.session
    assert any(
        flow["id"] == "mfa_authenticate" and flow.get("is_pending")
        for flow in response.json()["data"]["flows"]
    )
    response = api_client.post(
        BASE + "auth/2fa/authenticate", {"code": "invalid"}, format="json", **csrf(api_client)
    )
    assert response.status_code == 400
    response = api_client.post(
        BASE + "auth/2fa/authenticate", {"code": codes[0]}, format="json", **csrf(api_client)
    )
    assert response.status_code == 200, response.content
    assert int(api_client.session["_auth_user_id"]) == user.pk
    recovery = Authenticator.objects.get(user=user, type="recovery_codes").wrap()
    assert codes[0] not in recovery.get_unused_codes()


def test_signup_keeps_password_validation_and_email_uniqueness(api_client, user, mailoutbox):
    url = BASE + "auth/signup"
    response = api_client.post(
        url,
        {"username": "another", "email": "unique@example.com", "password": "123"},
        format="json",
        **csrf(api_client),
    )
    assert response.status_code == 400
    assert not User.objects.filter(email="unique@example.com").exists()
    response = api_client.post(
        url,
        {"username": "another", "email": user.email.upper(), "password": PASSWORD},
        format="json",
        **csrf(api_client),
    )
    assert response.status_code == 400
    assert not mailoutbox


def test_email_change_rejects_another_accounts_email(api_client, user):
    other = User.objects.create_user(username="other", email="other@example.com", password=PASSWORD)
    EmailAddress.objects.create(user=other, email=other.email, primary=True, verified=False)
    assert login(api_client, user.email).status_code == 200
    assert (
        api_client.post(
            BASE + "auth/reauthenticate", {"password": PASSWORD}, format="json", **csrf(api_client)
        ).status_code
        == 200
    )
    response = api_client.post(
        BASE + "account/email", {"email": other.email.upper()}, format="json", **csrf(api_client)
    )
    assert response.status_code == 400
    user.refresh_from_db()
    assert user.email == "alex@example.com"


def test_email_verification_request_method_is_disabled(api_client, user, mailoutbox):
    api_client.force_login(user)
    response = api_client.put(
        BASE + "account/email", {"email": user.email}, format="json", **csrf(api_client)
    )
    assert response.status_code == 405
    assert not mailoutbox


def test_login_rate_limit_is_preserved(api_client, user, settings):
    settings.ACCOUNT_RATE_LIMITS = {"login": "1/m/ip"}
    assert login(api_client, user.email, "wrong").status_code == 400
    assert login(api_client, user.email, "wrong").status_code == 429


@pytest.mark.parametrize("routing", [False, True])
@pytest.mark.parametrize(
    "endpoint",
    ["auth/session", "account/authenticators/totp", "account/authenticators/recovery-codes"],
)
def test_headless_sensitive_responses_are_never_cached(
    api_client, user, settings, routing, endpoint
):
    from apps.workspaces.models import Domain

    Domain.objects.create(hostname="testserver", workspace=user.memberships.get().workspace)
    settings.WORKSPACE_DOMAIN_ROUTING = routing
    api_client.force_login(user)
    response = api_client.get(BASE + endpoint)
    assert response.status_code in (200, 404)
    assert "no-store" in response.headers["Cache-Control"]
    if not routing:
        assert "private" in response.headers["Cache-Control"]


def test_email_change_rolls_back_when_another_account_claims_validated_email(
    api_client, user, monkeypatch
):
    from allauth.account.adapter import get_adapter

    target = "concurrent@example.com"
    other = User.objects.create_user(username="concurrent", email=target, password=PASSWORD)
    assert login(api_client, user.email).status_code == 200
    assert (
        api_client.post(
            BASE + "auth/reauthenticate", {"password": PASSWORD}, format="json", **csrf(api_client)
        ).status_code
        == 200
    )
    # Reproduce successful validation immediately before another account's write wins.
    monkeypatch.setattr("apps.accounts.headless.LocalEmailInput.clean_email", lambda self: target)
    monkeypatch.setattr(
        "apps.accounts.headless.manage_email.email_already_exists",
        Mock(side_effect=[(target, False), get_adapter().validation_error("email_taken")]),
    )
    response = api_client.post(
        BASE + "account/email", {"email": target}, format="json", **csrf(api_client)
    )
    assert response.status_code == 400
    assert response.json()["errors"][0]["code"] == "email_taken"
    user.refresh_from_db()
    other.refresh_from_db()
    assert user.email == "alex@example.com"
    assert other.email == target
    assert EmailAddress.objects.get(user=user, primary=True).email == user.email
    assert not EmailAddress.objects.filter(user=user, email=target).exists()


def test_email_replacement_cleans_legacy_aliases_without_address_limit(api_client, user, settings):
    settings.ACCOUNT_MAX_EMAIL_ADDRESSES = 1
    EmailAddress.objects.create(user=user, email="legacy@example.com", verified=False)
    assert login(api_client, user.email).status_code == 200
    assert (
        api_client.post(
            BASE + "auth/reauthenticate", {"password": PASSWORD}, format="json", **csrf(api_client)
        ).status_code
        == 200
    )
    for email in ["replacement@example.com", "final@example.com"]:
        response = api_client.post(
            BASE + "account/email", {"email": email}, format="json", **csrf(api_client)
        )
        assert response.status_code == 200, response.content
        assert list(EmailAddress.objects.filter(user=user).values_list("email", flat=True)) == [
            email
        ]
    api_client.delete(BASE + "auth/session", **csrf(api_client))
    assert login(api_client, "legacy@example.com").status_code == 400
    assert login(api_client, "replacement@example.com").status_code == 400
    assert login(api_client, "final@example.com").status_code == 200
