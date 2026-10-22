from allauth.account.models import EmailAddress
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from .models import Invitation, Membership, Workspace

MANAGER_ROLES = {Membership.Role.OWNER, Membership.Role.ADMIN}


def active_membership(request):
    memberships = Membership.objects.select_related("workspace").filter(user=request.user)
    if settings.WORKSPACE_DOMAIN_ROUTING:
        membership = memberships.filter(workspace=request.workspace).first()
        if membership is None:
            raise PermissionDenied("You are not a member of this workspace.")
        return membership
    selected = request.session.get("workspace_id")
    membership = memberships.filter(workspace_id=selected).first() if selected else None
    membership = membership or memberships.order_by("pk").first()
    if membership is None:
        raise PermissionDenied("Join or create a workspace first.")
    return membership


def require_manager(membership):
    if membership.role not in MANAGER_ROLES:
        raise PermissionDenied("Only workspace owners and admins can manage this workspace.")


def lock_membership(request):
    membership = active_membership(request)
    # Every membership/invitation mutation takes this lock, including acceptance.
    Workspace.objects.select_for_update().get(pk=membership.workspace_id)
    current = Membership.objects.filter(pk=membership.pk).first()
    if current is None:
        raise PermissionDenied("You no longer belong to this workspace.")
    return current


def require_member_management(actor, target):
    require_manager(actor)
    if target.role == Membership.Role.OWNER:
        raise ValidationError("Transfer ownership before removing or changing the owner.")
    if actor.role == Membership.Role.ADMIN and target.role != Membership.Role.MEMBER:
        raise PermissionDenied("Only the owner can manage admins.")


@transaction.atomic
def accept_invitation(request, token):
    invitation = Invitation.objects.filter(token=token).first()
    if invitation is None or (
        settings.WORKSPACE_DOMAIN_ROUTING and invitation.workspace_id != request.workspace.pk
    ):
        raise NotFound("Invitation not found.")
    Workspace.objects.select_for_update().get(pk=invitation.workspace_id)
    invitation.refresh_from_db()
    addresses = EmailAddress.objects.filter(user=request.user, email__iexact=invitation.email)
    if not addresses.exists():
        raise PermissionDenied("Sign in with the email address this invitation was sent to.")
    if invitation.revoked_at or invitation.expires_at <= timezone.now():
        raise ValidationError("This invitation has expired or was revoked.")
    if invitation.accepted_at:
        if not Membership.objects.filter(
            workspace=invitation.workspace, user=request.user
        ).exists():
            raise ValidationError("This invitation has already been used.")
    else:
        Membership.objects.get_or_create(
            workspace=invitation.workspace, user=request.user, defaults={"role": invitation.role}
        )
        invitation.accepted_at = timezone.now()
        invitation.save(update_fields=["accepted_at"])
    request.session["workspace_id"] = invitation.workspace_id
    return invitation.workspace
