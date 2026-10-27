from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from .models import Invitation


def send_invitation(invitation_id):
    invitation = Invitation.objects.select_related("workspace").filter(pk=invitation_id).first()
    if invitation is None:
        return
    if invitation.accepted_at or invitation.revoked_at or invitation.expires_at <= timezone.now():
        return
    base_url = settings.WORKSPACE_INVITE_BASE_URL
    if settings.WORKSPACE_DOMAIN_ROUTING:
        from apps.workspaces.models import Domain

        domain = Domain.objects.filter(workspace=invitation.workspace).order_by("pk").first()
        if domain is None:
            raise ValueError("Workspace requires a registered domain before sending invitations.")
        base_url = f"{settings.PUBLIC_SCHEME}://{domain.hostname}/workspaces/invite/"
    url = f"{base_url}?token={invitation.token}"
    send_mail(
        f"Invitation to {invitation.workspace.name}",
        f"You have been invited to {invitation.workspace.name} as {invitation.role}.\n"
        f"Sign in with {invitation.email} and accept: {url}\n"
        "This invitation expires in seven days.",
        settings.DEFAULT_FROM_EMAIL,
        [invitation.email],
    )
