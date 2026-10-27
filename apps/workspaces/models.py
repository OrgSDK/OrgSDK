import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


def invitation_expiry():
    return timezone.now() + timedelta(days=7)


class Workspace(models.Model):
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Membership(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        ADMIN = "admin", "Admin"
        MEMBER = "member", "Member"

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="memberships"
    )
    role = models.CharField(max_length=10, choices=Role, default=Role.MEMBER)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "user"], name="unique_workspace_member"),
            models.UniqueConstraint(
                fields=["workspace"],
                condition=models.Q(role="owner"),
                name="unique_workspace_owner",
            ),
            models.CheckConstraint(
                condition=models.Q(role__in=["owner", "admin", "member"]),
                name="valid_membership_role",
            ),
        ]

    def __str__(self):
        return f"Membership {self.pk} ({self.role})"


class Invitation(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="invitations")
    email = models.EmailField()
    role = models.CharField(max_length=10, choices=[("admin", "Admin"), ("member", "Member")])
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    expires_at = models.DateTimeField(default=invitation_expiry)
    accepted_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("email"),
                "workspace",
                condition=models.Q(accepted_at=None, revoked_at=None),
                name="unique_pending_workspace_invite",
            ),
            models.CheckConstraint(
                condition=models.Q(role__in=["admin", "member"]), name="valid_invitation_role"
            ),
        ]

    def __str__(self):
        return f"Invitation {self.pk}"


class Domain(models.Model):
    hostname = models.CharField(max_length=253, unique=True)
    workspace = models.ForeignKey("workspaces.Workspace", on_delete=models.CASCADE)

    def __str__(self):
        return f"{self._meta.verbose_name} {self.pk}"
