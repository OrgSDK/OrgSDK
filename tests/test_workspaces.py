from datetime import timedelta

import pytest
from allauth.account.models import EmailAddress
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.workspaces.models import Invitation, Membership
from apps.workspaces.tasks import send_invitation

pytestmark = pytest.mark.django_db


@pytest.fixture
def workspace(user):
    return user.memberships.get().workspace


@pytest.fixture
def client(user):
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)
    response = client.get("/api/v1/session/")
    client.credentials(HTTP_X_CSRFTOKEN=response.cookies["csrftoken"].value)
    return client


@pytest.fixture
def teammate(workspace):
    user = User.objects.create_user(username="teammate", email="team@example.com")
    EmailAddress.objects.create(user=user, email=user.email, verified=True)
    Membership.objects.create(workspace=workspace, user=user, role="member")
    return user


def test_default_workspace_and_creation(client, user, workspace):
    assert workspace.memberships.get().role == "owner"
    assert client.get("/api/v1/workspaces/").json()[0]["is_active"]
    response = client.post("/api/v1/workspaces/", {"name": "Company"}, format="json")
    assert response.status_code == 201
    assert client.get("/api/v1/workspaces/current/").json()["workspace"]["name"] == "Company"
    assert user.memberships.count() == 2


def test_workspace_names_are_validated(client):
    for name in ["", "  ", "x" * 101]:
        assert client.post("/api/v1/workspaces/", {"name": name}).status_code == 400


def test_member_cannot_select_or_modify_other_workspace(client, teammate):
    other = teammate.memberships.get(role="owner").workspace
    assert client.post(f"/api/v1/workspaces/{other.pk}/select/").status_code == 404
    other_member = other.memberships.get()
    assert client.delete(f"/api/v1/workspaces/members/{other_member.pk}/").status_code == 404
    assert (
        client.patch(
            f"/api/v1/workspaces/members/{other_member.pk}/", {"role": "admin"}
        ).status_code
        == 404
    )


def test_owner_transfer_and_removal_guard(client, user, workspace, teammate):
    owner = workspace.memberships.get(user=user)
    member = workspace.memberships.get(user=teammate)
    assert client.delete(f"/api/v1/workspaces/members/{owner.pk}/").status_code == 400
    assert (
        client.patch(f"/api/v1/workspaces/members/{owner.pk}/", {"role": "member"}).status_code
        == 400
    )
    assert (
        client.post("/api/v1/workspaces/ownership/", {"membership_id": member.pk}).status_code
        == 204
    )
    owner.refresh_from_db()
    member.refresh_from_db()
    assert owner.role == "admin"
    assert member.role == "owner"
    assert client.delete(f"/api/v1/workspaces/members/{member.pk}/").status_code == 400
    assert client.delete(f"/api/v1/workspaces/members/{owner.pk}/").status_code == 204


def test_only_one_owner_constraint(workspace, teammate):
    member = workspace.memberships.get(user=teammate)
    with pytest.raises(IntegrityError), transaction.atomic():
        member.role = "owner"
        member.save()


@pytest.mark.parametrize("role", ["member", "admin"])
def test_role_boundaries(client, user, workspace, teammate, role):
    # Transfer ownership so the signed-in user can exercise a lower role.
    workspace.memberships.filter(user=user).update(role=role)
    workspace.memberships.filter(user=teammate).update(role="owner")
    response = client.patch("/api/v1/workspaces/current/", {"name": "Renamed"})
    assert response.status_code == (200 if role == "admin" else 403)
    assert (
        client.post(
            "/api/v1/workspaces/invitations/", {"email": "new@example.com", "role": "admin"}
        ).status_code
        == 403
    )
    assert (
        client.post("/api/v1/workspaces/ownership/", {"membership_id": teammate.pk}).status_code
        == 403
    )


def test_invitation_delivery_and_duplicate_control(
    client, workspace, django_capture_on_commit_callbacks, mailoutbox
):
    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(
            "/api/v1/workspaces/invitations/", {"email": "NEW@example.com", "role": "member"}
        )
    assert response.status_code == 201
    invitation = Invitation.objects.get()
    assert invitation.email == "new@example.com"
    assert "token" not in response.json()
    assert len(mailoutbox) == 1
    assert str(invitation.token) in mailoutbox[0].body
    assert (
        client.post(
            "/api/v1/workspaces/invitations/", {"email": "new@example.com", "role": "member"}
        ).status_code
        == 400
    )
    assert client.delete(f"/api/v1/workspaces/invitations/{invitation.pk}/").status_code == 204
    send_invitation(invitation.pk)
    assert len(mailoutbox) == 1
    assert (
        client.post(
            "/api/v1/workspaces/invitations/", {"email": "new@example.com", "role": "owner"}
        ).status_code
        == 400
    )


def test_accept_requires_matching_email(client, user, workspace, teammate):
    other_workspace = teammate.memberships.get(role="owner").workspace
    invitation = Invitation.objects.create(
        workspace=other_workspace, email=user.email, role="admin"
    )
    url = f"/api/v1/workspaces/invitations/{invitation.token}/accept/"
    EmailAddress.objects.filter(user=user).update(verified=False)
    assert client.post(url).status_code == 200
    assert client.post(url).status_code == 200
    assert Membership.objects.get(workspace=other_workspace, user=user).role == "admin"
    assert client.get("/api/v1/workspaces/current/").json()["workspace"]["id"] == other_workspace.pk
    Membership.objects.filter(workspace=other_workspace, user=user).delete()
    assert client.post(url).status_code == 400


@pytest.mark.parametrize("state", ["expired", "revoked", "wrong_email"])
def test_invalid_invitations(client, user, workspace, state):
    invitation = Invitation.objects.create(workspace=workspace, email=user.email, role="member")
    if state == "expired":
        invitation.expires_at = timezone.now() - timedelta(seconds=1)
    if state == "revoked":
        invitation.revoked_at = timezone.now()
    if state == "wrong_email":
        invitation.email = "other@example.com"
    invitation.save()
    assert client.post(
        f"/api/v1/workspaces/invitations/{invitation.token}/accept/"
    ).status_code == (403 if state == "wrong_email" else 400)


def test_member_cannot_read_invites_and_can_leave(client, user, workspace, teammate):
    workspace.memberships.filter(user=user).update(role="member")
    workspace.memberships.filter(user=teammate).update(role="owner")
    Invitation.objects.create(workspace=workspace, email="pending@example.com", role="member")
    assert client.get("/api/v1/workspaces/current/").json()["invitations"] == []
    member = workspace.memberships.get(user=user)
    assert client.delete(f"/api/v1/workspaces/members/{member.pk}/").status_code == 204
    assert client.get("/api/v1/workspaces/").json() == []
    assert client.get("/api/v1/workspaces/current/").status_code == 403


def test_workspace_api_requires_authentication_and_csrf(api_client, user):
    assert api_client.get("/api/v1/workspaces/").status_code == 403
    api_client.force_login(user)
    assert api_client.post("/api/v1/workspaces/", {"name": "Unsafe"}).status_code == 403


def test_expired_invitation_can_be_replaced(client, workspace, user):
    invitation = Invitation.objects.create(
        workspace=workspace,
        email="new@example.com",
        role="member",
        expires_at=timezone.now() - timedelta(seconds=1),
    )
    assert (
        client.post(
            "/api/v1/workspaces/invitations/", {"email": "new@example.com", "role": "member"}
        ).status_code
        == 201
    )
    invitation.refresh_from_db()
    assert invitation.revoked_at is not None


def test_acceptance_does_not_overwrite_existing_role(client, workspace, user):
    invitation = Invitation.objects.create(workspace=workspace, email=user.email, role="member")
    assert (
        client.post(f"/api/v1/workspaces/invitations/{invitation.token}/accept/").status_code == 200
    )
    assert workspace.memberships.get(user=user).role == "owner"


def test_local_invitation_accepts_unverified_matching_email_only(client, user, teammate, settings):
    settings.ACCOUNT_EMAIL_VERIFICATION = "none"
    EmailAddress.objects.filter(user=user).update(verified=False)
    other_workspace = teammate.memberships.get(role="owner").workspace
    invitation = Invitation.objects.create(
        workspace=other_workspace, email="another@example.com", role="member"
    )
    url = f"/api/v1/workspaces/invitations/{invitation.token}/accept/"
    assert client.post(url).status_code == 403
    invitation.email = user.email
    invitation.save()
    assert client.post(url).status_code == 200
    assert Membership.objects.get(user=user, workspace=other_workspace).role == "member"
    assert EmailAddress.objects.get(user=user).verified is False
